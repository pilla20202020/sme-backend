import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RolesGuard, TenantScopeGuard } from '../auth/guards';
import { TenantUsersController } from './tenant-users.controller';
import { UsersService } from './users.service';

describe('TenantUsersController (guard integration)', () => {
  let app: INestApplication<App>;

  const mockUsersService = {
    inviteToTenant: jest.fn().mockResolvedValue({ userId: 2, tenantId: 1 }),
    findAllByTenant: jest.fn().mockResolvedValue({ data: [], meta: {} }),
  };

  const mockAuthService = {
    decodeToken: jest.fn(),
    verifyAccessToken: jest.fn(),
    resolveUser: jest.fn(),
  };

  const asAdmin = (permissions: string[]) => {
    mockAuthService.decodeToken.mockReturnValue({ sub: '1' });
    mockAuthService.verifyAccessToken.mockResolvedValue({ sub: '1' });
    mockAuthService.resolveUser.mockResolvedValue({
      userId: 1,
      email: 'admin@example.com',
      firstName: 'Admin',
      lastName: 'User',
      roles: ['admin'],
      permissions,
    });
  };

  // A non-admin caller belonging to a DIFFERENT tenant than the one in the
  // path — exercises TenantScopeGuard's actual reject branch (STORY-004 QA
  // finding: every prior test here used roles:['admin'], which bypasses the
  // guard entirely and never proved it rejects a mismatched tenant).
  const asOwnerOfOtherTenant = (permissions: string[]) => {
    mockAuthService.decodeToken.mockReturnValue({ sub: '2' });
    mockAuthService.verifyAccessToken.mockResolvedValue({ sub: '2' });
    mockAuthService.resolveUser.mockResolvedValue({
      userId: 2,
      tenantId: 999,
      email: 'owner@example.com',
      firstName: 'Owner',
      lastName: 'Person',
      roles: ['owner'],
      permissions,
    });
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [TenantUsersController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: APP_GUARD, useClass: TenantScopeGuard },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects POST /tenants/:tenantId/users with no auth cookie', async () => {
    await request(app.getHttpServer())
      .post('/tenants/1/users')
      .send({
        email: 'staff@example.com',
        firstName: 'Staff',
        lastName: 'Member',
        roleName: 'manager',
      })
      .expect(401);

    expect(mockUsersService.inviteToTenant).not.toHaveBeenCalled();
  });

  it('rejects POST /tenants/:tenantId/users for an admin missing user:create', async () => {
    asAdmin([]);

    await request(app.getHttpServer())
      .post('/tenants/1/users')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({
        email: 'staff@example.com',
        firstName: 'Staff',
        lastName: 'Member',
        roleName: 'manager',
      })
      .expect(403);

    expect(mockUsersService.inviteToTenant).not.toHaveBeenCalled();
  });

  it('allows POST /tenants/:tenantId/users for an admin with user:create', async () => {
    asAdmin(['user:create']);

    await request(app.getHttpServer())
      .post('/tenants/1/users')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({
        email: 'staff@example.com',
        firstName: 'Staff',
        lastName: 'Member',
        roleName: 'manager',
        password: 'Sup3rSecret!',
      })
      .expect(201);

    expect(mockUsersService.inviteToTenant).toHaveBeenCalledWith(1, {
      email: 'staff@example.com',
      firstName: 'Staff',
      lastName: 'Member',
      roleName: 'manager',
      password: 'Sup3rSecret!',
    });
  });

  it('rejects an invite with a non-tenant-assignable role (e.g. admin)', async () => {
    asAdmin(['user:create']);

    await request(app.getHttpServer())
      .post('/tenants/1/users')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({
        email: 'staff@example.com',
        firstName: 'Staff',
        lastName: 'Member',
        roleName: 'admin',
        password: 'Sup3rSecret!',
      })
      .expect(400);

    expect(mockUsersService.inviteToTenant).not.toHaveBeenCalled();
  });

  it('rejects an invite with too short a password', async () => {
    asAdmin(['user:create']);

    await request(app.getHttpServer())
      .post('/tenants/1/users')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({
        email: 'staff@example.com',
        firstName: 'Staff',
        lastName: 'Member',
        roleName: 'manager',
        password: 'short',
      })
      .expect(400);

    expect(mockUsersService.inviteToTenant).not.toHaveBeenCalled();
  });

  it('rejects GET /tenants/:tenantId/users with no auth cookie', async () => {
    await request(app.getHttpServer()).get('/tenants/1/users').expect(401);

    expect(mockUsersService.findAllByTenant).not.toHaveBeenCalled();
  });

  it('allows GET /tenants/:tenantId/users for an admin with user:read', async () => {
    asAdmin(['user:read']);

    await request(app.getHttpServer())
      .get('/tenants/1/users')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(200);

    expect(mockUsersService.findAllByTenant).toHaveBeenCalledTimes(1);
  });

  it('rejects GET /tenants/:tenantId/users for an owner of a DIFFERENT tenant, even with user:read', async () => {
    asOwnerOfOtherTenant(['user:read', 'user:create']);

    await request(app.getHttpServer())
      .get('/tenants/1/users')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(403);

    expect(mockUsersService.findAllByTenant).not.toHaveBeenCalled();
  });

  it('rejects POST /tenants/:tenantId/users for an owner of a DIFFERENT tenant, even with user:create', async () => {
    asOwnerOfOtherTenant(['user:read', 'user:create']);

    await request(app.getHttpServer())
      .post('/tenants/1/users')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({
        email: 'staff@example.com',
        firstName: 'Staff',
        lastName: 'Member',
        roleName: 'manager',
        password: 'Sup3rSecret!',
      })
      .expect(403);

    expect(mockUsersService.inviteToTenant).not.toHaveBeenCalled();
  });
});
