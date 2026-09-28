import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListAuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter to audit rows written by this actor userId',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  actorUserId?: number;

  @ApiPropertyOptional({
    description:
      'Filter to audit rows for this exact action (e.g. "product.create")',
  })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({
    description: 'Only rows created at or after this ISO 8601 date/time',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    description: 'Only rows created at or before this ISO 8601 date/time',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
