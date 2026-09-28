import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RolesGuard, TenantScopeGuard } from '../auth/guards';
import { StockReceiptsController } from './stock-receipts.controller';
import { StockReceiptsService } from './stock-receipts.service';

describe('StockReceiptsController (guard integration)', () => {
  let app: INestApplication<App>;

  const mockStockReceiptsService = {
    createReceipt: jest.fn().mockResolvedValue({
      receiptId: 1,
      tenantId: 1,
      purchaseOrderId: 1,
      discrepancies: [],
      purchaseOrderStatus: 'received',
    }),
    findAllForPurchaseOrder: jest
      .fn()
      .mockResolvedValue({ data: [], meta: {} }),
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

  const validReceiptBody = {
    lines: [
      {
        purchaseOrderLineId: 1,
        quantityReceived: 10,
        batchNumber: 'B1',
        expiryDate: '2099-01-01',
        unitCost: 8,
      },
    ],
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [StockReceiptsController],
      providers: [
        {
          provide: StockReceiptsService,
          useValue: mockStockReceiptsService,
        },
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

  it('rejects POST .../receipts with no auth cookie', async () => {
    await request(app.getHttpServer())
      .post('/tenants/1/purchase-orders/1/receipts')
      .send(validReceiptBody)
      .expect(401);

    expect(mockStockReceiptsService.createReceipt).not.toHaveBeenCalled();
  });

  it('rejects POST .../receipts for an admin missing purchasing:update', async () => {
    asAdmin([]);

    await request(app.getHttpServer())
      .post('/tenants/1/purchase-orders/1/receipts')
      .set('Cookie', 'uw_access_token=fake-token')
      .send(validReceiptBody)
      .expect(403);

    expect(mockStockReceiptsService.createReceipt).not.toHaveBeenCalled();
  });

  it('allows POST .../receipts for an admin with purchasing:update', async () => {
    asAdmin(['purchasing:update']);

    await request(app.getHttpServer())
      .post('/tenants/1/purchase-orders/1/receipts')
      .set('Cookie', 'uw_access_token=fake-token')
      .send(validReceiptBody)
      .expect(201);

    expect(mockStockReceiptsService.createReceipt).toHaveBeenCalledWith(
      1,
      1,
      validReceiptBody,
      1,
    );
  });

  it('rejects POST .../receipts with 400 when lines is empty', async () => {
    asAdmin(['purchasing:update']);

    await request(app.getHttpServer())
      .post('/tenants/1/purchase-orders/1/receipts')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({ lines: [] })
      .expect(400);

    expect(mockStockReceiptsService.createReceipt).not.toHaveBeenCalled();
  });

  it('reads permission is distinct from update — purchasing:read alone cannot POST a receipt', async () => {
    asAdmin(['purchasing:read']);

    await request(app.getHttpServer())
      .post('/tenants/1/purchase-orders/1/receipts')
      .set('Cookie', 'uw_access_token=fake-token')
      .send(validReceiptBody)
      .expect(403);

    expect(mockStockReceiptsService.createReceipt).not.toHaveBeenCalled();
  });

  it('rejects GET .../receipts with no auth cookie', async () => {
    await request(app.getHttpServer())
      .get('/tenants/1/purchase-orders/1/receipts')
      .expect(401);

    expect(
      mockStockReceiptsService.findAllForPurchaseOrder,
    ).not.toHaveBeenCalled();
  });

  it('allows GET .../receipts for an admin with purchasing:read', async () => {
    asAdmin(['purchasing:read']);

    await request(app.getHttpServer())
      .get('/tenants/1/purchase-orders/1/receipts')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(200);

    expect(
      mockStockReceiptsService.findAllForPurchaseOrder,
    ).toHaveBeenCalledWith(1, 1, expect.objectContaining({}) as never);
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
      .get('/tenants/1/purchase-orders/1/receipts')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(403);

    expect(
      mockStockReceiptsService.findAllForPurchaseOrder,
    ).not.toHaveBeenCalled();
  });
});
