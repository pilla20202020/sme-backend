import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersController } from './users.controller';
import { TenantUsersController } from './tenant-users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [UsersController, TenantUsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
