import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

// Extends (rather than sits alongside) PaginationQueryDto because @Query()
// with no key binds the WHOLE query string object to a single DTO instance
// — a second separately-typed @Query('categoryId') parameter would be
// validated against PaginationQueryDto's own whitelist and rejected by the
// global ValidationPipe's forbidNonWhitelisted:true, since categoryId isn't
// one of ITS declared fields even though it's a real, intentional filter.
export class ListProductsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 2,
    description: 'Filter to products in this category',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  // SPRINT-008 addition — additive to `categoryId` (both may be supplied
  // together, AND not OR, mirroring ListPurchaseOrdersQueryDto's
  // dateFrom/dateTo convention). Case-insensitive match against Product.name
  // OR Product.sku, applied in the service via Prisma `contains`/`mode:
  // 'insensitive'`.
  @ApiPropertyOptional({
    example: 'para',
    description: 'Case-insensitive filter matching Product.name OR Product.sku',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
