import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RolesGuard, TenantScopeGuard } from '../auth/guards';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

describe('ProductsController (guard integration)', () => {
  let app: INestApplication<App>;

  const mockProductsService = {
    create: jest.fn().mockResolvedValue({ productId: 1, tenantId: 1 }),
    findById: jest.fn().mockResolvedValue({ productId: 1, tenantId: 1 }),
    findAll: jest.fn().mockResolvedValue({ data: [], meta: {} }),
    update: jest.fn().mockResolvedValue({ productId: 1, tenantId: 1 }),
    updatePrice: jest.fn().mockResolvedValue({ productId: 1, tenantId: 1 }),
    getPriceHistory: jest.fn().mockResolvedValue({ data: [], meta: {} }),
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
      controllers: [ProductsController],
      providers: [
        { provide: ProductsService, useValue: mockProductsService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: APP_GUARD, useClass: TenantScopeGuard },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    // Mirrors main.ts's global ValidationPipe so AC-3 (currentPrice rejected
    // on PATCH) is verified for real, not just by inspecting the DTO shape.
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects POST /tenants/:tenantId/products with no auth cookie', async () => {
    await request(app.getHttpServer())
      .post('/tenants/1/products')
      .send({ name: 'Paracetamol', unit: 'tablet', currentPrice: 1.5 })
      .expect(401);

    expect(mockProductsService.create).not.toHaveBeenCalled();
  });

  it('rejects POST /tenants/:tenantId/products for an admin missing catalog:create', async () => {
    asAdmin([]);

    await request(app.getHttpServer())
      .post('/tenants/1/products')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({ name: 'Paracetamol', unit: 'tablet', currentPrice: 1.5 })
      .expect(403);

    expect(mockProductsService.create).not.toHaveBeenCalled();
  });

  it('allows POST /tenants/:tenantId/products for an admin with catalog:create', async () => {
    asAdmin(['catalog:create']);

    await request(app.getHttpServer())
      .post('/tenants/1/products')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({ name: 'Paracetamol', unit: 'tablet', currentPrice: 1.5 })
      .expect(201);

    expect(mockProductsService.create).toHaveBeenCalledWith(1, {
      name: 'Paracetamol',
      unit: 'tablet',
      currentPrice: 1.5,
    });
  });

  it('allows GET /tenants/:tenantId/products/:productId for an admin with catalog:read', async () => {
    asAdmin(['catalog:read']);

    await request(app.getHttpServer())
      .get('/tenants/1/products/1')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(200);

    expect(mockProductsService.findById).toHaveBeenCalledWith(1, 1);
  });

  it('allows GET /tenants/:tenantId/products for an admin with catalog:read', async () => {
    asAdmin(['catalog:read']);

    await request(app.getHttpServer())
      .get('/tenants/1/products')
      .set('Cookie', 'uw_access_token=fake-token')
      .query({ categoryId: 2 })
      .expect(200);

    expect(mockProductsService.findAll).toHaveBeenCalledWith(
      1,
      expect.objectContaining({}) as never,
      2,
      undefined,
    );
  });

  it('allows GET /tenants/:tenantId/products with a search filter for an admin with catalog:read', async () => {
    asAdmin(['catalog:read']);

    await request(app.getHttpServer())
      .get('/tenants/1/products')
      .set('Cookie', 'uw_access_token=fake-token')
      .query({ search: 'para' })
      .expect(200);

    expect(mockProductsService.findAll).toHaveBeenCalledWith(
      1,
      expect.objectContaining({}) as never,
      undefined,
      'para',
    );
  });

  it('rejects PATCH /tenants/:tenantId/products/:productId with no auth cookie', async () => {
    await request(app.getHttpServer())
      .patch('/tenants/1/products/1')
      .send({ name: 'New Name' })
      .expect(401);

    expect(mockProductsService.update).not.toHaveBeenCalled();
  });

  it('rejects PATCH for an admin missing catalog:update', async () => {
    asAdmin([]);

    await request(app.getHttpServer())
      .patch('/tenants/1/products/1')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({ name: 'New Name' })
      .expect(403);

    expect(mockProductsService.update).not.toHaveBeenCalled();
  });

  it('allows PATCH with an authorized field', async () => {
    asAdmin(['catalog:update']);

    await request(app.getHttpServer())
      .patch('/tenants/1/products/1')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({ name: 'New Name' })
      .expect(200);

    expect(mockProductsService.update).toHaveBeenCalledWith(1, 1, {
      name: 'New Name',
    });
  });

  it('rejects PATCH with 400 when the body includes currentPrice (AC-3)', async () => {
    asAdmin(['catalog:update']);

    await request(app.getHttpServer())
      .patch('/tenants/1/products/1')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({ name: 'New Name', currentPrice: 999 })
      .expect(400);

    expect(mockProductsService.update).not.toHaveBeenCalled();
  });

  it('allows PUT .../price for an admin with catalog:update', async () => {
    asAdmin(['catalog:update']);

    await request(app.getHttpServer())
      .put('/tenants/1/products/1/price')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({ price: 2.25 })
      .expect(200);

    expect(mockProductsService.updatePrice).toHaveBeenCalledWith(
      1,
      1,
      { price: 2.25 },
      1,
    );
  });

  it('rejects PUT .../price for an admin missing catalog:update', async () => {
    asAdmin([]);

    await request(app.getHttpServer())
      .put('/tenants/1/products/1/price')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({ price: 2.25 })
      .expect(403);

    expect(mockProductsService.updatePrice).not.toHaveBeenCalled();
  });

  it('allows GET .../price-history for an admin with catalog:read', async () => {
    asAdmin(['catalog:read']);

    await request(app.getHttpServer())
      .get('/tenants/1/products/1/price-history')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(200);

    expect(mockProductsService.getPriceHistory).toHaveBeenCalledTimes(1);
  });
});
