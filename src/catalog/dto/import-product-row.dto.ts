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

function trimOrUndefined({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Shape of one row of a bulk catalog import (STORY-009). Deliberately never
 * bound directly via a controller `@Body()` — the global ValidationPipe
 * would reject the *entire* request on the first invalid row, which is
 * exactly what FR-06/AC-1 forbids ("one bad row must never abort the whole
 * import"). Instead CatalogImportService validates each row against this
 * DTO independently via class-validator's `validate()`, collecting
 * per-row errors without throwing.
 */
export class ImportProductRowDto {
  @Transform(trimOrPassthrough)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @Transform(trimOrUndefined)
  @IsString()
  @MaxLength(100)
  sku?: string;

  @IsOptional()
  @Transform(trimOrUndefined)
  @IsString()
  @MaxLength(150)
  categoryName?: string;

  @IsEnum(ProductUnit)
  unit!: ProductUnit;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  currentPrice!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reorderThreshold?: number;
}
