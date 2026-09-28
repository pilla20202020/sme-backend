import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { formatDateMDY } from '../common/utils/date-format.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CategoryResponse, PaginatedResult } from './categories.interface';

type RawCategory = Prisma.CategoryGetPayload<Record<string, never>>;

function mapCategory(category: RawCategory): CategoryResponse {
  return {
    categoryId: category.categoryId,
    tenantId: category.tenantId,
    name: category.name,
    isActive: category.isActive,
    createdAt: formatDateMDY(category.createdAt, { includeTime: true }),
    updatedAt: formatDateMDY(category.updatedAt, { includeTime: true }),
  };
}

@Injectable()
export class CategoriesService {
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

  /**
   * Category names are unique per tenant, case-insensitively — Postgres
   * unique constraints are case-sensitive by default, so "Tablets" and
   * "tablets" would otherwise both slip past @@unique([tenantId, name]).
   * This check + the DB constraint together close both the race-free and
   * the concurrent-insert cases (a genuine race still resolves via the P2002
   * catch below).
   */
  async create(
    tenantId: number,
    dto: CreateCategoryDto,
  ): Promise<CategoryResponse> {
    await this.assertTenantExists(tenantId);
    await this.assertNameAvailable(tenantId, dto.name);

    try {
      const category = await this.prisma.category.create({
        data: { tenantId, name: dto.name },
      });
      return mapCategory(category);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `Category "${dto.name}" already exists for this tenant`,
        );
      }
      throw err;
    }
  }

  private async assertNameAvailable(
    tenantId: number,
    name: string,
  ): Promise<void> {
    const existing = await this.prisma.category.findFirst({
      where: { tenantId, name: { equals: name, mode: 'insensitive' } },
      select: { categoryId: true },
    });
    if (existing) {
      throw new ConflictException(
        `Category "${name}" already exists for this tenant`,
      );
    }
  }

  async findAll(
    tenantId: number,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<CategoryResponse>> {
    await this.assertTenantExists(tenantId);

    const page = query.page ?? 1;
    const perPage = query.per_page ?? 25;
    const skip = (page - 1) * perPage;

    const [data, total] = await Promise.all([
      this.prisma.category.findMany({
        where: { tenantId },
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.category.count({ where: { tenantId } }),
    ]);

    return {
      data: data.map(mapCategory),
      meta: {
        total,
        page,
        per_page: perPage,
        total_pages: Math.ceil(total / perPage),
      },
    };
  }

  /**
   * Used by bulk import (STORY-009): looks up a tenant's category by
   * case-insensitive name, creating it automatically if it doesn't exist yet
   * — a bulk import row must never fail just because its category hasn't
   * been pre-created by hand (PRD AC-3).
   */
  async findOrCreateByName(
    tenantId: number,
    name: string,
  ): Promise<{ categoryId: number }> {
    const existing = await this.prisma.category.findFirst({
      where: { tenantId, name: { equals: name, mode: 'insensitive' } },
      select: { categoryId: true },
    });
    if (existing) return existing;

    try {
      return await this.prisma.category.create({
        data: { tenantId, name },
        select: { categoryId: true },
      });
    } catch (err) {
      // Concurrent import rows creating the same brand-new category name at
      // once — fall back to whichever one committed first.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const raceWinner = await this.prisma.category.findFirst({
          where: { tenantId, name: { equals: name, mode: 'insensitive' } },
          select: { categoryId: true },
        });
        if (raceWinner) return raceWinner;
      }
      throw err;
    }
  }
}
