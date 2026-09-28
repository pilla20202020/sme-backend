import {
  ConflictException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RolesGuard, TenantScopeGuard } from '../auth/guards';
import { InventoryMovementsService } from './inventory-movements.service';
import { ProductInventoryController } from './product-inventory.controller';

describe('ProductInventoryController (guard integration)', () => {
  let app: INestApplication<App>;

  const mockMovementsService = {
    findAllForProduct: jest.fn().mockResolvedValue({ data: [], meta: {} }),
    getOnHand: jest
      .fn()
      .mockResolvedValue({ productId: 5, totalOnHand: 0, batches: [] }),
    createAdjustment: jest.fn().mockResolvedValue({
      movement: { movementId: '1' },
      quantityRemaining: 5,
    }),
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
      roles: ['inventory_staff'],
      permissions,
    });
  };

  const validAdjustmentBody = {
    productBatchId: 55,
    quantityDelta: -3,
    reason: 'Damaged in transit',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ProductInventoryController],
      providers: [
        { provide: InventoryMovementsService, useValue: mockMovementsService },
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

  describe('GET .../inventory/movements', () => {
    it('rejects with no auth cookie', async () => {
      await request(app.getHttpServer())
        .get('/tenants/1/products/5/inventory/movements')
        .expect(401);
    });

    it('allows a user with inventory:read', async () => {
      asUser(['inventory:read']);

      await request(app.getHttpServer())
        .get('/tenants/1/products/5/inventory/movements')
        .set('Cookie', 'uw_access_token=fake-token')
        .expect(200);

      expect(mockMovementsService.findAllForProduct).toHaveBeenCalledWith(
        1,
        5,
        expect.objectContaining({}) as never,
      );
    });
  });

  describe('GET .../inventory/on-hand', () => {
    it('rejects a user missing inventory:read', async () => {
      asUser([]);

      await request(app.getHttpServer())
        .get('/tenants/1/products/5/inventory/on-hand')
        .set('Cookie', 'uw_access_token=fake-token')
        .expect(403);

      expect(mockMovementsService.getOnHand).not.toHaveBeenCalled();
    });

    it('allows a user with inventory:read', async () => {
      asUser(['inventory:read']);

      await request(app.getHttpServer())
        .get('/tenants/1/products/5/inventory/on-hand')
        .set('Cookie', 'uw_access_token=fake-token')
        .expect(200);

      expect(mockMovementsService.getOnHand).toHaveBeenCalledWith(1, 5);
    });
  });

  describe('POST .../inventory/adjustments', () => {
    it('rejects with no auth cookie', async () => {
      await request(app.getHttpServer())
        .post('/tenants/1/products/5/inventory/adjustments')
        .send(validAdjustmentBody)
        .expect(401);

      expect(mockMovementsService.createAdjustment).not.toHaveBeenCalled();
    });

    it('rejects a user with only inventory:read — read is distinct from adjust', async () => {
      asUser(['inventory:read']);

      await request(app.getHttpServer())
        .post('/tenants/1/products/5/inventory/adjustments')
        .set('Cookie', 'uw_access_token=fake-token')
        .send(validAdjustmentBody)
        .expect(403);

      expect(mockMovementsService.createAdjustment).not.toHaveBeenCalled();
    });

    it('allows a user with inventory:adjust', async () => {
      asUser(['inventory:adjust']);

      await request(app.getHttpServer())
        .post('/tenants/1/products/5/inventory/adjustments')
        .set('Cookie', 'uw_access_token=fake-token')
        .send(validAdjustmentBody)
        .expect(201);

      expect(mockMovementsService.createAdjustment).toHaveBeenCalledWith(
        1,
        5,
        validAdjustmentBody,
        1,
      );
    });

    it('rejects with 400 when reason is empty', async () => {
      asUser(['inventory:adjust']);

      await request(app.getHttpServer())
        .post('/tenants/1/products/5/inventory/adjustments')
        .set('Cookie', 'uw_access_token=fake-token')
        .send({ ...validAdjustmentBody, reason: '' })
        .expect(400);

      expect(mockMovementsService.createAdjustment).not.toHaveBeenCalled();
    });

    it('rejects with 400 when reason is whitespace-only', async () => {
      asUser(['inventory:adjust']);

      await request(app.getHttpServer())
        .post('/tenants/1/products/5/inventory/adjustments')
        .set('Cookie', 'uw_access_token=fake-token')
        .send({ ...validAdjustmentBody, reason: '   ' })
        .expect(400);

      expect(mockMovementsService.createAdjustment).not.toHaveBeenCalled();
    });

    it('rejects with 400 when quantityDelta is zero', async () => {
      asUser(['inventory:adjust']);

      await request(app.getHttpServer())
        .post('/tenants/1/products/5/inventory/adjustments')
        .set('Cookie', 'uw_access_token=fake-token')
        .send({ ...validAdjustmentBody, quantityDelta: 0 })
        .expect(400);

      expect(mockMovementsService.createAdjustment).not.toHaveBeenCalled();
    });

    it('propagates a 409 from the service when the adjustment would go negative', async () => {
      asUser(['inventory:adjust']);
      mockMovementsService.createAdjustment.mockRejectedValueOnce(
        new ConflictException('would go negative'),
      );

      await request(app.getHttpServer())
        .post('/tenants/1/products/5/inventory/adjustments')
        .set('Cookie', 'uw_access_token=fake-token')
        .send(validAdjustmentBody)
        .expect(409);
    });
  });
});
