import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RolesGuard, TenantScopeGuard } from '../auth/guards';
import { TransformInterceptor } from '../common/interceptors/transform.interceptor';
import { PrismaService } from '../prisma/prisma.service';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

describe('SuppliersController (guard integration)', () => {
  let app: INestApplication<App>;

  const mockSuppliersService = {
    create: jest.fn().mockResolvedValue({ supplierId: 1, tenantId: 1 }),
    findById: jest.fn().mockResolvedValue({ supplierId: 1, tenantId: 1 }),
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
      controllers: [SuppliersController],
      providers: [
        { provide: SuppliersService, useValue: mockSuppliersService },
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

  it('rejects POST /tenants/:tenantId/suppliers with no auth cookie', async () => {
    await request(app.getHttpServer())
      .post('/tenants/1/suppliers')
      .send({ name: 'Acme Pharma' })
      .expect(401);

    expect(mockSuppliersService.create).not.toHaveBeenCalled();
  });

  it('rejects POST /tenants/:tenantId/suppliers for an admin missing supplier:create', async () => {
    asAdmin([]);

    await request(app.getHttpServer())
      .post('/tenants/1/suppliers')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({ name: 'Acme Pharma' })
      .expect(403);

    expect(mockSuppliersService.create).not.toHaveBeenCalled();
  });

  it('allows POST /tenants/:tenantId/suppliers for an admin with supplier:create', async () => {
    asAdmin(['supplier:create']);

    await request(app.getHttpServer())
      .post('/tenants/1/suppliers')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({ name: 'Acme Pharma' })
      .expect(201);

    expect(mockSuppliersService.create).toHaveBeenCalledWith(1, {
      name: 'Acme Pharma',
    });
  });

  it('rejects GET /tenants/:tenantId/suppliers/:supplierId with no auth cookie', async () => {
    await request(app.getHttpServer())
      .get('/tenants/1/suppliers/1')
      .expect(401);

    expect(mockSuppliersService.findById).not.toHaveBeenCalled();
  });

  it('rejects GET /tenants/:tenantId/suppliers/:supplierId for an admin missing supplier:read', async () => {
    asAdmin([]);

    await request(app.getHttpServer())
      .get('/tenants/1/suppliers/1')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(403);

    expect(mockSuppliersService.findById).not.toHaveBeenCalled();
  });

  it('allows GET /tenants/:tenantId/suppliers/:supplierId for an admin with supplier:read', async () => {
    asAdmin(['supplier:read']);

    await request(app.getHttpServer())
      .get('/tenants/1/suppliers/1')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(200);

    expect(mockSuppliersService.findById).toHaveBeenCalledWith(1, 1);
  });

  it('allows GET /tenants/:tenantId/suppliers for an admin with supplier:read', async () => {
    asAdmin(['supplier:read']);

    await request(app.getHttpServer())
      .get('/tenants/1/suppliers')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(200);

    expect(mockSuppliersService.findAll).toHaveBeenCalledTimes(1);
  });
});

describe('SuppliersController + real SuppliersService (tenant isolation over HTTP)', () => {
  let app: INestApplication<App>;

  const tenants = new Map<number, { tenantId: number }>([
    [1, { tenantId: 1 }],
    [2, { tenantId: 2 }],
  ]);
  const suppliers = [
    {
      supplierId: 1,
      tenantId: 1,
      name: 'Tenant 1 Supplier',
      contactPerson: null,
      phone: null,
      email: null,
      paymentTerms: null,
      address: null,
      isActive: true,
      createdAt: new Date('2026-01-01T09:00:00Z'),
      updatedAt: new Date('2026-01-01T09:00:00Z'),
    },
    {
      supplierId: 2,
      tenantId: 2,
      name: 'Tenant 2 Supplier',
      contactPerson: null,
      phone: null,
      email: null,
      paymentTerms: null,
      address: null,
      isActive: true,
      createdAt: new Date('2026-01-02T09:00:00Z'),
      updatedAt: new Date('2026-01-02T09:00:00Z'),
    },
  ];

  const fakePrisma = {
    tenant: {
      findUnique: jest.fn(({ where }: { where: { tenantId: number } }) =>
        Promise.resolve(tenants.get(where.tenantId) ?? null),
      ),
    },
    supplier: {
      findFirst: jest.fn(
        ({ where }: { where: { supplierId: number; tenantId: number } }) =>
          Promise.resolve(
            suppliers.find(
              (s) =>
                s.supplierId === where.supplierId &&
                s.tenantId === where.tenantId,
            ) ?? null,
          ),
      ),
    },
  };

  const mockAuthService = {
    decodeToken: jest.fn().mockReturnValue({ sub: '1' }),
    verifyAccessToken: jest.fn().mockResolvedValue({ sub: '1' }),
    resolveUser: jest.fn().mockResolvedValue({
      userId: 1,
      email: 'admin@example.com',
      firstName: 'Admin',
      lastName: 'User',
      roles: ['admin'],
      permissions: ['supplier:read'],
    }),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [SuppliersController],
      providers: [
        SuppliersService,
        { provide: PrismaService, useValue: fakePrisma },
        { provide: AuthService, useValue: mockAuthService },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: APP_GUARD, useClass: TenantScopeGuard },
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

  it('returns tenant 1’s own supplier when queried under tenant 1', async () => {
    const res = await request(app.getHttpServer())
      .get('/tenants/1/suppliers/1')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(200);

    expect((res.body as { data: { name: string } }).data.name).toBe(
      'Tenant 1 Supplier',
    );
  });

  it('404s when tenant 1 tries to fetch tenant 2’s supplier by ID', async () => {
    await request(app.getHttpServer())
      .get('/tenants/1/suppliers/2')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(404);
  });

  it('404s when tenant 2 tries to fetch tenant 1’s supplier by ID', async () => {
    await request(app.getHttpServer())
      .get('/tenants/2/suppliers/1')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(404);
  });
});
