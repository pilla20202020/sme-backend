import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { StockReceiptsController } from './stock-receipts.controller';
import { StockReceiptsService } from './stock-receipts.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PurchaseOrdersController, StockReceiptsController],
  providers: [PurchaseOrdersService, StockReceiptsService],
  exports: [PurchaseOrdersService, StockReceiptsService],
})
export class PurchasingModule {}
