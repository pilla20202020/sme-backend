import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InventoryMovementType,
  Prisma,
  PurchaseOrderStatus,
} from '@prisma/client';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { formatDateMDY } from '../common/utils/date-format.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStockReceiptDto } from './dto/create-stock-receipt.dto';
import {
  DiscrepancyEntry,
  PaginatedResult,
  StockReceiptCreateResponse,
  StockReceiptLineResponse,
  StockReceiptResponse,
} from './stock-receipts.interface';

type RawStockReceiptLine = Prisma.StockReceiptLineGetPayload<
  Record<string, never>
>;
type RawStockReceipt = Prisma.StockReceiptGetPayload<{
  include: { lines: true };
}>;
type RawPurchaseOrderLine = Prisma.PurchaseOrderLineGetPayload<
  Record<string, never>
>;

/**
 * Strips the time component so "today" received at any hour is never itself
 * treated as "in the past" — compares calendar dates, not instants. This
 * mirrors ProductBatchesService's exact expiry-date-in-the-past rule
 * (STORY-008); duplicated rather than imported because src/catalog/ is
 * read-only reference for this story (not to be modified), and the two
 * services have no other shared dependency worth introducing just for this.
 */
function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function mapReceiptLine(line: RawStockReceiptLine): StockReceiptLineResponse {
  return {
    receiptLineId: line.receiptLineId,
    receiptId: line.receiptId,
    purchaseOrderLineId: line.purchaseOrderLineId,
    productId: line.productId,
    quantityReceived: line.quantityReceived,
    batchNumber: line.batchNumber,
    expiryDate: formatDateMDY(line.expiryDate),
    unitCost: line.unitCost.toNumber(),
    productBatchId: line.productBatchId,
    createdAt: formatDateMDY(line.createdAt, { includeTime: true }),
  };
}

function mapReceipt(receipt: RawStockReceipt): StockReceiptResponse {
  return {
    receiptId: receipt.receiptId,
    tenantId: receipt.tenantId,
    purchaseOrderId: receipt.purchaseOrderId,
    receivedAt: formatDateMDY(receipt.receivedAt, { includeTime: true }),
    receivedBy: receipt.receivedBy,
    notes: receipt.notes,
    createdAt: formatDateMDY(receipt.createdAt, { includeTime: true }),
    lines: receipt.lines.map(mapReceiptLine),
  };
}

/**
 * Status is always computed fresh from cumulative line totals, never
 * caller-supplied (PRD STORY-013):
 *  - pending: no line has received anything yet.
 *  - received: every line's cumulative quantityReceived >= quantityOrdered
 *    (over-received lines still count as satisfied).
 *  - partially_received: anything in between.
 */
function computeStatus(
  lines: Pick<RawPurchaseOrderLine, 'quantityOrdered' | 'quantityReceived'>[],
): PurchaseOrderStatus {
  const allReceived = lines.every(
    (l) => l.quantityReceived >= l.quantityOrdered,
  );
  if (allReceived) return PurchaseOrderStatus.received;

  const anyReceived = lines.some((l) => l.quantityReceived > 0);
  return anyReceived
    ? PurchaseOrderStatus.partially_received
    : PurchaseOrderStatus.pending;
}

@Injectable()
export class StockReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertPurchaseOrderBelongsToTenant(
    tenantId: number,
    purchaseOrderId: number,
  ): Promise<void> {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { purchaseOrderId, tenantId },
      select: { purchaseOrderId: true },
    });
    if (!po) {
      throw new NotFoundException(
        `Purchase order ${purchaseOrderId} not found for tenant ${tenantId}`,
      );
    }
  }

  /**
   * Receiving is transactional across four things at once (PRD STORY-014):
   * (1) create the StockReceipt + its lines, (2) create the corresponding
   * ProductBatch row(s), (3) increment each PurchaseOrderLine's cumulative
   * quantityReceived, (4) recompute and persist PurchaseOrder.status. All
   * four succeed or none do.
   *
   * A receipt where a line's received quantity doesn't match the outstanding
   * ordered quantity still succeeds — the mismatch is reported in the
   * returned `discrepancies` array, never silently force-matched or
   * rejected (PRD FR-10 AC-1). A PO can be received across multiple separate
   * receipt events (partial deliveries): quantityReceived on a line is
   * cumulative across all receipts against it, and status is recomputed
   * fresh from cumulative totals every time.
   */
  async createReceipt(
    tenantId: number,
    purchaseOrderId: number,
    dto: CreateStockReceiptDto,
    receivedBy?: number,
  ): Promise<StockReceiptCreateResponse> {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { purchaseOrderId, tenantId },
      include: { lines: true },
    });
    if (!po) {
      throw new NotFoundException(
        `Purchase order ${purchaseOrderId} not found for tenant ${tenantId}`,
      );
    }

    const poLineById = new Map(po.lines.map((l) => [l.lineId, l]));
    for (const line of dto.lines) {
      if (!poLineById.has(line.purchaseOrderLineId)) {
        throw new NotFoundException(
          `Purchase order line ${line.purchaseOrderLineId} not found for purchase order ${purchaseOrderId}`,
        );
      }

      const expiryDate = new Date(line.expiryDate);
      if (expiryDate.getTime() < startOfTodayUtc().getTime()) {
        throw new BadRequestException('expiryDate cannot be in the past');
      }
    }

    const { receipt, discrepancies, status } = await this.prisma.$transaction(
      async (tx) => {
        // Fresh cumulative snapshot read inside the transaction — a PO
        // received across multiple prior events must have its outstanding
        // amount computed from the latest committed totals, not the
        // pre-transaction read above.
        const freshLines = await tx.purchaseOrderLine.findMany({
          where: { purchaseOrderId },
        });
        const freshById = new Map(freshLines.map((l) => [l.lineId, l]));

        const createdReceipt = await tx.stockReceipt.create({
          data: {
            tenantId,
            purchaseOrderId,
            receivedBy: receivedBy ?? null,
            notes: dto.notes ?? null,
          },
        });

        const discrepancyEntries: DiscrepancyEntry[] = [];
        const createdLines: RawStockReceiptLine[] = [];

        for (const line of dto.lines) {
          const poLine = freshById.get(line.purchaseOrderLineId)!;
          const outstandingBeforeReceipt =
            poLine.quantityOrdered - poLine.quantityReceived;

          if (line.quantityReceived !== outstandingBeforeReceipt) {
            discrepancyEntries.push({
              purchaseOrderLineId: poLine.lineId,
              productId: poLine.productId,
              quantityOrdered: poLine.quantityOrdered,
              outstandingBeforeReceipt,
              quantityReceivedThisReceipt: line.quantityReceived,
            });
          }

          const expiryDate = new Date(line.expiryDate);

          // Reuses the ProductBatch model built in STORY-008 rather than
          // duplicating batch data — quantityReceived and quantityRemaining
          // both start equal to this receipt line's quantityReceived (PRD).
          const batch = await tx.productBatch.create({
            data: {
              tenantId,
              productId: poLine.productId,
              batchNumber: line.batchNumber,
              expiryDate,
              quantityReceived: line.quantityReceived,
              quantityRemaining: line.quantityReceived,
            },
          });

          const receiptLine = await tx.stockReceiptLine.create({
            data: {
              receiptId: createdReceipt.receiptId,
              purchaseOrderLineId: poLine.lineId,
              productId: poLine.productId,
              quantityReceived: line.quantityReceived,
              batchNumber: line.batchNumber,
              expiryDate,
              unitCost: line.unitCost,
              productBatchId: batch.batchId,
            },
          });
          createdLines.push(receiptLine);

          await tx.purchaseOrderLine.update({
            where: { lineId: poLine.lineId },
            data: { quantityReceived: { increment: line.quantityReceived } },
          });

          // STORY-015 retrofit: every increment to ProductBatch.quantityRemaining
          // gets a matching InventoryMovement row, inside this same
          // transaction — the ledger and the on-hand quantity can never
          // observably diverge.
          await tx.inventoryMovement.create({
            data: {
              tenantId,
              productId: poLine.productId,
              productBatchId: batch.batchId,
              movementType: InventoryMovementType.receipt,
              quantityDelta: line.quantityReceived,
              referenceType: 'StockReceiptLine',
              referenceId: receiptLine.receiptLineId,
              actorId: receivedBy ?? null,
            },
          });
        }

        // Recompute status fresh from cumulative totals across every line on
        // the PO (not just the lines touched by this receipt) — a line
        // untouched by this receipt still factors into whether the PO as a
        // whole is partially_received or received.
        const updatedLines = await tx.purchaseOrderLine.findMany({
          where: { purchaseOrderId },
        });
        const newStatus = computeStatus(updatedLines);

        await tx.purchaseOrder.update({
          where: { purchaseOrderId },
          data: { status: newStatus },
        });

        return {
          receipt: { ...createdReceipt, lines: createdLines },
          discrepancies: discrepancyEntries,
          status: newStatus,
        };
      },
    );

    return {
      ...mapReceipt(receipt),
      discrepancies,
      purchaseOrderStatus: status,
    };
  }

  async findAllForPurchaseOrder(
    tenantId: number,
    purchaseOrderId: number,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<StockReceiptResponse>> {
    await this.assertPurchaseOrderBelongsToTenant(tenantId, purchaseOrderId);

    const page = query.page ?? 1;
    const perPage = query.per_page ?? 25;
    const skip = (page - 1) * perPage;

    const [data, total] = await Promise.all([
      this.prisma.stockReceipt.findMany({
        where: { purchaseOrderId },
        skip,
        take: perPage,
        orderBy: { receivedAt: 'desc' },
        include: { lines: true },
      }),
      this.prisma.stockReceipt.count({ where: { purchaseOrderId } }),
    ]);

    return {
      data: data.map(mapReceipt),
      meta: {
        total,
        page,
        per_page: perPage,
        total_pages: Math.ceil(total / perPage),
      },
    };
  }
}
