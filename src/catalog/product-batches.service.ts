import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { formatDateMDY } from '../common/utils/date-format.util';
import { PrismaService } from '../prisma/prisma.service';
import { PaginatedResult } from './categories.interface';
import { CreateBatchDto } from './dto/create-batch.dto';
import { ProductBatchResponse } from './product-batches.interface';

type RawBatch = Prisma.ProductBatchGetPayload<Record<string, never>>;

function mapBatch(batch: RawBatch): ProductBatchResponse {
  return {
    batchId: batch.batchId,
    tenantId: batch.tenantId,
    productId: batch.productId,
    batchNumber: batch.batchNumber,
    expiryDate: formatDateMDY(batch.expiryDate),
    quantityReceived: batch.quantityReceived,
    quantityRemaining: batch.quantityRemaining,
    receivedAt: formatDateMDY(batch.receivedAt, { includeTime: true }),
    createdAt: formatDateMDY(batch.createdAt, { includeTime: true }),
    updatedAt: formatDateMDY(batch.updatedAt, { includeTime: true }),
  };
}

/** Strips the time component so "today" received at any hour is never
 * itself treated as "in the past" — compares calendar dates, not instants. */
function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

@Injectable()
export class ProductBatchesService {
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
   * Receiving already-expired stock as "fresh inventory" is a data-entry
   * error, not a valid state (PRD AC-3 / pharmacy regulation) — rejected
   * with 400 rather than silently accepted.
   */
  async create(
    tenantId: number,
    productId: number,
    dto: CreateBatchDto,
  ): Promise<ProductBatchResponse> {
    await this.assertProductExists(tenantId, productId);

    const expiryDate = new Date(dto.expiryDate);
    if (expiryDate.getTime() < startOfTodayUtc().getTime()) {
      throw new BadRequestException('expiryDate cannot be in the past');
    }

    const batch = await this.prisma.productBatch.create({
      data: {
        tenantId,
        productId,
        batchNumber: dto.batchNumber,
        expiryDate,
        quantityReceived: dto.quantityReceived,
        quantityRemaining: dto.quantityReceived,
      },
    });

    return mapBatch(batch);
  }

  /**
   * Ordered soonest-expiry-first (not most-recently-created) — sets up FEFO
   * for the later Sales/POS epic to consume; this story only orders the
   * *read*, it does not implement batch selection itself (PRD, out of
   * scope). A product with zero batches yet is valid and simply returns an
   * empty page, not an error.
   */
  async findAllForProduct(
    tenantId: number,
    productId: number,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<ProductBatchResponse>> {
    await this.assertProductExists(tenantId, productId);

    const page = query.page ?? 1;
    const perPage = query.per_page ?? 25;
    const skip = (page - 1) * perPage;

    const [data, total] = await Promise.all([
      this.prisma.productBatch.findMany({
        where: { tenantId, productId },
        skip,
        take: perPage,
        orderBy: { expiryDate: 'asc' },
      }),
      this.prisma.productBatch.count({ where: { tenantId, productId } }),
    ]);

    return {
      data: data.map(mapBatch),
      meta: {
        total,
        page,
        per_page: perPage,
        total_pages: Math.ceil(total / perPage),
      },
    };
  }
}
