import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RolesGuard, TenantScopeGuard } from '../auth/guards';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

describe('SalesController (guard integration)', () => {
  let app: INestApplication<App>;

  const mockSalesService = {
    quote: jest.fn().mockResolvedValue({
      lines: [],
      subtotal: 0,
      total: 0,
      allSufficient: true,
    }),
    checkout: jest.fn().mockResolvedValue({
      saleId: 1,
      saleDate: '01/01/2026 12:00 PM',
      customer: null,
      cashier: null,
      lines: [],
      subtotal: 0,
      total: 0,
    }),
    getSale: jest.fn().mockResolvedValue({
      saleId: 1,
      saleDate: '01/01/2026 12:00 PM',
      customer: null,
      cashier: null,
      lines: [],
      subtotal: 0,
      total: 0,
    }),
    getReceipt: jest.fn().mockResolvedValue({
      saleId: 1,
      saleDate: '01/01/2026 12:00 PM',
      customer: null,
      cashier: null,
      lines: [],
      subtotal: 0,
      total: 0,
    }),
    findAll: jest.fn().mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, per_page: 25, total_pages: 0 },
    }),
  };

  const mockAuthService = {
    decodeToken: jest.fn(),
    verifyAccessToken: jest.fn(),
    resolveUser: jest.fn(),
  };

  const asUser = (permissions: string[], tenantId = 1) => {
    mockAuthService.decodeToken.mockReturnValue({ sub: '1' });
    mockAuthService.verifyAccessToken.mockResolvedValue({ sub: '1' });
    mockAuthService.resolveUser.mockResolvedValue({
      userId: 1,
      tenantId,
      email: 'cashier@example.com',
      firstName: 'Cash',
      lastName: 'Ier',
      roles: ['cashier'],
      permissions,
    });
  };

  const validCheckoutBody = { lines: [{ productId: 1, quantity: 2 }] };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [SalesController],
      providers: [
        { provide: SalesService, useValue: mockSalesService },
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

  describe('POST /tenants/:tenantId/sales/quote', () => {
    it('rejects with no auth cookie', async () => {
      await request(app.getHttpServer())
        .post('/tenants/1/sales/quote')
        .send(validCheckoutBody)
        .expect(401);

      expect(mockSalesService.quote).not.toHaveBeenCalled();
    });

    it('rejects a user missing sales:create', async () => {
      asUser([]);

      await request(app.getHttpServer())
        .post('/tenants/1/sales/quote')
        .set('Cookie', 'uw_access_token=fake-token')
        .send(validCheckoutBody)
        .expect(403);

      expect(mockSalesService.quote).not.toHaveBeenCalled();
    });

    it('sales:read alone cannot quote — quoting requires sales:create (PRD §5)', async () => {
      asUser(['sales:read']);

      await request(app.getHttpServer())
        .post('/tenants/1/sales/quote')
        .set('Cookie', 'uw_access_token=fake-token')
        .send(validCheckoutBody)
        .expect(403);

      expect(mockSalesService.quote).not.toHaveBeenCalled();
    });

    it('allows a user with sales:create and returns 200 (no write)', async () => {
      asUser(['sales:create']);

      await request(app.getHttpServer())
        .post('/tenants/1/sales/quote')
        .set('Cookie', 'uw_access_token=fake-token')
        .send(validCheckoutBody)
        .expect(200);

      expect(mockSalesService.quote).toHaveBeenCalledWith(1, validCheckoutBody);
    });

    it('rejects with 400 when lines is empty', async () => {
      asUser(['sales:create']);

      await request(app.getHttpServer())
        .post('/tenants/1/sales/quote')
        .set('Cookie', 'uw_access_token=fake-token')
        .send({ lines: [] })
        .expect(400);

      expect(mockSalesService.quote).not.toHaveBeenCalled();
    });
  });

  describe('POST /tenants/:tenantId/sales', () => {
    it('rejects with no auth cookie', async () => {
      await request(app.getHttpServer())
        .post('/tenants/1/sales')
        .send(validCheckoutBody)
        .expect(401);

      expect(mockSalesService.checkout).not.toHaveBeenCalled();
    });

    it('rejects a user missing sales:create', async () => {
      asUser([]);

      await request(app.getHttpServer())
        .post('/tenants/1/sales')
        .set('Cookie', 'uw_access_token=fake-token')
        .send(validCheckoutBody)
        .expect(403);

      expect(mockSalesService.checkout).not.toHaveBeenCalled();
    });

    it('allows a cashier with sales:create and returns 201, passing the resolved userId as cashierId', async () => {
      asUser(['sales:create']);

      await request(app.getHttpServer())
        .post('/tenants/1/sales')
        .set('Cookie', 'uw_access_token=fake-token')
        .send(validCheckoutBody)
        .expect(201);

      expect(mockSalesService.checkout).toHaveBeenCalledWith(
        1,
        validCheckoutBody,
        1,
      );
    });

    it('rejects with 400 when lines is empty', async () => {
      asUser(['sales:create']);

      await request(app.getHttpServer())
        .post('/tenants/1/sales')
        .set('Cookie', 'uw_access_token=fake-token')
        .send({ lines: [] })
        .expect(400);

      expect(mockSalesService.checkout).not.toHaveBeenCalled();
    });

    it('rejects a request for a tenant the caller does not belong to', async () => {
      asUser(['sales:create'], 2);

      await request(app.getHttpServer())
        .post('/tenants/1/sales')
        .set('Cookie', 'uw_access_token=fake-token')
        .send(validCheckoutBody)
        .expect(403);

      expect(mockSalesService.checkout).not.toHaveBeenCalled();
    });
  });

  describe('GET /tenants/:tenantId/sales/:saleId', () => {
    it('rejects a user missing sales:read', async () => {
      asUser([]);

      await request(app.getHttpServer())
        .get('/tenants/1/sales/1')
        .set('Cookie', 'uw_access_token=fake-token')
        .expect(403);

      expect(mockSalesService.getSale).not.toHaveBeenCalled();
    });

    it('allows a user with sales:read', async () => {
      asUser(['sales:read']);

      await request(app.getHttpServer())
        .get('/tenants/1/sales/1')
        .set('Cookie', 'uw_access_token=fake-token')
        .expect(200);

      expect(mockSalesService.getSale).toHaveBeenCalledWith(1, 1);
    });
  });

  describe('GET /tenants/:tenantId/sales (STORY-028 list)', () => {
    it('rejects with no auth cookie', async () => {
      await request(app.getHttpServer()).get('/tenants/1/sales').expect(401);

      expect(mockSalesService.findAll).not.toHaveBeenCalled();
    });

    it('rejects a user missing sales:read', async () => {
      asUser([]);

      await request(app.getHttpServer())
        .get('/tenants/1/sales')
        .set('Cookie', 'uw_access_token=fake-token')
        .expect(403);

      expect(mockSalesService.findAll).not.toHaveBeenCalled();
    });

    it('allows a user with sales:read and forwards dateFrom/dateTo', async () => {
      asUser(['sales:read']);

      await request(app.getHttpServer())
        .get('/tenants/1/sales')
        .set('Cookie', 'uw_access_token=fake-token')
        .query({ dateFrom: '2026-01-01', dateTo: '2026-12-31' })
        .expect(200);

      expect(mockSalesService.findAll).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          dateFrom: '2026-01-01',
          dateTo: '2026-12-31',
        }) as never,
      );
    });

    it('rejects a request for a tenant the caller does not belong to', async () => {
      asUser(['sales:read'], 2);

      await request(app.getHttpServer())
        .get('/tenants/1/sales')
        .set('Cookie', 'uw_access_token=fake-token')
        .expect(403);

      expect(mockSalesService.findAll).not.toHaveBeenCalled();
    });
  });

  describe('GET /tenants/:tenantId/sales/:saleId/receipt', () => {
    it('rejects with no auth cookie', async () => {
      await request(app.getHttpServer())
        .get('/tenants/1/sales/1/receipt')
        .expect(401);

      expect(mockSalesService.getReceipt).not.toHaveBeenCalled();
    });

    it('rejects a user missing sales:read', async () => {
      asUser([]);

      await request(app.getHttpServer())
        .get('/tenants/1/sales/1/receipt')
        .set('Cookie', 'uw_access_token=fake-token')
        .expect(403);

      expect(mockSalesService.getReceipt).not.toHaveBeenCalled();
    });

    it('allows a user with sales:read', async () => {
      asUser(['sales:read']);

      await request(app.getHttpServer())
        .get('/tenants/1/sales/1/receipt')
        .set('Cookie', 'uw_access_token=fake-token')
        .expect(200);

      expect(mockSalesService.getReceipt).toHaveBeenCalledWith(1, 1);
    });
  });
});
