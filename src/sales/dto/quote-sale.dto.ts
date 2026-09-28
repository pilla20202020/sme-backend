import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { SaleLineItemDto } from './sale-line-item.dto';

export class QuoteSaleDto {
  // At least one line — an empty quote is meaningless (same convention as
  // CreatePurchaseOrderDto.lines / CreateStockReceiptDto.lines).
  @IsArray()
  @ArrayMinSize(1, { message: 'lines must contain at least 1 element' })
  @ValidateNested({ each: true })
  @Type(() => SaleLineItemDto)
  lines!: SaleLineItemDto[];
}
