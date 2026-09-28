import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CreatePurchaseOrderLineDto } from './create-purchase-order-line.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : (value as string);

export class CreatePurchaseOrderDto {
  @IsInt()
  supplierId!: number;

  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  notes?: string;

  // A PO with zero line items is meaningless (PRD AC-3 / STORY-012) — reject
  // with 400 at the validation layer rather than letting the service create
  // an empty PO.
  @IsArray()
  @ArrayMinSize(1, { message: 'lines must contain at least 1 element' })
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderLineDto)
  lines!: CreatePurchaseOrderLineDto[];
}
