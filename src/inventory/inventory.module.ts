import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { InventoryAlertsService } from './inventory-alerts.service';
import { InventoryController } from './inventory.controller';
import { InventoryMovementsService } from './inventory-movements.service';
import { ProductInventoryController } from './product-inventory.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [InventoryController, ProductInventoryController],
  providers: [InventoryMovementsService, InventoryAlertsService],
  exports: [InventoryMovementsService, InventoryAlertsService],
})
export class InventoryModule {}
