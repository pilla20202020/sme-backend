import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : (value as string);

export class CreateExpenseDto {
  @IsInt()
  branchId!: number;

  // Free text, no fixed taxonomy for MVP (PRD §6/§9) — trimmed before the
  // emptiness check, same convention as CreateInventoryAdjustmentDto.reason.
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'category must not be empty' })
  @MaxLength(100)
  category!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsDateString()
  expenseDate!: string;
}
