import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RolesGuard, TenantScopeGuard } from '../auth/guards';
import { InventoryAlertsService } from './inventory-alerts.service';
import { InventoryController } from './inventory.controller';
import { InventoryMovementsService } from './inventory-movements.service';

describe('InventoryController (guard integration)', () => {
  let app: INestApplication<App>;

  const mockMovementsService = {
    findAll: jest.fn().mockResolvedValue({ data: [], meta: {} }),
  };
  const mockAlertsService = {
    getLowStock: jest.fn().mockResolvedValue({ data: [], meta: {} }),
    getNearExpiry: jest.fn().mockResolvedValue({ data: [], meta: {} }),
  };

  const mockAuthService = {
    decodeToken: jest.fn(),
    verifyAccessToken: jest.fn(),
    resolveUser: jest.fn(),
  };

  const asUser = (permissions: string[]) => {
    mockAuthService.decodeToken.mockReturnValue({ sub: '1' });
    mockAuthService.verifyAccessToken.mockResolvedValue({ sub: '1' });
    mockAuthService.resolveUser.mockResolvedValue({
      userId: 1,
      tenantId: 1,
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
      roles: ['manager'],
      permissions,
    });
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [InventoryController],
      providers: [
        { provide: InventoryMovementsService, useValue: mockMovementsService },
        { provide: InventoryAlertsService, useValue: mockAlertsService },
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

  describe('GET /tenants/:tenantId/inventory/movements', () => {
    it('rejects with no auth cookie', async () => {
      await request(app.getHttpServer())
        .get('/tenants/1/inventory/movements')
        .expect(401);

      expect(mockMovementsService.findAll).not.toHaveBeenCalled();
    });

    it('rejects a user missing inventory:read', async () => {
      asUser([]);

      await request(app.getHttpServer())
        .get('/tenants/1/inventory/movements')
        .set('Cookie', 'uw_access_token=fake-token')
        .expect(403);

      expect(mockMovementsService.findAll).not.toHaveBeenCalled();
    });

    it('allows a user with inventory:read', async () => {
      asUser(['inventory:read']);

      await request(app.getHttpServer())
        .get('/tenants/1/inventory/movements')
        .set('Cookie', 'uw_access_token=fake-token')
        .expect(200);

      expect(mockMovementsService.findAll).toHaveBeenCalledWith(
        1,
        expect.objectContaining({}) as never,
      );
    });
  });

  describe('GET /tenants/:tenantId/inventory/alerts/low-stock', () => {
    it('rejects with no auth cookie', async () => {
      await request(app.getHttpServer())
        .get('/tenants/1/inventory/alerts/low-stock')
        .expect(401);
    });

    it('allows a user with inventory:read', async () => {
      asUser(['inventory:read']);

      await request(app.getHttpServer())
        .get('/tenants/1/inventory/alerts/low-stock')
        .set('Cookie', 'uw_access_token=fake-token')
        .expect(200);

      expect(mockAlertsService.getLowStock).toHaveBeenCalledWith(
        1,
        expect.objectContaining({}) as never,
      );
    });
  });

  describe('GET /tenants/:tenantId/inventory/alerts/near-expiry', () => {
    it('rejects a user missing inventory:read', async () => {
      asUser([]);

      await request(app.getHttpServer())
        .get('/tenants/1/inventory/alerts/near-expiry')
        .set('Cookie', 'uw_access_token=fake-token')
        .expect(403);
    });

    it('defaults withinDays to 30 when not supplied', async () => {
      asUser(['inventory:read']);

      await request(app.getHttpServer())
        .get('/tenants/1/inventory/alerts/near-expiry')
        .set('Cookie', 'uw_access_token=fake-token')
        .expect(200);

      expect(mockAlertsService.getNearExpiry).toHaveBeenCalledWith(
        1,
        30,
        expect.objectContaining({}) as never,
      );
    });

    it('accepts an explicit withinDays', async () => {
      asUser(['inventory:read']);

      await request(app.getHttpServer())
        .get('/tenants/1/inventory/alerts/near-expiry?withinDays=7')
        .set('Cookie', 'uw_access_token=fake-token')
        .expect(200);

      expect(mockAlertsService.getNearExpiry).toHaveBeenCalledWith(
        1,
        7,
        expect.objectContaining({}) as never,
      );
    });

    it('rejects withinDays=0 with 400 (must be a positive integer)', async () => {
      asUser(['inventory:read']);

      await request(app.getHttpServer())
        .get('/tenants/1/inventory/alerts/near-expiry?withinDays=0')
        .set('Cookie', 'uw_access_token=fake-token')
        .expect(400);

      expect(mockAlertsService.getNearExpiry).not.toHaveBeenCalled();
    });

    it('rejects a non-integer withinDays with 400', async () => {
      asUser(['inventory:read']);

      await request(app.getHttpServer())
        .get('/tenants/1/inventory/alerts/near-expiry?withinDays=abc')
        .set('Cookie', 'uw_access_token=fake-token')
        .expect(400);

      expect(mockAlertsService.getNearExpiry).not.toHaveBeenCalled();
    });
  });
});
