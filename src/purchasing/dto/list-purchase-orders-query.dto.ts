import { ApiPropertyOptional } from '@nestjs/swagger';
import { PurchaseOrderStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListPurchaseOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: PurchaseOrderStatus,
    description: 'Optional status filter',
  })
  @IsOptional()
  @IsEnum(PurchaseOrderStatus)
  status?: PurchaseOrderStatus;

  // STORY-028 addition — additive to `status` (both may be supplied together,
  // AND not OR), mirroring ListInventoryMovementsQueryDto's dateFrom/dateTo
  // convention exactly, filtered against PurchaseOrder.orderDate.
  @ApiPropertyOptional({
    description: 'ISO date/datetime, inclusive lower bound on orderDate',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'ISO date/datetime, inclusive upper bound on orderDate',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
