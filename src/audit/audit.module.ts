import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogService } from './audit-log.service';

// AuditInterceptor itself is registered as an APP_INTERCEPTOR directly in
// app.module.ts (not here) — mirroring how RolesGuard/PermissionsGuard/
// TenantScopeGuard are registered directly on AppModule rather than inside
// their owning feature module, and because its ordering relative to
// TransformInterceptor (registered via app.useGlobalInterceptors() in
// main.ts) is a load-bearing detail worth keeping visible at the app root
// (see audit.interceptor.ts's doc comment for the full reasoning).
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AuditLogsController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
