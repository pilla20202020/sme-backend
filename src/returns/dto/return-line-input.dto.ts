import { IsInt, IsNumber, IsOptional, IsPositive, Min } from 'class-validator';

/**
 * One shape covers both branches of POST /returns (PRD §4/§5) — which
 * fields are actually required depends on whether the request's `saleId`
 * is present (matched case: only `saleLineBatchAllocationId` + `quantity`
 * are used) or absent (override case: `productId`/`productBatchId`/
 * `unitPrice` + `quantity` are used instead). ReturnsService enforces that
 * branch-dependent requiredness with a 400 — a single DTO class can't
 * express "required only when a sibling field on the parent is null"
 * without a parent-aware validator, so this class intentionally leaves
 * every field but `quantity` optional at the class-validator layer.
 */
export class ReturnLineInputDto {
  // Matched case only.
  @IsOptional()
  @IsInt()
  saleLineBatchAllocationId?: number;

  // Override case only.
  @IsOptional()
  @IsInt()
  productId?: number;

  @IsOptional()
  @IsInt()
  productBatchId?: number;

  // Override case only — frozen at refund time by the caller (there is no
  // original SaleLine.unitPrice to default to when there's no original sale).
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  unitPrice?: number;

  @IsInt()
  @Min(1)
  quantity!: number;
}
