import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RolesGuard, TenantScopeGuard } from '../auth/guards';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

describe('TenantsController (guard integration)', () => {
  let app: INestApplication<App>;

  const mockTenantsService = {
    register: jest
      .fn()
      .mockResolvedValue({ tenantId: 1, name: 'Test Pharmacy' }),
    findById: jest
      .fn()
      .mockResolvedValue({ tenantId: 1, name: 'Test Pharmacy' }),
    findAll: jest.fn().mockResolvedValue({ data: [], meta: {} }),
  };

  const mockAuthService = {
    decodeToken: jest.fn(),
    verifyAccessToken: jest.fn(),
    resolveUser: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [TenantsController],
      providers: [
        { provide: TenantsService, useValue: mockTenantsService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: APP_GUARD, useClass: TenantScopeGuard },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows POST /tenants with no auth cookie at all (public registration)', async () => {
    await request(app.getHttpServer())
      .post('/tenants')
      .send({ name: 'Test Pharmacy' })
      .expect(201);

    expect(mockTenantsService.register).toHaveBeenCalledTimes(1);
    expect(mockAuthService.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rejects GET /tenants/:id with no auth cookie', async () => {
    await request(app.getHttpServer()).get('/tenants/1').expect(401);
    expect(mockTenantsService.findById).not.toHaveBeenCalled();
  });

  it('rejects GET /tenants/:id for an authenticated caller without the admin role', async () => {
    mockAuthService.decodeToken.mockReturnValue({ sub: '1' });
    mockAuthService.verifyAccessToken.mockResolvedValue({ sub: '1' });
    mockAuthService.resolveUser.mockResolvedValue({
      userId: 1,
      email: 'cashier@example.com',
      firstName: 'Cash',
      lastName: 'Ier',
      roles: ['cashier'],
      permissions: [],
    });

    await request(app.getHttpServer())
      .get('/tenants/1')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(403);

    expect(mockTenantsService.findById).not.toHaveBeenCalled();
  });

  it('rejects GET /tenants/:id for an admin missing the tenant:read permission', async () => {
    mockAuthService.decodeToken.mockReturnValue({ sub: '1' });
    mockAuthService.verifyAccessToken.mockResolvedValue({ sub: '1' });
    mockAuthService.resolveUser.mockResolvedValue({
      userId: 1,
      email: 'admin@example.com',
      firstName: 'Admin',
      lastName: 'User',
      roles: ['admin'],
      permissions: [],
    });

    await request(app.getHttpServer())
      .get('/tenants/1')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(403);

    expect(mockTenantsService.findById).not.toHaveBeenCalled();
  });

  it('allows GET /tenants/:id for an admin with the tenant:read permission', async () => {
    mockAuthService.decodeToken.mockReturnValue({ sub: '1' });
    mockAuthService.verifyAccessToken.mockResolvedValue({ sub: '1' });
    mockAuthService.resolveUser.mockResolvedValue({
      userId: 1,
      email: 'admin@example.com',
      firstName: 'Admin',
      lastName: 'User',
      roles: ['admin'],
      permissions: ['tenant:read'],
    });

    await request(app.getHttpServer())
      .get('/tenants/1')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(200);

    expect(mockTenantsService.findById).toHaveBeenCalledWith(1);
  });

  it('allows GET /tenants for an admin with the tenant:read permission', async () => {
    mockAuthService.decodeToken.mockReturnValue({ sub: '1' });
    mockAuthService.verifyAccessToken.mockResolvedValue({ sub: '1' });
    mockAuthService.resolveUser.mockResolvedValue({
      userId: 1,
      email: 'admin@example.com',
      firstName: 'Admin',
      lastName: 'User',
      roles: ['admin'],
      permissions: ['tenant:read'],
    });

    await request(app.getHttpServer())
      .get('/tenants')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(200);

    expect(mockTenantsService.findAll).toHaveBeenCalledTimes(1);
  });

  it('rejects GET /tenants/:tenantId for an owner of a DIFFERENT tenant, even with tenant:read (TenantScopeGuard)', async () => {
    mockAuthService.decodeToken.mockReturnValue({ sub: '2' });
    mockAuthService.verifyAccessToken.mockResolvedValue({ sub: '2' });
    mockAuthService.resolveUser.mockResolvedValue({
      userId: 2,
      tenantId: 999,
      email: 'owner@example.com',
      firstName: 'Owner',
      lastName: 'Person',
      roles: ['owner'],
      permissions: ['tenant:read'],
    });

    await request(app.getHttpServer())
      .get('/tenants/1')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(403);

    expect(mockTenantsService.findById).not.toHaveBeenCalled();
  });

  it('allows GET /tenants/:tenantId for the owner of that SAME tenant with tenant:read', async () => {
    mockAuthService.decodeToken.mockReturnValue({ sub: '2' });
    mockAuthService.verifyAccessToken.mockResolvedValue({ sub: '2' });
    mockAuthService.resolveUser.mockResolvedValue({
      userId: 2,
      tenantId: 1,
      email: 'owner@example.com',
      firstName: 'Owner',
      lastName: 'Person',
      roles: ['owner'],
      permissions: ['tenant:read'],
    });

    await request(app.getHttpServer())
      .get('/tenants/1')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(200);

    expect(mockTenantsService.findById).toHaveBeenCalledWith(1);
  });
});
