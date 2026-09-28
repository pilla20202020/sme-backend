import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RolesGuard, TenantScopeGuard } from '../auth/guards';
import { ProductBatchesController } from './product-batches.controller';
import { ProductBatchesService } from './product-batches.service';

describe('ProductBatchesController (guard integration)', () => {
  let app: INestApplication<App>;

  const mockProductBatchesService = {
    create: jest.fn().mockResolvedValue({ batchId: 1, productId: 1 }),
    findAllForProduct: jest.fn().mockResolvedValue({ data: [], meta: {} }),
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
      controllers: [ProductBatchesController],
      providers: [
        { provide: ProductBatchesService, useValue: mockProductBatchesService },
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

  it('rejects POST .../batches with no auth cookie', async () => {
    await request(app.getHttpServer())
      .post('/tenants/1/products/1/batches')
      .send({
        batchNumber: 'BN-1',
        expiryDate: '2030-01-01',
        quantityReceived: 10,
      })
      .expect(401);

    expect(mockProductBatchesService.create).not.toHaveBeenCalled();
  });

  it('rejects POST .../batches for an admin missing catalog:create', async () => {
    asAdmin([]);

    await request(app.getHttpServer())
      .post('/tenants/1/products/1/batches')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({
        batchNumber: 'BN-1',
        expiryDate: '2030-01-01',
        quantityReceived: 10,
      })
      .expect(403);

    expect(mockProductBatchesService.create).not.toHaveBeenCalled();
  });

  it('allows POST .../batches for an admin with catalog:create', async () => {
    asAdmin(['catalog:create']);

    await request(app.getHttpServer())
      .post('/tenants/1/products/1/batches')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({
        batchNumber: 'BN-1',
        expiryDate: '2030-01-01',
        quantityReceived: 10,
      })
      .expect(201);

    expect(mockProductBatchesService.create).toHaveBeenCalledWith(1, 1, {
      batchNumber: 'BN-1',
      expiryDate: '2030-01-01',
      quantityReceived: 10,
    });
  });

  it('allows GET .../batches for an admin with catalog:read', async () => {
    asAdmin(['catalog:read']);

    await request(app.getHttpServer())
      .get('/tenants/1/products/1/batches')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(200);

    expect(mockProductBatchesService.findAllForProduct).toHaveBeenCalledTimes(
      1,
    );
  });

  it('rejects GET .../batches with no auth cookie', async () => {
    await request(app.getHttpServer())
      .get('/tenants/1/products/1/batches')
      .expect(401);

    expect(mockProductBatchesService.findAllForProduct).not.toHaveBeenCalled();
  });
});
