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
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';

describe('BranchesController (guard integration)', () => {
  let app: INestApplication<App>;

  const mockBranchesService = {
    create: jest.fn().mockResolvedValue({ branchId: 1, tenantId: 1 }),
    findById: jest.fn().mockResolvedValue({ branchId: 1, tenantId: 1 }),
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
      controllers: [BranchesController],
      providers: [
        { provide: BranchesService, useValue: mockBranchesService },
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

  it('rejects POST /tenants/:tenantId/branches with no auth cookie', async () => {
    await request(app.getHttpServer())
      .post('/tenants/1/branches')
      .send({ name: 'Downtown Branch' })
      .expect(401);

    expect(mockBranchesService.create).not.toHaveBeenCalled();
  });

  it('rejects POST /tenants/:tenantId/branches for an admin missing branch:create', async () => {
    asAdmin([]);

    await request(app.getHttpServer())
      .post('/tenants/1/branches')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({ name: 'Downtown Branch' })
      .expect(403);

    expect(mockBranchesService.create).not.toHaveBeenCalled();
  });

  it('allows POST /tenants/:tenantId/branches for an admin with branch:create', async () => {
    asAdmin(['branch:create']);

    await request(app.getHttpServer())
      .post('/tenants/1/branches')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({ name: 'Downtown Branch' })
      .expect(201);

    expect(mockBranchesService.create).toHaveBeenCalledWith(1, {
      name: 'Downtown Branch',
    });
  });

  it('rejects GET /tenants/:tenantId/branches/:branchId with no auth cookie', async () => {
    await request(app.getHttpServer()).get('/tenants/1/branches/1').expect(401);

    expect(mockBranchesService.findById).not.toHaveBeenCalled();
  });

  it('allows GET /tenants/:tenantId/branches/:branchId for an admin with branch:read', async () => {
    asAdmin(['branch:read']);

    await request(app.getHttpServer())
      .get('/tenants/1/branches/1')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(200);

    expect(mockBranchesService.findById).toHaveBeenCalledWith(1, 1);
  });

  it('allows GET /tenants/:tenantId/branches for an admin with branch:read', async () => {
    asAdmin(['branch:read']);

    await request(app.getHttpServer())
      .get('/tenants/1/branches')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(200);

    expect(mockBranchesService.findAll).toHaveBeenCalledTimes(1);
  });
});

describe('BranchesController + real BranchesService (tenant isolation over HTTP)', () => {
  let app: INestApplication<App>;

  const tenants = new Map<number, { tenantId: number }>([
    [1, { tenantId: 1 }],
    [2, { tenantId: 2 }],
  ]);
  const branches = [
    {
      branchId: 1,
      tenantId: 1,
      name: 'Tenant 1 Branch',
      address: null,
      isActive: true,
      createdAt: new Date('2026-01-01T09:00:00Z'),
      updatedAt: new Date('2026-01-01T09:00:00Z'),
    },
    {
      branchId: 2,
      tenantId: 2,
      name: 'Tenant 2 Branch',
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
    branch: {
      findFirst: jest.fn(
        ({ where }: { where: { branchId: number; tenantId: number } }) =>
          Promise.resolve(
            branches.find(
              (b) =>
                b.branchId === where.branchId && b.tenantId === where.tenantId,
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
      permissions: ['branch:read'],
    }),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [BranchesController],
      providers: [
        BranchesService,
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

  it('returns tenant 1’s own branch when queried under tenant 1', async () => {
    const res = await request(app.getHttpServer())
      .get('/tenants/1/branches/1')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(200);

    expect((res.body as { data: { name: string } }).data.name).toBe(
      'Tenant 1 Branch',
    );
  });

  it('404s when tenant 1 tries to fetch tenant 2’s branch by ID', async () => {
    await request(app.getHttpServer())
      .get('/tenants/1/branches/2')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(404);
  });

  it('404s when tenant 2 tries to fetch tenant 1’s branch by ID', async () => {
    await request(app.getHttpServer())
      .get('/tenants/2/branches/1')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(404);
  });
});
