import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventoryMovementType, Prisma } from '@prisma/client';
import { formatDateMDY } from '../common/utils/date-format.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReturnDto } from './dto/create-return.dto';
import { ReturnResponse } from './returns.interface';

type RawReturnWithLines = Prisma.ReturnGetPayload<{
  include: { lines: { include: { product: true } } };
}>;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function mapReturn(ret: RawReturnWithLines): ReturnResponse {
  return {
    returnId: ret.returnId,
    tenantId: ret.tenantId,
    saleId: ret.saleId,
    reason: ret.reason,
    overrideApprovedBy: ret.overrideApprovedBy,
    processedBy: ret.processedBy,
    refundTotal: ret.refundTotal.toNumber(),
    returnDate: formatDateMDY(ret.returnDate, { includeTime: true }),
    lines: ret.lines.map((line) => ({
      returnLineId: line.returnLineId,
      productId: line.productId,
      productName: line.product.name,
      saleLineBatchAllocationId: line.saleLineBatchAllocationId,
      productBatchId: line.productBatchId,
      quantity: line.quantity,
      unitPrice: line.unitPrice.toNumber(),
      lineTotal: line.lineTotal.toNumber(),
    })),
  };
}

interface ResolvedReturnLine {
  productId: number;
  productBatchId: number;
  saleLineBatchAllocationId: number | null;
  quantity: number;
  unitPrice: number;
}

@Injectable()
export class ReturnsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Branch selector (PRD §4/§5): `saleId` present → matched return against
   * an original sale's SaleLineBatchAllocation row(s); `saleId` absent →
   * manager-override unmatched return. CreateReturnDto already guarantees
   * `overrideApprovedBy` is present whenever `saleId` is absent (a 400 at
   * the validation layer otherwise), so this method never needs to check
   * for "neither" itself.
   */
  async create(
    tenantId: number,
    dto: CreateReturnDto,
    processedBy?: number,
  ): Promise<ReturnResponse> {
    if (dto.saleId != null) {
      return this.createMatched(tenantId, dto, processedBy);
    }
    return this.createOverride(tenantId, dto, processedBy);
  }

  async getReturn(tenantId: number, returnId: number): Promise<ReturnResponse> {
    const ret = await this.prisma.return.findFirst({
      where: { returnId, tenantId },
      include: {
        lines: { include: { product: true }, orderBy: { returnLineId: 'asc' } },
      },
    });
    if (!ret) {
      throw new NotFoundException(
        `Return ${returnId} not found for tenant ${tenantId}`,
      );
    }
    return mapReturn(ret);
  }

  // ─── Matched case (STORY-023) ───────────────────────────────────────────

  private async createMatched(
    tenantId: number,
    dto: CreateReturnDto,
    processedBy?: number,
  ): Promise<ReturnResponse> {
    const saleId = dto.saleId!;

    const sale = await this.prisma.sale.findFirst({
      where: { saleId, tenantId },
      select: { saleId: true },
    });
    if (!sale) {
      throw new NotFoundException(
        `Sale ${saleId} not found for tenant ${tenantId}`,
      );
    }

    for (const line of dto.lines) {
      if (line.saleLineBatchAllocationId == null) {
        throw new BadRequestException(
          'Each line must include saleLineBatchAllocationId when saleId is provided',
        );
      }
    }

    const allocationIds = dto.lines.map((l) => l.saleLineBatchAllocationId!);
    const allocations = await this.prisma.saleLineBatchAllocation.findMany({
      where: { id: { in: [...new Set(allocationIds)] } },
      include: { saleLine: { include: { sale: true } } },
    });
    const allocationById = new Map(allocations.map((a) => [a.id, a]));

    const missing = allocationIds.filter((id) => {
      const allocation = allocationById.get(id);
      return (
        !allocation ||
        allocation.saleLine.saleId !== saleId ||
        allocation.saleLine.sale.tenantId !== tenantId
      );
    });
    if (missing.length > 0) {
      throw new NotFoundException(
        `SaleLineBatchAllocation(s) ${[...new Set(missing)].join(', ')} not found for sale ${saleId}`,
      );
    }

    const returnId = await this.prisma.$transaction(async (tx) => {
      const returnRow = await tx.return.create({
        data: {
          tenantId,
          saleId,
          reason: dto.reason,
          processedBy: processedBy ?? null,
          refundTotal: 0, // placeholder — stamped below once every line total is known
        },
      });

      let refundTotal = 0;

      for (const line of dto.lines) {
        const allocation = allocationById.get(line.saleLineBatchAllocationId!)!;

        // Serializes concurrent returns against the SAME allocation — the
        // "cannot over-return an allocation" bound is an aggregate (sum of
        // this allocation's ReturnLine.quantity across every return), not a
        // single counter column we can guard with a plain conditional
        // updateMany (PRD §2/§4). A row-level lock on the allocation itself,
        // held for the rest of this transaction, is what makes the
        // sum-then-insert below race-free: a second transaction touching
        // the same allocation blocks here until this one commits or rolls
        // back, so it always recomputes the sum against up-to-date data —
        // exactly the TOCTOU gap Sprint 4/5's guarded-updateMany pattern
        // closes for a simple bound, adapted here for an aggregate one.
        await tx.$executeRaw`SELECT 1 FROM sale_line_batch_allocations WHERE id = ${allocation.id} FOR UPDATE`;

        const { _sum } = await tx.returnLine.aggregate({
          where: { saleLineBatchAllocationId: allocation.id },
          _sum: { quantity: true },
        });
        const alreadyReturned = _sum.quantity ?? 0;

        if (alreadyReturned + line.quantity > allocation.quantity) {
          throw new ConflictException(
            `Return quantity ${line.quantity} would exceed allocation ${allocation.id}'s remaining returnable amount (already returned ${alreadyReturned} of ${allocation.quantity})`,
          );
        }

        const unitPrice = allocation.saleLine.unitPrice.toNumber();
        const lineTotal = round2(unitPrice * line.quantity);

        const returnLine = await tx.returnLine.create({
          data: {
            returnId: returnRow.returnId,
            productId: allocation.saleLine.productId,
            saleLineBatchAllocationId: allocation.id,
            productBatchId: allocation.productBatchId,
            quantity: line.quantity,
            unitPrice,
            lineTotal,
          },
        });

        await tx.productBatch.update({
          where: { batchId: allocation.productBatchId },
          data: { quantityRemaining: { increment: line.quantity } },
        });

        await tx.inventoryMovement.create({
          data: {
            tenantId,
            productId: allocation.saleLine.productId,
            productBatchId: allocation.productBatchId,
            movementType: InventoryMovementType.return,
            quantityDelta: line.quantity,
            referenceType: 'ReturnLine',
            referenceId: returnLine.returnLineId,
            actorId: processedBy ?? null,
          },
        });

        refundTotal += lineTotal;
      }

      await tx.return.update({
        where: { returnId: returnRow.returnId },
        data: { refundTotal: round2(refundTotal) },
      });

      return returnRow.returnId;
    });

    return this.getReturn(tenantId, returnId);
  }

  // ─── Override case (STORY-024) ──────────────────────────────────────────

  private async createOverride(
    tenantId: number,
    dto: CreateReturnDto,
    processedBy?: number,
  ): Promise<ReturnResponse> {
    const overrideApprovedBy = dto.overrideApprovedBy!;

    await this.assertOverrideApprover(tenantId, overrideApprovedBy);

    const resolvedLines: ResolvedReturnLine[] = [];
    for (const line of dto.lines) {
      if (
        line.productId == null ||
        line.productBatchId == null ||
        line.unitPrice == null
      ) {
        throw new BadRequestException(
          'Each line must include productId, productBatchId, and unitPrice when saleId is omitted (manager-override return)',
        );
      }
      resolvedLines.push({
        productId: line.productId,
        productBatchId: line.productBatchId,
        saleLineBatchAllocationId: null,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      });
    }

    await this.assertBatchesBelongToProducts(
      tenantId,
      resolvedLines.map((l) => ({
        productBatchId: l.productBatchId,
        productId: l.productId,
      })),
    );

    const returnId = await this.prisma.$transaction(async (tx) => {
      const returnRow = await tx.return.create({
        data: {
          tenantId,
          saleId: null,
          reason: dto.reason,
          overrideApprovedBy,
          processedBy: processedBy ?? null,
          refundTotal: 0, // placeholder — stamped below
        },
      });

      let refundTotal = 0;

      for (const line of resolvedLines) {
        const lineTotal = round2(line.unitPrice * line.quantity);

        const returnLine = await tx.returnLine.create({
          data: {
            returnId: returnRow.returnId,
            productId: line.productId,
            saleLineBatchAllocationId: null,
            productBatchId: line.productBatchId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineTotal,
          },
        });

        // No allocation ceiling applies here — there is no original
        // allocation to bound against (PRD §5); the manager's approval,
        // already asserted above, is the control. A plain atomic increment
        // is safe regardless of concurrent writers (PRD §2).
        await tx.productBatch.update({
          where: { batchId: line.productBatchId },
          data: { quantityRemaining: { increment: line.quantity } },
        });

        await tx.inventoryMovement.create({
          data: {
            tenantId,
            productId: line.productId,
            productBatchId: line.productBatchId,
            movementType: InventoryMovementType.return,
            quantityDelta: line.quantity,
            referenceType: 'ReturnLine',
            referenceId: returnLine.returnLineId,
            actorId: processedBy ?? null,
          },
        });

        refundTotal += lineTotal;
      }

      await tx.return.update({
        where: { returnId: returnRow.returnId },
        data: { refundTotal: round2(refundTotal) },
      });

      return returnRow.returnId;
    });

    return this.getReturn(tenantId, returnId);
  }

  /**
   * The payload-dependent check (PRD §2/§5): only the unmatched-return
   * branch needs `returns:override`, so this is a single in-service check
   * against `overrideApprovedBy`'s own resolved permissions, not a second
   * route guard. 403 whether the named user doesn't exist in this tenant or
   * exists but lacks the permission — distinct from the base 403
   * PermissionsGuard already gives a caller missing even `returns:create`.
   */
  private async assertOverrideApprover(
    tenantId: number,
    userId: number,
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { userId, tenantId },
      select: {
        roles: {
          select: {
            role: {
              select: {
                permissions: {
                  select: { permission: { select: { name: true } } },
                },
              },
            },
          },
        },
      },
    });

    const permissions = new Set(
      (user?.roles ?? []).flatMap((ur) =>
        ur.role.permissions.map((rp) => rp.permission.name),
      ),
    );

    if (!user || !permissions.has('returns:override')) {
      throw new ForbiddenException(
        `User ${userId} is not authorized to approve an unmatched return (missing returns:override)`,
      );
    }
  }

  /**
   * Mirrors PurchaseOrdersService.assertProductsBelongToTenant's exact
   * convention, adapted to the (productBatchId, productId) pair STORY-024
   * needs validated together — a batch must belong to BOTH this tenant and
   * the specific product named alongside it (PRD §5).
   */
  private async assertBatchesBelongToProducts(
    tenantId: number,
    pairs: { productBatchId: number; productId: number }[],
  ): Promise<void> {
    const uniqueBatchIds = [...new Set(pairs.map((p) => p.productBatchId))];
    const batches = await this.prisma.productBatch.findMany({
      where: { batchId: { in: uniqueBatchIds }, tenantId },
      select: { batchId: true, productId: true },
    });
    const batchById = new Map(batches.map((b) => [b.batchId, b]));

    const invalid = pairs.filter((p) => {
      const batch = batchById.get(p.productBatchId);
      return !batch || batch.productId !== p.productId;
    });
    if (invalid.length > 0) {
      const ids = [...new Set(invalid.map((p) => p.productBatchId))];
      throw new NotFoundException(
        `ProductBatch(es) ${ids.join(', ')} not found for the given product(s) in tenant ${tenantId}`,
      );
    }
  }
}
