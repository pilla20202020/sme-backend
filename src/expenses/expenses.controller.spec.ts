import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RolesGuard, TenantScopeGuard } from '../auth/guards';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

describe('ExpensesController (guard integration)', () => {
  let app: INestApplication<App>;

  const expenseResponse = {
    expenseId: 1,
    tenantId: 1,
    branchId: 1,
    category: 'Utilities',
    amount: 100,
    description: null,
    expenseDate: '01/01/2026',
    recordedBy: 1,
    createdAt: '01/01/2026 12:00 PM',
  };

  const mockExpensesService = {
    create: jest.fn().mockResolvedValue(expenseResponse),
    findAll: jest.fn().mockResolvedValue({ data: [], meta: {} }),
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
      email: 'manager@example.com',
      firstName: 'Manager',
      lastName: 'User',
      roles: ['manager'],
      permissions,
    });
  };

  const validBody = {
    branchId: 1,
    category: 'Utilities',
    amount: 100,
    expenseDate: '2026-01-01',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ExpensesController],
      providers: [
        { provide: ExpensesService, useValue: mockExpensesService },
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

  describe('POST /tenants/:tenantId/expenses', () => {
    it('rejects with no auth cookie', async () => {
      await request(app.getHttpServer())
        .post('/tenants/1/expenses')
        .send(validBody)
        .expect(401);

      expect(mockExpensesService.create).not.toHaveBeenCalled();
    });

    it('rejects a user missing expense:create (e.g. a cashier)', async () => {
      asUser([]);

      await request(app.getHttpServer())
        .post('/tenants/1/expenses')
        .set('Cookie', 'uw_access_token=fake-token')
        .send(validBody)
        .expect(403);

      expect(mockExpensesService.create).not.toHaveBeenCalled();
    });

    it('allows a manager with expense:create, passing the resolved userId as recordedBy', async () => {
      asUser(['expense:create']);

      await request(app.getHttpServer())
        .post('/tenants/1/expenses')
        .set('Cookie', 'uw_access_token=fake-token')
        .send(validBody)
        .expect(201);

      expect(mockExpensesService.create).toHaveBeenCalledWith(1, validBody, 1);
    });

    it('rejects with 400 when amount is not positive', async () => {
      asUser(['expense:create']);

      await request(app.getHttpServer())
        .post('/tenants/1/expenses')
        .set('Cookie', 'uw_access_token=fake-token')
        .send({ ...validBody, amount: -5 })
        .expect(400);

      expect(mockExpensesService.create).not.toHaveBeenCalled();
    });

    it('rejects a request for a tenant the caller does not belong to', async () => {
      asUser(['expense:create'], 2);

      await request(app.getHttpServer())
        .post('/tenants/1/expenses')
        .set('Cookie', 'uw_access_token=fake-token')
        .send(validBody)
        .expect(403);

      expect(mockExpensesService.create).not.toHaveBeenCalled();
    });
  });

  describe('GET /tenants/:tenantId/expenses', () => {
    it('rejects a user missing expense:read', async () => {
      asUser([]);

      await request(app.getHttpServer())
        .get('/tenants/1/expenses')
        .set('Cookie', 'uw_access_token=fake-token')
        .expect(403);

      expect(mockExpensesService.findAll).not.toHaveBeenCalled();
    });

    it('allows a user with expense:read, forwarding filters', async () => {
      asUser(['expense:read']);

      await request(app.getHttpServer())
        .get('/tenants/1/expenses')
        .set('Cookie', 'uw_access_token=fake-token')
        .query({ branchId: 1, category: 'Utilities' })
        .expect(200);

      expect(mockExpensesService.findAll).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          branchId: 1,
          category: 'Utilities',
        }) as never,
      );
    });
  });
});
