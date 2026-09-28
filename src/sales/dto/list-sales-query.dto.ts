import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

// Mirrors ListInventoryMovementsQueryDto's exact dateFrom/dateTo convention
// (PRD STORY-028 §5 — "matching the exact DTO/filter pattern already used by
// ListInventoryMovementsQueryDto").
export class ListSalesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'ISO date/datetime, inclusive lower bound on saleDate',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'ISO date/datetime, inclusive upper bound on saleDate',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
