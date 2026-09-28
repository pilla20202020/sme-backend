import { ProductUnit } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';

function trimOrPassthrough({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function trimSkuOrUndefined({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

// currentPrice is deliberately NOT declared anywhere on this DTO. It must
// only ever be written through the dedicated PUT .../price endpoint (which
// also appends a ProductPriceHistory row) — the global ValidationPipe's
// forbidNonWhitelisted:true rejects a body containing it with 400, for free,
// the same mechanism already protecting Tenant.batchExpiryTrackingEnabled.
export class UpdateProductDto {
  @IsOptional()
  @Transform(trimOrPassthrough)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @Transform(trimSkuOrUndefined)
  @IsString()
  @MaxLength(100)
  sku?: string;

  @IsOptional()
  @IsEnum(ProductUnit)
  unit?: ProductUnit;

  @IsOptional()
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reorderThreshold?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
