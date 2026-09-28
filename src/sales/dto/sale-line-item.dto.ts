import { IsInt, Min } from 'class-validator';

// Shared shape for both the quote endpoint (STORY-019, no writes) and the
// checkout endpoint (STORY-020) — a quote is a dry-run of the same request
// shape as an actual sale, not a separate DTO.
export class SaleLineItemDto {
  @IsInt()
  productId!: number;

  @IsInt()
  @Min(1)
  quantity!: number;
}
