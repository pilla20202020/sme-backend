import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventoryMovementType, Prisma } from '@prisma/client';
import { formatDateMDY } from '../common/utils/date-format.util';
import { InventoryMovementsService } from '../inventory/inventory-movements.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { ListSalesQueryDto } from './dto/list-sales-query.dto';
import { QuoteSaleDto } from './dto/quote-sale.dto';
import {
  PaginatedResult,
  QuoteResponse,
  SaleReceiptResponse,
} from './sales.interface';

type RawProduct = Prisma.ProductGetPayload<Record<string, never>>;
type RawSaleWithLines = Prisma.SaleGetPayload<{
  include: {
    customer: true;
    cashier: true;
    lines: { include: { product: true; allocations: true } };
  };
}>;

// Rounds a floating-point money computation to 2 decimal places — same
// precision as the Decimal(10,2) columns these values are ultimately stored
// in. Plain JS numbers are used throughout (never Prisma.Decimal), matching
// this codebase's existing convention (ProductsService/PurchaseOrdersService
// both pass plain numbers straight to Prisma for Decimal columns).
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The one shared response mapper for checkout's response, GET .../:saleId,
 * and GET .../:saleId/receipt (PRD §8 — "implement one mapSaleReceipt() and
 * reuse it in both places, don't duplicate it").
 */
function mapSaleReceipt(sale: RawSaleWithLines): SaleReceiptResponse {
  return {
    saleId: sale.saleId,
    saleDate: formatDateMDY(sale.saleDate, { includeTime: true }),
    customer: sale.customer
      ? { customerId: sale.customer.customerId, name: sale.customer.name }
      : null,
    cashier: sale.cashier
      ? {
          userId: sale.cashier.userId,
          firstName: sale.cashier.firstName,
          lastName: sale.cashier.lastName,
        }
      : null,
    lines: sale.lines.map((line) => ({
      saleLineId: line.saleLineId,
      productId: line.productId,
      productName: line.product.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice.toNumber(),
      lineTotal: line.lineTotal.toNumber(),
      allocations: line.allocations.map((allocation) => ({
        saleLineBatchAllocationId: allocation.id,
        quantity: allocation.quantity,
      })),
    })),
    subtotal: sale.subtotal.toNumber(),
    total: sale.total.toNumber(),
  };
}

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly movementsService: InventoryMovementsService,
  ) {}

  /**
   * Loads every referenced product in one query and 404s if any of them
   * don't belong to this tenant (or don't exist at all) — mirrors
   * PurchaseOrdersService.assertProductsBelongToTenant's exact convention.
   */
  private async loadProductsForTenant(
    tenantId: number,
    productIds: number[],
  ): Promise<Map<number, RawProduct>> {
    const uniqueIds = [...new Set(productIds)];
    const products = await this.prisma.product.findMany({
      where: { productId: { in: uniqueIds }, tenantId },
    });
    if (products.length !== uniqueIds.length) {
      const foundIds = new Set(products.map((p) => p.productId));
      const missing = uniqueIds.filter((id) => !foundIds.has(id));
      throw new NotFoundException(
        `Product(s) ${missing.join(', ')} not found for tenant ${tenantId}`,
      );
    }
    return new Map(products.map((p) => [p.productId, p]));
  }

  private async assertCustomerBelongsToTenant(
    tenantId: number,
    customerId: number,
  ): Promise<void> {
    const customer = await this.prisma.customer.findFirst({
      where: { customerId, tenantId },
      select: { customerId: true },
    });
    if (!customer) {
      throw new NotFoundException(
        `Customer ${customerId} not found for tenant ${tenantId}`,
      );
    }
  }

  /**
   * Read-only, side-effect-free dry-run (PRD STORY-019) — no Sale/SaleLine/
   * InventoryMovement row is ever written here. Reuses
   * InventoryMovementsService.getOnHand() for the on-hand sum rather than
   * re-implementing the sum(ProductBatch.quantityRemaining) aggregation.
   * unitPrice/lineTotal reflect Product.currentPrice as of this instant —
   * nothing is frozen/committed until an actual checkout.
   */
  async quote(tenantId: number, dto: QuoteSaleDto): Promise<QuoteResponse> {
    const productMap = await this.loadProductsForTenant(
      tenantId,
      dto.lines.map((l) => l.productId),
    );

    let subtotal = 0;
    let allSufficient = true;
    const lines: QuoteResponse['lines'] = [];

    for (const line of dto.lines) {
      const product = productMap.get(line.productId)!;
      const onHand = await this.movementsService.getOnHand(
        tenantId,
        line.productId,
      );
      const unitPrice = product.currentPrice.toNumber();
      const lineTotal = round2(unitPrice * line.quantity);
      const available = onHand.totalOnHand >= line.quantity;
      if (!available) {
        allSufficient = false;
      }
      subtotal += lineTotal;

      lines.push({
        productId: line.productId,
        quantity: line.quantity,
        unitPrice,
        lineTotal,
        available,
        totalOnHand: onHand.totalOnHand,
      });
    }

    const roundedSubtotal = round2(subtotal);
    return {
      lines,
      subtotal: roundedSubtotal,
      total: roundedSubtotal,
      allSufficient,
    };
  }

  /**
   * First-Expiry-First-Out batch draw (STORY-021), called once per sale line
   * from inside checkout()'s transaction. Every batch decrement is one
   * atomic guarded `updateMany` — WHERE quantityRemaining >= amount taken,
   * decrement in the same statement — never a read-then-write, because a
   * concurrently-racing sale/adjustment against the same batch must never
   * be able to both pass a guard evaluated in application code (the exact
   * lost-update race QA reproduced against InventoryMovementsService's
   * original createAdjustment() implementation — see that method's doc
   * comment and PRD §2). `count === 0` on any single batch's decrement means
   * another concurrent write already consumed it since the `findMany` read
   * above; there is no partial-batch retry-within-retry (PRD §7 step 3) —
   * the whole line, and by extension the whole checkout transaction, fails
   * with 409 and rolls back everything.
   */
  private async consumeFefo(
    tx: Prisma.TransactionClient,
    tenantId: number,
    productId: number,
    quantity: number,
  ): Promise<{ batchId: number; quantity: number }[]> {
    const batches = await tx.productBatch.findMany({
      where: { tenantId, productId, quantityRemaining: { gt: 0 } },
      orderBy: { expiryDate: 'asc' },
    });

    const allocations: { batchId: number; quantity: number }[] = [];
    let remaining = quantity;

    for (const batch of batches) {
      if (remaining <= 0) break;

      const take = Math.min(remaining, batch.quantityRemaining);
      if (take <= 0) continue;

      const { count } = await tx.productBatch.updateMany({
        where: {
          batchId: batch.batchId,
          tenantId,
          productId,
          quantityRemaining: { gte: take },
        },
        data: { quantityRemaining: { decrement: take } },
      });

      if (count === 0) {
        throw new ConflictException(
          `Insufficient stock for product ${productId}: a concurrent transaction already consumed batch ${batch.batchId}`,
        );
      }

      allocations.push({ batchId: batch.batchId, quantity: take });
      remaining -= take;
    }

    if (remaining > 0) {
      throw new ConflictException(
        `Insufficient stock for product ${productId}: requested ${quantity}, only ${quantity - remaining} available across all batches`,
      );
    }

    return allocations;
  }

  /**
   * Atomic sale + inventory decrement (STORY-020). Entirely inside one
   * $transaction: the FEFO decrement attempt itself IS the stock-
   * sufficiency validation (there is no separate pre-check/pre-validate
   * step, precisely to avoid re-introducing a TOCTOU gap between a "check"
   * and a "write") — if any line can't be fully satisfied, the whole
   * transaction rolls back, including every row already written for earlier
   * lines in the same request. A sale is always all-or-nothing.
   *
   * Known, deliberate gap (PRD §6 AC-2): there is no idempotency-key
   * mechanism anywhere in this codebase yet, so a client that retries an
   * already-succeeded HTTP request (e.g. after a dropped response) will
   * create a second, independent sale rather than being recognized as a
   * duplicate. What this transaction DOES guarantee is that a single
   * request's sale-creation and inventory-decrement can never partially
   * apply — they commit or roll back together. A true retry-safe
   * idempotency key is a fair follow-up story, not a silent scope-cut.
   */
  async checkout(
    tenantId: number,
    dto: CreateSaleDto,
    cashierId?: number,
  ): Promise<SaleReceiptResponse> {
    const productMap = await this.loadProductsForTenant(
      tenantId,
      dto.lines.map((l) => l.productId),
    );
    if (dto.customerId != null) {
      await this.assertCustomerBelongsToTenant(tenantId, dto.customerId);
    }

    const saleId = await this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          tenantId,
          customerId: dto.customerId ?? null,
          cashierId: cashierId ?? null,
          // Placeholder — recomputed and persisted below once every line
          // (and its FEFO allocations) has been written. Never read back
          // before that update, so the temporary 0 is never observable.
          subtotal: 0,
          total: 0,
        },
      });

      let subtotal = 0;

      for (const line of dto.lines) {
        const product = productMap.get(line.productId)!;
        // Frozen at sale time from Product.currentPrice, same "freeze at
        // transaction time" principle as PurchaseOrderLine.unitCost /
        // ProductPriceHistory — never looked up dynamically again after
        // this point.
        const unitPrice = product.currentPrice.toNumber();
        const lineTotal = round2(unitPrice * line.quantity);

        const allocations = await this.consumeFefo(
          tx,
          tenantId,
          line.productId,
          line.quantity,
        );

        const saleLine = await tx.saleLine.create({
          data: {
            saleId: sale.saleId,
            productId: line.productId,
            quantity: line.quantity,
            unitPrice,
            lineTotal,
          },
        });

        // One SaleLineBatchAllocation + one InventoryMovement per batch
        // actually drawn from (PRD §6 step 4 / §7 step 5) — a line can span
        // 2+ batches on FEFO spillover.
        for (const allocation of allocations) {
          const allocationRow = await tx.saleLineBatchAllocation.create({
            data: {
              saleLineId: saleLine.saleLineId,
              productBatchId: allocation.batchId,
              quantity: allocation.quantity,
            },
          });

          await tx.inventoryMovement.create({
            data: {
              tenantId,
              productId: line.productId,
              productBatchId: allocation.batchId,
              movementType: InventoryMovementType.sale,
              quantityDelta: -allocation.quantity,
              referenceType: 'SaleLineBatchAllocation',
              referenceId: allocationRow.id,
              actorId: cashierId ?? null,
            },
          });
        }

        subtotal += lineTotal;
      }

      const roundedSubtotal = round2(subtotal);
      await tx.sale.update({
        where: { saleId: sale.saleId },
        data: { subtotal: roundedSubtotal, total: roundedSubtotal },
      });

      return sale.saleId;
    });

    return this.getSale(tenantId, saleId);
  }

  /**
   * Canonical "get a sale" read (STORY-022). GET .../:saleId/receipt below
   * is exactly this same read with a receipt-flavored response shape — in
   * practice the identical shape, per the PRD's explicit instruction not to
   * build two DTOs/mappers for one record — and checkout()'s response
   * reuses it too.
   */
  async getSale(
    tenantId: number,
    saleId: number,
  ): Promise<SaleReceiptResponse> {
    const sale = await this.prisma.sale.findFirst({
      where: { saleId, tenantId },
      include: {
        customer: true,
        cashier: true,
        lines: {
          include: { product: true, allocations: true },
          orderBy: { saleLineId: 'asc' },
        },
      },
    });
    if (!sale) {
      throw new NotFoundException(
        `Sale ${saleId} not found for tenant ${tenantId}`,
      );
    }
    return mapSaleReceipt(sale);
  }

  async getReceipt(
    tenantId: number,
    saleId: number,
  ): Promise<SaleReceiptResponse> {
    return this.getSale(tenantId, saleId);
  }

  /**
   * Tenant-wide sales list (STORY-028), paginated and filterable by
   * dateFrom/dateTo on Sale.saleDate — the exact filter-construction pattern
   * InventoryMovementsService.findAll() uses for occurredAt, applied here to
   * saleDate. Reuses mapSaleReceipt() for each row (PRD §5 — "reuse the
   * existing mapSale()-style shape ... just as a paginated list"), so a list
   * row and a single GET .../:saleId are always the identical shape. Default
   * sort is saleDate desc (most recent first), matching every other list
   * endpoint's convention in this codebase.
   */
  async findAll(
    tenantId: number,
    query: ListSalesQueryDto,
  ): Promise<PaginatedResult<SaleReceiptResponse>> {
    const page = query.page ?? 1;
    const perPage = query.per_page ?? 25;
    const skip = (page - 1) * perPage;

    const where: Prisma.SaleWhereInput = {
      tenantId,
      ...((query.dateFrom || query.dateTo) && {
        saleDate: {
          ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
          ...(query.dateTo && { lte: new Date(query.dateTo) }),
        },
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { saleDate: 'desc' },
        include: {
          customer: true,
          cashier: true,
          lines: {
            include: { product: true, allocations: true },
            orderBy: { saleLineId: 'asc' },
          },
        },
      }),
      this.prisma.sale.count({ where }),
    ]);

    return {
      data: data.map(mapSaleReceipt),
      meta: {
        total,
        page,
        per_page: perPage,
        total_pages: Math.ceil(total / perPage),
      },
    };
  }
}
