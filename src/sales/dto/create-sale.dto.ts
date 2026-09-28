import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { SaleLineItemDto } from './sale-line-item.dto';

export class CreateSaleDto {
  @IsOptional()
  @IsInt()
  customerId?: number;

  // A checkout with zero line items is meaningless — reject with 400 at the
  // validation layer, same convention as CreatePurchaseOrderDto.lines.
  @IsArray()
  @ArrayMinSize(1, { message: 'lines must contain at least 1 element' })
  @ValidateNested({ each: true })
  @Type(() => SaleLineItemDto)
  lines!: SaleLineItemDto[];
}
