import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

// Same filter-DTO shape as ListInventoryMovementsQueryDto (STORY-015/025).
export class ListExpensesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter to a single branch' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  branchId?: number;

  @ApiPropertyOptional({ description: 'Filter to an exact category match' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    description: 'ISO date, inclusive lower bound on expenseDate',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'ISO date, inclusive upper bound on expenseDate',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
