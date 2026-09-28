import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { formatDateMDY } from '../common/utils/date-format.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  LowStockAlertEntry,
  NearExpiryAlertEntry,
} from './inventory-alerts.interface';
import { PaginatedResult } from './inventory-movements.interface';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Strips the time component — mirrors ProductBatchesService/
 * StockReceiptsService's identical helper (duplicated rather than imported;
 * see stock-receipts.service.ts's comment on why catalog/ isn't a shared
 * dependency for this). */
function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

@Injectable()
export class InventoryAlertsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A product is low-stock when reorderThreshold IS NOT NULL and
   * sum(quantityRemaining) < reorderThreshold, strictly less than (PRD
   * STORY-017). Products with a null reorderThreshold never appear — nothing
   * to compare against. Sorted worst-shortage-first, i.e. ascending by
   * (totalOnHand - reorderThreshold) — the most negative value is the worst
   * shortfall.
   *
   * Computed in application memory rather than a SQL aggregate: the sort key
   * is a per-product cross-row aggregation (sum of batches) combined against
   * a per-product column, which Prisma can't express as a single ORDER BY,
   * and this project has no raw-SQL query layer to reach for instead. Fine
   * at this MVP's per-tenant product-catalog scale; pagination is applied
   * after the in-memory sort, not via SQL LIMIT/OFFSET.
   */
  async getLowStock(
    tenantId: number,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<LowStockAlertEntry>> {
    const products = await this.prisma.product.findMany({
      where: { tenantId, reorderThreshold: { not: null } },
      include: { batches: { select: { quantityRemaining: true } } },
    });

    const shortages: LowStockAlertEntry[] = products
      .map((p) => {
        const totalOnHand = p.batches.reduce(
          (sum, b) => sum + b.quantityRemaining,
          0,
        );
        return {
          productId: p.productId,
          name: p.name,
          sku: p.sku,
          reorderThreshold: p.reorderThreshold as number,
          totalOnHand,
        };
      })
      .filter((p) => p.totalOnHand < p.reorderThreshold)
      .sort(
        (a, b) =>
          a.totalOnHand -
          a.reorderThreshold -
          (b.totalOnHand - b.reorderThreshold),
      );

    const page = query.page ?? 1;
    const perPage = query.per_page ?? 25;
    const total = shortages.length;
    const start = (page - 1) * perPage;

    return {
      data: shortages.slice(start, start + perPage),
      meta: {
        total,
        page,
        per_page: perPage,
        total_pages: Math.ceil(total / perPage),
      },
    };
  }

  /**
   * Every ProductBatch with quantityRemaining > 0 and
   * expiryDate <= today + withinDays (PRD STORY-018), sorted expiryDate
   * ascending (soonest — including already-expired, which sorts first of
   * all — appears first). Unlike getLowStock, this filter/sort is a plain
   * per-row predicate the existing expiryDate index already serves, so it's
   * pushed down to SQL with real LIMIT/OFFSET pagination.
   */
  async getNearExpiry(
    tenantId: number,
    withinDays: number,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<NearExpiryAlertEntry>> {
    const today = startOfTodayUtc();
    const cutoff = new Date(today.getTime() + withinDays * MS_PER_DAY);

    const where: Prisma.ProductBatchWhereInput = {
      tenantId,
      quantityRemaining: { gt: 0 },
      expiryDate: { lte: cutoff },
    };

    const page = query.page ?? 1;
    const perPage = query.per_page ?? 25;
    const skip = (page - 1) * perPage;

    const [batches, total] = await Promise.all([
      this.prisma.productBatch.findMany({
        where,
        include: { product: { select: { name: true } } },
        orderBy: { expiryDate: 'asc' },
        skip,
        take: perPage,
      }),
      this.prisma.productBatch.count({ where }),
    ]);

    const data: NearExpiryAlertEntry[] = batches.map((b) => ({
      batchId: b.batchId,
      productId: b.productId,
      productName: b.product.name,
      batchNumber: b.batchNumber,
      expiryDate: formatDateMDY(b.expiryDate),
      quantityRemaining: b.quantityRemaining,
      daysUntilExpiry: Math.round(
        (b.expiryDate.getTime() - today.getTime()) / MS_PER_DAY,
      ),
    }));

    return {
      data,
      meta: {
        total,
        page,
        per_page: perPage,
        total_pages: Math.ceil(total / perPage),
      },
    };
  }
}
