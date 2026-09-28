import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogImportController } from './catalog-import.controller';
import { CatalogImportService } from './catalog-import.service';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { ProductBatchesController } from './product-batches.controller';
import { ProductBatchesService } from './product-batches.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [
    CategoriesController,
    ProductsController,
    ProductBatchesController,
    CatalogImportController,
  ],
  providers: [
    CategoriesService,
    ProductsService,
    ProductBatchesService,
    CatalogImportService,
  ],
  exports: [CategoriesService, ProductsService, ProductBatchesService],
})
export class CatalogModule {}
