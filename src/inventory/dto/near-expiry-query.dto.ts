import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsPositive } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class NearExpiryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 30,
    default: 30,
    description: 'Alert window in days; must be a positive integer',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  withinDays?: number = 30;
}
