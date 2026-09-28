import { IsInt, IsNumber, IsPositive, Min } from 'class-validator';

export class CreatePurchaseOrderLineDto {
  @IsInt()
  productId!: number;

  @IsInt()
  @Min(1)
  quantityOrdered!: number;

  // Frozen at PO creation time — a later change to Product.currentPrice
  // never touches this value (PRD FR-09 AC-2 / STORY-012).
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  unitCost!: number;
}
