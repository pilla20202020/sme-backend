import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventoryMovementType, Prisma } from '@prisma/client';
import { formatDateMDY } from '../common/utils/date-format.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInventoryAdjustmentDto } from './dto/create-inventory-adjustment.dto';
import { ListInventoryMovementsQueryDto } from './dto/list-inventory-movements-query.dto';
import {
  InventoryAdjustmentResponse,
  InventoryMovementResponse,
  OnHandResponse,
  PaginatedResult,
} from './inventory-movements.interface';

type RawMovement = Prisma.InventoryMovementGetPayload<Record<string, never>>;
type RawBatch = Prisma.ProductBatchGetPayload<Record<string, never>>;

function mapMovement(m: RawMovement): InventoryMovementResponse {
  return {
    movementId: m.movementId.toString(),
    tenantId: m.tenantId,
    productId: m.productId,
    productBatchId: m.productBatchId,
    movementType: m.movementType,
    quantityDelta: m.quantityDelta,
    reason: m.reason,
    referenceType: m.referenceType,
    referenceId: m.referenceId,
    actorId: m.actorId,
    occurredAt: formatDateMDY(m.occurredAt, { includeTime: true }),
  };
}

function movementWhereFromQuery(
  base: Prisma.InventoryMovementWhereInput,
  query: Pick<
    ListInventoryMovementsQueryDto,
    'movementType' | 'dateFrom' | 'dateTo'
  >,
): Prisma.InventoryMovementWhereInput {
  return {
    ...base,
    ...(query.movementType != null && { movementType: query.movementType }),
    ...((query.dateFrom || query.dateTo) && {
      occurredAt: {
        ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
        ...(query.dateTo && { lte: new Date(query.dateTo) }),
      },
    }),
  };
}

@Injectable()
export class InventoryMovementsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertProductExists(
    tenantId: number,
    productId: number,
  ): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { productId, tenantId },
      select: { productId: true },
    });
    if (!product) {
      throw new NotFoundException(
        `Product ${productId} not found for tenant ${tenantId}`,
      );
    }
  }

  /**
   * Tenant-wide movement ledger, filterable by productId/movementType/date
   * range (PRD STORY-015). Default sort is occurredAt desc (most recent
   * first) — the investigation flow starts from "what just happened."
   */
  async findAll(
    tenantId: number,
    query: ListInventoryMovementsQueryDto,
  ): Promise<PaginatedResult<InventoryMovementResponse>> {
    const page = query.page ?? 1;
    const perPage = query.per_page ?? 25;
    const skip = (page - 1) * perPage;

    const where = movementWhereFromQuery(
      {
        tenantId,
        ...(query.productId != null && { productId: query.productId }),
      },
      query,
    );

    const [data, total] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { occurredAt: 'desc' },
      }),
      this.prisma.inventoryMovement.count({ where }),
    ]);

    return {
      data: data.map(mapMovement),
      meta: {
        total,
        page,
        per_page: perPage,
        total_pages: Math.ceil(total / perPage),
      },
    };
  }

  /**
   * Product-scoped movement history — the "explain the current count"
   * investigation flow named in STORY-015's AC. Chronological-friendly via
   * the same occurredAt desc default as findAll(); callers wanting oldest-
   * first for a reconciliation check can page through and reverse client-side
   * (no separate sort param — out of scope for this story).
   */
  async findAllForProduct(
    tenantId: number,
    productId: number,
    query: ListInventoryMovementsQueryDto,
  ): Promise<PaginatedResult<InventoryMovementResponse>> {
    await this.assertProductExists(tenantId, productId);

    const page = query.page ?? 1;
    const perPage = query.per_page ?? 25;
    const skip = (page - 1) * perPage;

    const where = movementWhereFromQuery({ tenantId, productId }, query);

    const [data, total] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { occurredAt: 'desc' },
      }),
      this.prisma.inventoryMovement.count({ where }),
    ]);

    return {
      data: data.map(mapMovement),
      meta: {
        total,
        page,
        per_page: perPage,
        total_pages: Math.ceil(total / perPage),
      },
    };
  }

  /**
   * The canonical "what do we have right now" read (PRD STORY-015) — a
   * straight sum of ProductBatch.quantityRemaining across every batch of
   * this product, batch-level breakdown included. A product with zero
   * batches yet is valid and simply returns totalOnHand: 0, batches: [].
   */
  async getOnHand(
    tenantId: number,
    productId: number,
  ): Promise<OnHandResponse> {
    await this.assertProductExists(tenantId, productId);

    const batches = await this.prisma.productBatch.findMany({
      where: { tenantId, productId },
      orderBy: { expiryDate: 'asc' },
    });

    const totalOnHand = batches.reduce(
      (sum, b) => sum + b.quantityRemaining,
      0,
    );

    return {
      productId,
      totalOnHand,
      batches: batches.map((b: RawBatch) => ({
        batchId: b.batchId,
        batchNumber: b.batchNumber,
        expiryDate: formatDateMDY(b.expiryDate),
        quantityRemaining: b.quantityRemaining,
      })),
    };
  }

  /**
   * Manual stock correction (PRD STORY-016). The negative-quantity guard and
   * the write must be one atomic DB operation, not a read-check-write in
   * application code — under Read Committed (this project's default
   * isolation), two concurrent adjustments against the same batch would
   * otherwise both read the same pre-adjustment quantity, both pass the
   * in-app check, and both write, producing a lost update (batch goes
   * negative in effect even though each write individually looked safe).
   * `updateMany` with `quantityRemaining: { gte: -delta }` in the `WHERE`
   * makes Postgres itself re-evaluate the guard against the current row at
   * write time; `count === 0` means either the batch doesn't exist or the
   * guard failed, disambiguated by a follow-up existence check. Everything
   * still happens inside one transaction: (1) atomic guarded update,
   * (2) insert the movement row, (3) stamp that same row's referenceId with
   * its own movementId — there is no separate adjustment table, the
   * movement row IS the adjustment record (PRD). Any failure rolls back all
   * of it — no partial write to either ProductBatch or InventoryMovement.
   */
  async createAdjustment(
    tenantId: number,
    productId: number,
    dto: CreateInventoryAdjustmentDto,
    actorId?: number,
  ): Promise<InventoryAdjustmentResponse> {
    await this.assertProductExists(tenantId, productId);

    const { movement, updatedBatch } = await this.prisma.$transaction(
      async (tx) => {
        const { count } = await tx.productBatch.updateMany({
          where: {
            batchId: dto.productBatchId,
            tenantId,
            productId,
            quantityRemaining: { gte: -dto.quantityDelta },
          },
          data: { quantityRemaining: { increment: dto.quantityDelta } },
        });

        if (count === 0) {
          const exists = await tx.productBatch.findFirst({
            where: { batchId: dto.productBatchId, tenantId, productId },
            select: { batchId: true, quantityRemaining: true },
          });
          if (!exists) {
            throw new NotFoundException(
              `Batch ${dto.productBatchId} not found for product ${productId}`,
            );
          }
          throw new ConflictException(
            `Adjustment would take batch ${exists.batchId}'s quantityRemaining below zero (currently ${exists.quantityRemaining})`,
          );
        }

        const updated = await tx.productBatch.findFirstOrThrow({
          where: { batchId: dto.productBatchId, tenantId, productId },
        });

        const created = await tx.inventoryMovement.create({
          data: {
            tenantId,
            productId,
            productBatchId: updated.batchId,
            movementType: InventoryMovementType.adjustment,
            quantityDelta: dto.quantityDelta,
            reason: dto.reason,
            referenceType: 'InventoryAdjustment',
            actorId: actorId ?? null,
          },
        });

        const stamped = await tx.inventoryMovement.update({
          where: { movementId: created.movementId },
          data: { referenceId: Number(created.movementId) },
        });

        return { movement: stamped, updatedBatch: updated };
      },
    );

    return {
      movement: mapMovement(movement),
      quantityRemaining: updatedBatch.quantityRemaining,
    };
  }
}
