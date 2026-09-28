import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RolesGuard, TenantScopeGuard } from '../auth/guards';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

describe('CustomersController (guard integration)', () => {
  let app: INestApplication<App>;

  const mockCustomersService = {
    create: jest.fn().mockResolvedValue({ customerId: 1, tenantId: 1 }),
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
      controllers: [CustomersController],
      providers: [
        { provide: CustomersService, useValue: mockCustomersService },
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

  it('rejects POST /tenants/:tenantId/customers with no auth cookie', async () => {
    await request(app.getHttpServer())
      .post('/tenants/1/customers')
      .send({ name: 'Jane Doe' })
      .expect(401);

    expect(mockCustomersService.create).not.toHaveBeenCalled();
  });

  it('rejects POST /tenants/:tenantId/customers for an admin missing customer:create', async () => {
    asAdmin([]);

    await request(app.getHttpServer())
      .post('/tenants/1/customers')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({ name: 'Jane Doe' })
      .expect(403);

    expect(mockCustomersService.create).not.toHaveBeenCalled();
  });

  it('allows POST /tenants/:tenantId/customers for an admin with customer:create', async () => {
    asAdmin(['customer:create']);

    await request(app.getHttpServer())
      .post('/tenants/1/customers')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({ name: 'Jane Doe' })
      .expect(201);

    expect(mockCustomersService.create).toHaveBeenCalledWith(1, {
      name: 'Jane Doe',
    });
  });

  it('rejects GET /tenants/:tenantId/customers with no auth cookie', async () => {
    await request(app.getHttpServer()).get('/tenants/1/customers').expect(401);

    expect(mockCustomersService.findAll).not.toHaveBeenCalled();
  });

  it('rejects GET /tenants/:tenantId/customers for an admin missing customer:read', async () => {
    asAdmin([]);

    await request(app.getHttpServer())
      .get('/tenants/1/customers')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(403);

    expect(mockCustomersService.findAll).not.toHaveBeenCalled();
  });

  it('allows GET /tenants/:tenantId/customers for an admin with customer:read', async () => {
    asAdmin(['customer:read']);

    await request(app.getHttpServer())
      .get('/tenants/1/customers')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(200);

    expect(mockCustomersService.findAll).toHaveBeenCalledTimes(1);
  });

  it('passes a search query param through to the service', async () => {
    asAdmin(['customer:read']);

    await request(app.getHttpServer())
      .get('/tenants/1/customers?search=jane')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(200);

    expect(mockCustomersService.findAll).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ search: 'jane' }),
    );
  });

  it('rejects GET /tenants/:tenantId/customers for a tenant the caller does not belong to', async () => {
    mockAuthService.decodeToken.mockReturnValue({ sub: '1' });
    mockAuthService.verifyAccessToken.mockResolvedValue({ sub: '1' });
    mockAuthService.resolveUser.mockResolvedValue({
      userId: 1,
      tenantId: 2,
      email: 'manager@example.com',
      firstName: 'Manager',
      lastName: 'User',
      roles: ['manager'],
      permissions: ['customer:read'],
    });

    await request(app.getHttpServer())
      .get('/tenants/1/customers')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(403);

    expect(mockCustomersService.findAll).not.toHaveBeenCalled();
  });
});
