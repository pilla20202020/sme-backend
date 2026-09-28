import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesService } from './categories.service';
import { ImportResult } from './catalog-import.interface';
import { ImportProductRowDto } from './dto/import-product-row.dto';

@Injectable()
export class CatalogImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categoriesService: CategoriesService,
  ) {}

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
   * Bulk catalog import (STORY-009). `rawRows` is intentionally untyped at
   * the controller boundary — see CatalogImportController's comment — so
   * every row is validated and processed here, independently, one at a
   * time. A bad row is recorded in `failed` and the loop moves on; it never
   * aborts the rows around it (PRD FR-06/AC-1).
   *
   * `categoryName` is looked up case-insensitively within the tenant and
   * auto-created if it doesn't exist yet (AC-3) — bulk import must not force
   * the owner to pre-create every category by hand.
   *
   * A row whose `sku` matches an existing product in this tenant updates
   * that product (counted as `updated`); every other row creates a new
   * product (counted as `created`). Rows with no sku always create, since
   * there is nothing to match an existing product against.
   */
  async importProducts(
    tenantId: number,
    rawRows: unknown,
  ): Promise<ImportResult> {
    if (!Array.isArray(rawRows)) {
      throw new BadRequestException(
        'Request body must be a JSON array of product rows',
      );
    }

    await this.assertTenantExists(tenantId);

    const result: ImportResult = { created: 0, updated: 0, failed: [] };

    for (let index = 0; index < rawRows.length; index++) {
      const rowNumber = index + 1;
      const rawRow: unknown = rawRows[index];

      if (typeof rawRow !== 'object' || rawRow === null) {
        result.failed.push({
          row: rowNumber,
          errors: ['Row must be an object'],
        });
        continue;
      }

      const dto = plainToInstance(
        ImportProductRowDto,
        rawRow as Record<string, unknown>,
      );
      const validationErrors = await validate(dto);
      if (validationErrors.length > 0) {
        result.failed.push({
          row: rowNumber,
          errors: validationErrors.flatMap((e) =>
            Object.values(e.constraints ?? {}),
          ),
        });
        continue;
      }

      try {
        let categoryId: number | undefined;
        if (dto.categoryName) {
          const category = await this.categoriesService.findOrCreateByName(
            tenantId,
            dto.categoryName,
          );
          categoryId = category.categoryId;
        }

        const existing = dto.sku
          ? await this.prisma.product.findFirst({
              where: { tenantId, sku: dto.sku },
              select: { productId: true, currentPrice: true },
            })
          : null;

        if (existing) {
          await this.updateExistingProduct(existing, dto, categoryId);
          result.updated++;
        } else {
          await this.prisma.product.create({
            data: {
              tenantId,
              categoryId: categoryId ?? null,
              name: dto.name,
              sku: dto.sku ?? null,
              unit: dto.unit,
              currentPrice: dto.currentPrice,
              reorderThreshold: dto.reorderThreshold ?? null,
            },
          });
          result.created++;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        result.failed.push({ row: rowNumber, errors: [message] });
      }
    }

    return result;
  }

  private async updateExistingProduct(
    existing: { productId: number; currentPrice: { toNumber(): number } },
    dto: ImportProductRowDto,
    categoryId: number | undefined,
  ): Promise<void> {
    const priceChanged = existing.currentPrice.toNumber() !== dto.currentPrice;

    // categoryId/reorderThreshold are only included when this row actually
    // specified them — an import row is a partial update like PATCH, not a
    // full replace. Unconditionally writing `?? null` here previously wiped
    // an existing product's category/threshold on any re-import row that
    // simply omitted those optional columns (found in QA review of
    // STORY-009 — see impl-notes for the fix).
    const baseUpdate = {
      name: dto.name,
      unit: dto.unit,
      ...(categoryId !== undefined && { categoryId }),
      ...(dto.reorderThreshold !== undefined && {
        reorderThreshold: dto.reorderThreshold,
      }),
    };

    if (!priceChanged) {
      await this.prisma.product.update({
        where: { productId: existing.productId },
        data: baseUpdate,
      });
      return;
    }

    // Route price changes made during import through the same
    // update+history invariant as the dedicated pricing endpoint (STORY-007)
    // — currentPrice must never change without a matching history row.
    await this.prisma.$transaction([
      this.prisma.product.update({
        where: { productId: existing.productId },
        data: { ...baseUpdate, currentPrice: dto.currentPrice },
      }),
      this.prisma.productPriceHistory.create({
        data: { productId: existing.productId, price: dto.currentPrice },
      }),
    ]);
  }
}
