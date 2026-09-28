import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard, PermissionsGuard, TenantScopeGuard } from './auth/guards';
import { AuditInterceptor } from './audit/audit.interceptor';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { TenantsModule } from './tenants/tenants.module';
import { BranchesModule } from './branches/branches.module';
import { CatalogModule } from './catalog/catalog.module';
import { CustomersModule } from './customers/customers.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { PurchasingModule } from './purchasing/purchasing.module';
import { InventoryModule } from './inventory/inventory.module';
import { SalesModule } from './sales/sales.module';
import { ReturnsModule } from './returns/returns.module';
import { ExpensesModule } from './expenses/expenses.module';
import { CashModule } from './cash/cash.module';
import { JobQueueModule } from './job-queue/job-queue.module';
import { AuditModule } from './audit/audit.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    PrismaModule,
    JobQueueModule,
    UsersModule,
    AuthModule,
    TenantsModule,
    BranchesModule,
    CatalogModule,
    CustomersModule,
    SuppliersModule,
    PurchasingModule,
    InventoryModule,
    SalesModule,
    ReturnsModule,
    ExpensesModule,
    CashModule,
    AuditModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: TenantScopeGuard },
    // Registered here (not inside AuditModule) so it's applied globally via
    // APP_INTERCEPTOR, same convention as the guards above. Ordering
    // relative to TransformInterceptor (app.useGlobalInterceptors() in
    // main.ts, applied AFTER NestFactory.create() finishes scanning this
    // module) is load-bearing — see audit.interceptor.ts's doc comment.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
