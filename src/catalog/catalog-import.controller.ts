import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Permissions } from '../auth/decorators';
import { AuditAction } from '../audit/audit-action.decorator';
import { CatalogImportService } from './catalog-import.service';
import { ImportResult } from './catalog-import.interface';

// Tenant scoping is enforced globally by TenantScopeGuard (APP_GUARD, see
// app.module.ts) — not opt-in here (STORY-004 / PRD NF-05).
//
// The `rows` body is deliberately typed `unknown`, NOT a DTO class, so the
// global ValidationPipe (whitelist + forbidNonWhitelisted, main.ts) never
// runs class-validator against it and never rejects the whole request just
// because one row is bad — see CatalogImportService for why that matters
// (FR-06/AC-1: one bad row must never abort the rest of the import). Each
// row is validated independently, inside the service, instead.
@ApiTags('Catalog Import')
@ApiCookieAuth('uw_access_token')
@Controller({ version: '1', path: 'tenants/:tenantId/products' })
export class CatalogImportController {
  constructor(private readonly catalogImportService: CatalogImportService) {}

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog:create')
  @AuditAction('catalog.bulk_import', 'Product')
  @ApiOperation({
    summary:
      'Bulk-import products from a JSON array of rows: name, sku, categoryName, unit, currentPrice, reorderThreshold. Every row is validated and processed independently.',
  })
  @ApiResponse({
    status: 200,
    description: 'Import summary: created/updated counts and per-row failures',
  })
  @ApiResponse({ status: 400, description: 'Request body is not a JSON array' })
  importProducts(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Body() rows: unknown,
  ): Promise<ImportResult> {
    return this.catalogImportService.importProducts(tenantId, rows);
  }
}
