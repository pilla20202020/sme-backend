import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CreateStockReceiptLineDto } from './create-stock-receipt-line.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : (value as string);

export class CreateStockReceiptDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'lines must contain at least 1 element' })
  @ValidateNested({ each: true })
  @Type(() => CreateStockReceiptLineDto)
  lines!: CreateStockReceiptLineDto[];
}
