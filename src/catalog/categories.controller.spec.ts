import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RolesGuard, TenantScopeGuard } from '../auth/guards';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

describe('CategoriesController (guard integration)', () => {
  let app: INestApplication<App>;

  const mockCategoriesService = {
    create: jest.fn().mockResolvedValue({ categoryId: 1, tenantId: 1 }),
    findAll: jest.fn().mockResolvedValue({ data: [], meta: {} }),
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

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [CategoriesController],
      providers: [
        { provide: CategoriesService, useValue: mockCategoriesService },
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

  it('rejects POST /tenants/:tenantId/categories with no auth cookie', async () => {
    await request(app.getHttpServer())
      .post('/tenants/1/categories')
      .send({ name: 'Tablets' })
      .expect(401);

    expect(mockCategoriesService.create).not.toHaveBeenCalled();
  });

  it('rejects POST /tenants/:tenantId/categories for an admin missing catalog:create', async () => {
    asAdmin([]);

    await request(app.getHttpServer())
      .post('/tenants/1/categories')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({ name: 'Tablets' })
      .expect(403);

    expect(mockCategoriesService.create).not.toHaveBeenCalled();
  });

  it('allows POST /tenants/:tenantId/categories for an admin with catalog:create', async () => {
    asAdmin(['catalog:create']);

    await request(app.getHttpServer())
      .post('/tenants/1/categories')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({ name: 'Tablets' })
      .expect(201);

    expect(mockCategoriesService.create).toHaveBeenCalledWith(1, {
      name: 'Tablets',
    });
  });

  it('rejects GET /tenants/:tenantId/categories with no auth cookie', async () => {
    await request(app.getHttpServer()).get('/tenants/1/categories').expect(401);

    expect(mockCategoriesService.findAll).not.toHaveBeenCalled();
  });

  it('allows GET /tenants/:tenantId/categories for an admin with catalog:read', async () => {
    asAdmin(['catalog:read']);

    await request(app.getHttpServer())
      .get('/tenants/1/categories')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(200);

    expect(mockCategoriesService.findAll).toHaveBeenCalledTimes(1);
  });

  it('rejects GET /tenants/:tenantId/categories for a tenant the caller does not belong to', async () => {
    mockAuthService.decodeToken.mockReturnValue({ sub: '1' });
    mockAuthService.verifyAccessToken.mockResolvedValue({ sub: '1' });
    mockAuthService.resolveUser.mockResolvedValue({
      userId: 1,
      tenantId: 2,
      email: 'manager@example.com',
      firstName: 'Manager',
      lastName: 'User',
      roles: ['manager'],
      permissions: ['catalog:read'],
    });

    await request(app.getHttpServer())
      .get('/tenants/1/categories')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(403);

    expect(mockCategoriesService.findAll).not.toHaveBeenCalled();
  });
});
