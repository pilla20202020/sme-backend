import { INestApplication } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RolesGuard, TenantScopeGuard } from '../auth/guards';
import { TransformInterceptor } from '../common/interceptors/transform.interceptor';
import { PrismaService } from '../prisma/prisma.service';
import { TenantsController } from '../tenants/tenants.controller';
import { TenantsService } from '../tenants/tenants.service';
import { ProductsController } from '../catalog/products.controller';
import { ProductsService } from '../catalog/products.service';
import { PurchaseOrdersController } from '../purchasing/purchase-orders.controller';
import { PurchaseOrdersService } from '../purchasing/purchase-orders.service';
import { AuditLogService } from './audit-log.service';
import { AuditInterceptor } from './audit.interceptor';

/**
 * Spot-checks (STORY-036) that the `@AuditAction` retrofit on real,
 * already-shipped controllers actually produces an audit row when driven
 * through the FULL app-level guard+interceptor stack — not just "should
 * work because the decorator was added". Covers 3 of the 13 checklist rows
 * across 3 different modules (a @Public() endpoint, a catalog endpoint, and
 * a purchasing endpoint), each with its own real AuditInterceptor +
 * TransformInterceptor + guards, wired the same way as production.
 */
describe('Audit retrofit spot-checks (real guard + interceptor stack)', () => {
  let auditRows: Array<Record<string, unknown>>;

  const fakePrisma = {
    auditLog: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        auditRows.push(data);
        return Promise.resolve({ ...data, id: BigInt(auditRows.length) });
      }),
    },
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

  beforeEach(() => {
    jest.clearAllMocks();
    auditRows = [];
  });

  describe('TenantsController.register (@Public, tenant.create)', () => {
    let app: INestApplication<App>;
    const mockTenantsService = {
      register: jest
        .fn()
        .mockResolvedValue({ tenantId: 7, name: 'Sample Pharmacy' }),
    };

    beforeEach(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        controllers: [TenantsController],
        providers: [
          { provide: TenantsService, useValue: mockTenantsService },
          { provide: AuthService, useValue: mockAuthService },
          AuditLogService,
          { provide: PrismaService, useValue: fakePrisma },
          { provide: APP_GUARD, useClass: JwtAuthGuard },
          { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
        ],
      }).compile();

      app = moduleFixture.createNestApplication();
      app.use(cookieParser());
      app.useGlobalInterceptors(new TransformInterceptor());
      await app.init();
    });

    afterEach(async () => {
      await app.close();
    });

    it('produces an audit row for a real (anonymous) registration call', async () => {
      await request(app.getHttpServer())
        .post('/tenants')
        .send({ name: 'Sample Pharmacy' })
        .expect(201);

      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]).toMatchObject({
        tenantId: 7,
        action: 'tenant.create',
        targetType: 'Tenant',
        targetId: '7',
      });
    });
  });

  describe('ProductsController.create (catalog:create, product.create)', () => {
    let app: INestApplication<App>;
    const mockProductsService = {
      create: jest.fn().mockResolvedValue({ productId: 55, tenantId: 1 }),
    };

    beforeEach(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        controllers: [ProductsController],
        providers: [
          { provide: ProductsService, useValue: mockProductsService },
          { provide: AuthService, useValue: mockAuthService },
          AuditLogService,
          { provide: PrismaService, useValue: fakePrisma },
          { provide: APP_GUARD, useClass: JwtAuthGuard },
          { provide: APP_GUARD, useClass: RolesGuard },
          { provide: APP_GUARD, useClass: PermissionsGuard },
          { provide: APP_GUARD, useClass: TenantScopeGuard },
          { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
        ],
      }).compile();

      app = moduleFixture.createNestApplication();
      app.use(cookieParser());
      app.useGlobalInterceptors(new TransformInterceptor());
      await app.init();
    });

    afterEach(async () => {
      await app.close();
    });

    it('produces an audit row for a real product creation call', async () => {
      asAdmin(['catalog:create']);

      await request(app.getHttpServer())
        .post('/tenants/1/products')
        .set('Cookie', 'uw_access_token=fake-token')
        .send({ name: 'Paracetamol', unit: 'tablet', currentPrice: 5 })
        .expect(201);

      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]).toMatchObject({
        tenantId: 1,
        actorUserId: 1,
        action: 'product.create',
        targetType: 'Product',
        targetId: '55',
      });
    });
  });

  describe('PurchaseOrdersController.create (purchasing:create, purchase_order.create)', () => {
    let app: INestApplication<App>;
    const mockPurchaseOrdersService = {
      create: jest
        .fn()
        .mockResolvedValue({ purchaseOrderId: 100, tenantId: 1 }),
    };

    beforeEach(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        controllers: [PurchaseOrdersController],
        providers: [
          {
            provide: PurchaseOrdersService,
            useValue: mockPurchaseOrdersService,
          },
          { provide: AuthService, useValue: mockAuthService },
          AuditLogService,
          { provide: PrismaService, useValue: fakePrisma },
          { provide: APP_GUARD, useClass: JwtAuthGuard },
          { provide: APP_GUARD, useClass: RolesGuard },
          { provide: APP_GUARD, useClass: PermissionsGuard },
          { provide: APP_GUARD, useClass: TenantScopeGuard },
          { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
        ],
      }).compile();

      app = moduleFixture.createNestApplication();
      app.use(cookieParser());
      app.useGlobalInterceptors(new TransformInterceptor());
      await app.init();
    });

    afterEach(async () => {
      await app.close();
    });

    it('produces an audit row for a real purchase order creation call', async () => {
      asAdmin(['purchasing:create']);

      await request(app.getHttpServer())
        .post('/tenants/1/purchase-orders')
        .set('Cookie', 'uw_access_token=fake-token')
        .send({
          supplierId: 1,
          lines: [{ productId: 1, quantityOrdered: 10, unitCost: 8.5 }],
        })
        .expect(201);

      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]).toMatchObject({
        tenantId: 1,
        actorUserId: 1,
        action: 'purchase_order.create',
        targetType: 'PurchaseOrder',
        targetId: '100',
      });
    });
  });
});
