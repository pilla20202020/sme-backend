import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import { formatDateMDY } from '../common/utils/date-format.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { ListPurchaseOrdersQueryDto } from './dto/list-purchase-orders-query.dto';
import {
  PaginatedResult,
  PurchaseOrderLineResponse,
  PurchaseOrderResponse,
} from './purchase-orders.interface';

type RawPurchaseOrderLine = Prisma.PurchaseOrderLineGetPayload<
  Record<string, never>
>;
type RawPurchaseOrder = Prisma.PurchaseOrderGetPayload<{
  include: { lines: true };
}>;

function mapLine(line: RawPurchaseOrderLine): PurchaseOrderLineResponse {
  return {
    lineId: line.lineId,
    purchaseOrderId: line.purchaseOrderId,
    productId: line.productId,
    quantityOrdered: line.quantityOrdered,
    quantityReceived: line.quantityReceived,
    unitCost: line.unitCost.toNumber(),
    createdAt: formatDateMDY(line.createdAt, { includeTime: true }),
    updatedAt: formatDateMDY(line.updatedAt, { includeTime: true }),
  };
}

function mapPurchaseOrder(po: RawPurchaseOrder): PurchaseOrderResponse {
  return {
    purchaseOrderId: po.purchaseOrderId,
    tenantId: po.tenantId,
    supplierId: po.supplierId,
    status: po.status,
    orderDate: formatDateMDY(po.orderDate, { includeTime: true }),
    expectedDeliveryDate: formatDateMDY(po.expectedDeliveryDate),
    notes: po.notes,
    createdBy: po.createdBy,
    createdAt: formatDateMDY(po.createdAt, { includeTime: true }),
    updatedAt: formatDateMDY(po.updatedAt, { includeTime: true }),
    lines: po.lines.map(mapLine),
  };
}

@Injectable()
export class PurchaseOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertTenantExists(tenantId: number): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { tenantId },
      select: { tenantId: true },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }
  }

  private async assertSupplierBelongsToTenant(
    tenantId: number,
    supplierId: number,
  ): Promise<void> {
    const supplier = await this.prisma.supplier.findFirst({
      where: { supplierId, tenantId },
      select: { supplierId: true },
    });
    if (!supplier) {
      throw new NotFoundException(
        `Supplier ${supplierId} not found for tenant ${tenantId}`,
      );
    }
  }

  private async assertProductsBelongToTenant(
    tenantId: number,
    productIds: number[],
  ): Promise<void> {
    const uniqueIds = [...new Set(productIds)];
    const found = await this.prisma.product.findMany({
      where: { productId: { in: uniqueIds }, tenantId },
      select: { productId: true },
    });
    if (found.length !== uniqueIds.length) {
      const foundIds = new Set(found.map((p) => p.productId));
      const missing = uniqueIds.filter((id) => !foundIds.has(id));
      throw new NotFoundException(
        `Product(s) ${missing.join(', ')} not found for tenant ${tenantId}`,
      );
    }
  }

  /**
   * unitCost/productId are frozen onto each PurchaseOrderLine at creation
   * time — a later change to Product.currentPrice never touches these rows
   * (PRD FR-09 AC-2 / STORY-012, same "historical record stays historical"
   * principle as ProductPriceHistory).
   */
  async create(
    tenantId: number,
    dto: CreatePurchaseOrderDto,
    createdBy?: number,
  ): Promise<PurchaseOrderResponse> {
    await this.assertTenantExists(tenantId);
    await this.assertSupplierBelongsToTenant(tenantId, dto.supplierId);
    await this.assertProductsBelongToTenant(
      tenantId,
      dto.lines.map((l) => l.productId),
    );

    const po = await this.prisma.purchaseOrder.create({
      data: {
        tenantId,
        supplierId: dto.supplierId,
        expectedDeliveryDate: dto.expectedDeliveryDate
          ? new Date(dto.expectedDeliveryDate)
          : null,
        notes: dto.notes ?? null,
        createdBy: createdBy ?? null,
        lines: {
          create: dto.lines.map((l) => ({
            productId: l.productId,
            quantityOrdered: l.quantityOrdered,
            unitCost: l.unitCost,
          })),
        },
      },
      include: { lines: true },
    });

    return mapPurchaseOrder(po);
  }

  /**
   * A PO is only ever findable through its own tenant — matching the
   * findFirst({ where: { id, tenantId } }) pattern used everywhere else in
   * this codebase.
   */
  async findById(
    tenantId: number,
    purchaseOrderId: number,
  ): Promise<PurchaseOrderResponse> {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { purchaseOrderId, tenantId },
      include: { lines: { orderBy: { lineId: 'asc' } } },
    });
    if (!po) {
      throw new NotFoundException(
        `Purchase order ${purchaseOrderId} not found for tenant ${tenantId}`,
      );
    }
    return mapPurchaseOrder(po);
  }

  async findAll(
    tenantId: number,
    query: ListPurchaseOrdersQueryDto,
    status?: PurchaseOrderStatus,
  ): Promise<PaginatedResult<PurchaseOrderResponse>> {
    await this.assertTenantExists(tenantId);

    const page = query.page ?? 1;
    const perPage = query.per_page ?? 25;
    const skip = (page - 1) * perPage;
    const where: Prisma.PurchaseOrderWhereInput = {
      tenantId,
      ...(status != null ? { status } : {}),
      // STORY-028 addition — additive AND with `status`, same
      // filter-construction pattern as InventoryMovementsService's
      // movementWhereFromQuery() applied to occurredAt.
      ...((query.dateFrom || query.dateTo) && {
        orderDate: {
          ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
          ...(query.dateTo && { lte: new Date(query.dateTo) }),
        },
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: { lines: { orderBy: { lineId: 'asc' } } },
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return {
      data: data.map(mapPurchaseOrder),
      meta: {
        total,
        page,
        per_page: perPage,
        total_pages: Math.ceil(total / perPage),
      },
    };
  }
}
