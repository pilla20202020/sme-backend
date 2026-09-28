import { ApiPropertyOptional } from '@nestjs/swagger';
import { InventoryMovementType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

// Shared by both the tenant-level movements endpoint and the product-scoped
// one (PRD STORY-015). `productId` is only meaningful on the tenant-level
// route — the product-scoped route already has productId from the path and
// simply ignores this field if present, same tolerance ListProductsQueryDto
// affords an unused declared field.
export class ListInventoryMovementsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter to a single product' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  productId?: number;

  @ApiPropertyOptional({ enum: InventoryMovementType })
  @IsOptional()
  @IsEnum(InventoryMovementType)
  movementType?: InventoryMovementType;

  @ApiPropertyOptional({
    description: 'ISO date/datetime, inclusive lower bound on occurredAt',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'ISO date/datetime, inclusive upper bound on occurredAt',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
