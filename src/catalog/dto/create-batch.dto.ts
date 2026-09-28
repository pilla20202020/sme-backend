import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsString,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateBatchDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : (value as string),
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  batchNumber!: string;

  // Plain date (no time component) — validated further in the service (must
  // not be in the past); IsDateString just guards against garbage input.
  @IsDateString()
  expiryDate!: string;

  @IsInt()
  @Min(1)
  quantityReceived!: number;
}
