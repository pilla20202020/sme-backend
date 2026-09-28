import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { formatDateMDY } from '../common/utils/date-format.util';
import { PrismaService } from '../prisma/prisma.service';
import { PaginatedResult } from './categories.interface';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdatePriceDto } from './dto/update-price.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  ProductPriceHistoryResponse,
  ProductResponse,
} from './products.interface';

type RawProduct = Prisma.ProductGetPayload<Record<string, never>>;
type RawPriceHistory = Prisma.ProductPriceHistoryGetPayload<
  Record<string, never>
>;

function mapProduct(product: RawProduct): ProductResponse {
  return {
    productId: product.productId,
    tenantId: product.tenantId,
    categoryId: product.categoryId,
    name: product.name,
    sku: product.sku,
    unit: product.unit,
    currentPrice: product.currentPrice.toNumber(),
    reorderThreshold: product.reorderThreshold,
    isActive: product.isActive,
    createdAt: formatDateMDY(product.createdAt, { includeTime: true }),
    updatedAt: formatDateMDY(product.updatedAt, { includeTime: true }),
  };
}

function mapPriceHistory(row: RawPriceHistory): ProductPriceHistoryResponse {
  return {
    id: row.id.toString(),
    productId: row.productId,
    price: row.price.toNumber(),
    effectiveFrom: formatDateMDY(row.effectiveFrom, { includeTime: true }),
    changedBy: row.changedBy,
    createdAt: formatDateMDY(row.createdAt, { includeTime: true }),
  };
}

@Injectable()
export class ProductsService {
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

  private async assertCategoryBelongsToTenant(
    tenantId: number,
    categoryId: number,
  ): Promise<void> {
    const category = await this.prisma.category.findFirst({
      where: { categoryId, tenantId },
      select: { categoryId: true },
    });
    if (!category) {
      throw new NotFoundException(
        `Category ${categoryId} not found for tenant ${tenantId}`,
      );
    }
  }

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
   * currentPrice is set directly here at creation time — there is no prior
   * price to "change from" yet, so no ProductPriceHistory row is seeded.
   * The history timeline begins with the first real change made through
   * updatePrice(), matching STORY-007's AC wording (a price *change*
   * produces a history row).
   */
  async create(
    tenantId: number,
    dto: CreateProductDto,
  ): Promise<ProductResponse> {
    await this.assertTenantExists(tenantId);
    if (dto.categoryId != null) {
      await this.assertCategoryBelongsToTenant(tenantId, dto.categoryId);
    }

    try {
      const product = await this.prisma.product.create({
        data: {
          tenantId,
          categoryId: dto.categoryId ?? null,
          name: dto.name,
          sku: dto.sku ?? null,
          unit: dto.unit,
          currentPrice: dto.currentPrice,
          reorderThreshold: dto.reorderThreshold ?? null,
        },
      });
      return mapProduct(product);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `A product with sku "${dto.sku}" already exists for this tenant`,
        );
      }
      throw err;
    }
  }

  async findById(
    tenantId: number,
    productId: number,
  ): Promise<ProductResponse> {
    const product = await this.prisma.product.findFirst({
      where: { productId, tenantId },
    });
    if (!product) {
      throw new NotFoundException(
        `Product ${productId} not found for tenant ${tenantId}`,
      );
    }
    return mapProduct(product);
  }

  async findAll(
    tenantId: number,
    query: PaginationQueryDto,
    categoryId?: number,
    search?: string,
  ): Promise<PaginatedResult<ProductResponse>> {
    await this.assertTenantExists(tenantId);

    const page = query.page ?? 1;
    const perPage = query.per_page ?? 25;
    const skip = (page - 1) * perPage;
    const where: Prisma.ProductWhereInput = {
      tenantId,
      ...(categoryId != null ? { categoryId } : {}),
      // Additive AND with categoryId (never overrides it) — matches
      // Product.name OR Product.sku, case-insensitively.
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { sku: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data: data.map(mapProduct),
      meta: {
        total,
        page,
        per_page: perPage,
        total_pages: Math.ceil(total / perPage),
      },
    };
  }

  /**
   * currentPrice is never accepted here — UpdateProductDto has no such
   * field, so the global ValidationPipe (whitelist + forbidNonWhitelisted)
   * already rejects a body containing it with 400 before this method ever
   * runs (PRD AC-3). This method only ever touches the fields the DTO
   * declares.
   */
  async update(
    tenantId: number,
    productId: number,
    dto: UpdateProductDto,
  ): Promise<ProductResponse> {
    await this.assertProductExists(tenantId, productId);

    if (dto.categoryId != null) {
      await this.assertCategoryBelongsToTenant(tenantId, dto.categoryId);
    }

    try {
      const product = await this.prisma.product.update({
        where: { productId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.sku !== undefined && { sku: dto.sku }),
          ...(dto.unit !== undefined && { unit: dto.unit }),
          ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
          ...(dto.reorderThreshold !== undefined && {
            reorderThreshold: dto.reorderThreshold,
          }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });
      return mapProduct(product);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `A product with sku "${dto.sku}" already exists for this tenant`,
        );
      }
      throw err;
    }
  }

  /**
   * Updates Product.currentPrice AND appends a ProductPriceHistory row in
   * the same transaction (STORY-007) — the two must never observably
   * diverge (a reader seeing the new price with no matching history row, or
   * vice versa). Both operations are independent given the already-known
   * productId/price, so the array form of $transaction (a single batched
   * round-trip) is sufficient — no need for the interactive/callback form.
   */
  async updatePrice(
    tenantId: number,
    productId: number,
    dto: UpdatePriceDto,
    changedBy?: number,
  ): Promise<ProductResponse> {
    await this.assertProductExists(tenantId, productId);

    const [product] = await this.prisma.$transaction([
      this.prisma.product.update({
        where: { productId },
        data: { currentPrice: dto.price },
      }),
      this.prisma.productPriceHistory.create({
        data: {
          productId,
          price: dto.price,
          changedBy: changedBy ?? null,
        },
      }),
    ]);

    return mapProduct(product);
  }

  async getPriceHistory(
    tenantId: number,
    productId: number,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<ProductPriceHistoryResponse>> {
    await this.assertProductExists(tenantId, productId);

    const page = query.page ?? 1;
    const perPage = query.per_page ?? 25;
    const skip = (page - 1) * perPage;

    const [data, total] = await Promise.all([
      this.prisma.productPriceHistory.findMany({
        where: { productId },
        skip,
        take: perPage,
        orderBy: { effectiveFrom: 'desc' },
      }),
      this.prisma.productPriceHistory.count({ where: { productId } }),
    ]);

    return {
      data: data.map(mapPriceHistory),
      meta: {
        total,
        page,
        per_page: perPage,
        total_pages: Math.ceil(total / perPage),
      },
    };
  }
}
