import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RolesGuard, TenantScopeGuard } from '../auth/guards';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';

describe('PurchaseOrdersController (guard integration)', () => {
  let app: INestApplication<App>;

  const mockPurchaseOrdersService = {
    create: jest.fn().mockResolvedValue({ purchaseOrderId: 1, tenantId: 1 }),
    findById: jest.fn().mockResolvedValue({ purchaseOrderId: 1, tenantId: 1 }),
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

  const validPoBody = {
    supplierId: 1,
    lines: [{ productId: 1, quantityOrdered: 10, unitCost: 8.5 }],
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [PurchaseOrdersController],
      providers: [
        { provide: PurchaseOrdersService, useValue: mockPurchaseOrdersService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: APP_GUARD, useClass: TenantScopeGuard },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    // Mirrors main.ts's global ValidationPipe so the empty-lines rejection
    // (AC-3) is verified for real, not just by inspecting the DTO shape.
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

  it('rejects POST /tenants/:tenantId/purchase-orders with no auth cookie', async () => {
    await request(app.getHttpServer())
      .post('/tenants/1/purchase-orders')
      .send(validPoBody)
      .expect(401);

    expect(mockPurchaseOrdersService.create).not.toHaveBeenCalled();
  });

  it('rejects POST for an admin missing purchasing:create', async () => {
    asAdmin([]);

    await request(app.getHttpServer())
      .post('/tenants/1/purchase-orders')
      .set('Cookie', 'uw_access_token=fake-token')
      .send(validPoBody)
      .expect(403);

    expect(mockPurchaseOrdersService.create).not.toHaveBeenCalled();
  });

  it('allows POST for an admin with purchasing:create', async () => {
    asAdmin(['purchasing:create']);

    await request(app.getHttpServer())
      .post('/tenants/1/purchase-orders')
      .set('Cookie', 'uw_access_token=fake-token')
      .send(validPoBody)
      .expect(201);

    expect(mockPurchaseOrdersService.create).toHaveBeenCalledWith(
      1,
      validPoBody,
      1,
    );
  });

  it('rejects POST with 400 when lines is empty (AC-3)', async () => {
    asAdmin(['purchasing:create']);

    await request(app.getHttpServer())
      .post('/tenants/1/purchase-orders')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({ supplierId: 1, lines: [] })
      .expect(400);

    expect(mockPurchaseOrdersService.create).not.toHaveBeenCalled();
  });

  it('rejects GET /tenants/:tenantId/purchase-orders/:id with no auth cookie', async () => {
    await request(app.getHttpServer())
      .get('/tenants/1/purchase-orders/1')
      .expect(401);

    expect(mockPurchaseOrdersService.findById).not.toHaveBeenCalled();
  });

  it('allows GET .../:id for an admin with purchasing:read', async () => {
    asAdmin(['purchasing:read']);

    await request(app.getHttpServer())
      .get('/tenants/1/purchase-orders/1')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(200);

    expect(mockPurchaseOrdersService.findById).toHaveBeenCalledWith(1, 1);
  });

  it('allows GET (list) for an admin with purchasing:read, forwarding a status filter', async () => {
    asAdmin(['purchasing:read']);

    await request(app.getHttpServer())
      .get('/tenants/1/purchase-orders')
      .set('Cookie', 'uw_access_token=fake-token')
      .query({ status: 'pending' })
      .expect(200);

    expect(mockPurchaseOrdersService.findAll).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: 'pending' }) as never,
      'pending',
    );
  });

  it('allows GET (list) for an admin with purchasing:read, forwarding dateFrom/dateTo (STORY-028)', async () => {
    asAdmin(['purchasing:read']);

    await request(app.getHttpServer())
      .get('/tenants/1/purchase-orders')
      .set('Cookie', 'uw_access_token=fake-token')
      .query({ dateFrom: '2026-01-01', dateTo: '2026-01-31' })
      .expect(200);

    expect(mockPurchaseOrdersService.findAll).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
      }) as never,
      undefined,
    );
  });

  it('rejects GET (list) for an admin missing purchasing:read', async () => {
    asAdmin([]);

    await request(app.getHttpServer())
      .get('/tenants/1/purchase-orders')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(403);

    expect(mockPurchaseOrdersService.findAll).not.toHaveBeenCalled();
  });

  it('rejects a request for a tenant the caller does not belong to', async () => {
    mockAuthService.decodeToken.mockReturnValue({ sub: '1' });
    mockAuthService.verifyAccessToken.mockResolvedValue({ sub: '1' });
    mockAuthService.resolveUser.mockResolvedValue({
      userId: 1,
      tenantId: 2,
      email: 'manager@example.com',
      firstName: 'Manager',
      lastName: 'User',
      roles: ['manager'],
      permissions: ['purchasing:read'],
    });

    await request(app.getHttpServer())
      .get('/tenants/1/purchase-orders')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(403);

    expect(mockPurchaseOrdersService.findAll).not.toHaveBeenCalled();
  });
});
