import { ProductUnit } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';

function trimOrPassthrough({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

// An empty/whitespace-only sku after trimming is treated as "no sku" rather
// than a literal empty string — otherwise every sku-less product imported
// this way would collide on the tenant's @@unique([tenantId, sku]) instead
// of being treated as distinct NULLs (PRD business rule).
function trimSkuOrUndefined({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export class CreateProductDto {
  @Transform(trimOrPassthrough)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @Transform(trimSkuOrUndefined)
  @IsString()
  @MaxLength(100)
  sku?: string;

  @IsEnum(ProductUnit)
  unit!: ProductUnit;

  @IsOptional()
  @IsInt()
  categoryId?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  currentPrice!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reorderThreshold?: number;
}
