import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  NotEquals,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : (value as string);

export class CreateInventoryAdjustmentDto {
  @IsInt()
  productBatchId!: number;

  // Positive (found extra stock) or negative (damage/loss/count correction).
  // Zero is rejected too — it would write a no-op movement row (PRD doesn't
  // say either way; a zero-delta "adjustment" documents nothing and is
  // treated as a validation error rather than a silently-accepted no-op).
  @IsInt()
  @NotEquals(0, { message: 'quantityDelta cannot be zero' })
  quantityDelta!: number;

  // Trimmed before the emptiness check (PRD STORY-016 AC-2: whitespace-only
  // is rejected the same as a truly empty string) — same trim-then-validate
  // pattern as CreateStockReceiptLineDto.batchNumber.
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'reason must not be empty' })
  @MaxLength(2000)
  reason!: string;
}
