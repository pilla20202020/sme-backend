import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RolesGuard, TenantScopeGuard } from '../auth/guards';
import { CashController } from './cash.controller';
import { CashService } from './cash.service';

describe('CashController (guard integration)', () => {
  let app: INestApplication<App>;

  const dailyResponse = {
    date: '2026-01-01',
    salesTotal: 500,
    returnsTotal: 50,
    expensesTotal: 100,
    netCashPosition: 350,
    saleCount: 2,
    returnCount: 1,
    expenseCount: 1,
  };

  const mockCashService = {
    getDaily: jest.fn().mockResolvedValue(dailyResponse),
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
      email: 'accountant@example.com',
      firstName: 'Acc',
      lastName: 'Ountant',
      roles: ['accountant'],
      permissions,
    });
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [CashController],
      providers: [
        { provide: CashService, useValue: mockCashService },
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

  describe('GET /tenants/:tenantId/cash/daily', () => {
    it('rejects with no auth cookie', async () => {
      await request(app.getHttpServer())
        .get('/tenants/1/cash/daily')
        .query({ date: '2026-01-01' })
        .expect(401);

      expect(mockCashService.getDaily).not.toHaveBeenCalled();
    });

    it('rejects a cashier (cash:read is explicitly not granted to cashier)', async () => {
      asUser([]);

      await request(app.getHttpServer())
        .get('/tenants/1/cash/daily')
        .set('Cookie', 'uw_access_token=fake-token')
        .query({ date: '2026-01-01' })
        .expect(403);

      expect(mockCashService.getDaily).not.toHaveBeenCalled();
    });

    it('allows an accountant with cash:read', async () => {
      asUser(['cash:read']);

      await request(app.getHttpServer())
        .get('/tenants/1/cash/daily')
        .set('Cookie', 'uw_access_token=fake-token')
        .query({ date: '2026-01-01' })
        .expect(200);

      expect(mockCashService.getDaily).toHaveBeenCalledWith(1, '2026-01-01');
    });

    it('rejects with 400 when date is missing', async () => {
      asUser(['cash:read']);

      await request(app.getHttpServer())
        .get('/tenants/1/cash/daily')
        .set('Cookie', 'uw_access_token=fake-token')
        .expect(400);

      expect(mockCashService.getDaily).not.toHaveBeenCalled();
    });

    it('rejects a request for a tenant the caller does not belong to', async () => {
      asUser(['cash:read'], 2);

      await request(app.getHttpServer())
        .get('/tenants/1/cash/daily')
        .set('Cookie', 'uw_access_token=fake-token')
        .query({ date: '2026-01-01' })
        .expect(403);

      expect(mockCashService.getDaily).not.toHaveBeenCalled();
    });
  });
});
