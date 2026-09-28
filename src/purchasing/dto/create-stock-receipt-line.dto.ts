import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : (value as string);

export class CreateStockReceiptLineDto {
  @IsInt()
  purchaseOrderLineId!: number;

  @IsInt()
  @Min(1)
  quantityReceived!: number;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  batchNumber!: string;

  // Plain date (no time component) — validated further in the service (must
  // not be in the past, same rule as ProductBatchesService/STORY-008);
  // IsDateString just guards against garbage input.
  @IsDateString()
  expiryDate!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  unitCost!: number;
}
