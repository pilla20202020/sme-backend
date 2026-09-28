import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RolesGuard, TenantScopeGuard } from '../auth/guards';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';

describe('ReturnsController (guard integration)', () => {
  let app: INestApplication<App>;

  const returnResponse = {
    returnId: 1,
    tenantId: 1,
    saleId: 10,
    reason: 'Damaged on delivery',
    overrideApprovedBy: null,
    processedBy: 1,
    refundTotal: 20,
    returnDate: '01/01/2026 12:00 PM',
    lines: [],
  };

  const mockReturnsService = {
    create: jest.fn().mockResolvedValue(returnResponse),
    getReturn: jest.fn().mockResolvedValue(returnResponse),
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
      email: 'cashier@example.com',
      firstName: 'Cash',
      lastName: 'Ier',
      roles: ['cashier'],
      permissions,
    });
  };

  const matchedBody = {
    saleId: 10,
    reason: 'Damaged on delivery',
    lines: [{ saleLineBatchAllocationId: 1, quantity: 2 }],
  };

  const overrideBody = {
    reason: 'Customer returned without receipt',
    overrideApprovedBy: 2,
    lines: [{ productId: 1, productBatchId: 1, quantity: 1, unitPrice: 10 }],
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ReturnsController],
      providers: [
        { provide: ReturnsService, useValue: mockReturnsService },
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

  describe('POST /tenants/:tenantId/returns', () => {
    it('rejects with no auth cookie', async () => {
      await request(app.getHttpServer())
        .post('/tenants/1/returns')
        .send(matchedBody)
        .expect(401);

      expect(mockReturnsService.create).not.toHaveBeenCalled();
    });

    it('rejects a user missing returns:create', async () => {
      asUser([]);

      await request(app.getHttpServer())
        .post('/tenants/1/returns')
        .set('Cookie', 'uw_access_token=fake-token')
        .send(matchedBody)
        .expect(403);

      expect(mockReturnsService.create).not.toHaveBeenCalled();
    });

    it('allows a cashier with returns:create for the matched case, passing the resolved userId as processedBy', async () => {
      asUser(['returns:create']);

      await request(app.getHttpServer())
        .post('/tenants/1/returns')
        .set('Cookie', 'uw_access_token=fake-token')
        .send(matchedBody)
        .expect(201);

      expect(mockReturnsService.create).toHaveBeenCalledWith(1, matchedBody, 1);
    });

    it('allows a cashier with returns:create alone to submit an override request too — the base guard only checks returns:create; the stricter returns:override check happens in-service against overrideApprovedBy', async () => {
      asUser(['returns:create']);

      await request(app.getHttpServer())
        .post('/tenants/1/returns')
        .set('Cookie', 'uw_access_token=fake-token')
        .send(overrideBody)
        .expect(201);

      expect(mockReturnsService.create).toHaveBeenCalledWith(
        1,
        overrideBody,
        1,
      );
    });

    it('rejects with 400 when reason is empty', async () => {
      asUser(['returns:create']);

      await request(app.getHttpServer())
        .post('/tenants/1/returns')
        .set('Cookie', 'uw_access_token=fake-token')
        .send({ ...matchedBody, reason: '   ' })
        .expect(400);

      expect(mockReturnsService.create).not.toHaveBeenCalled();
    });

    it('rejects with 400 when lines is empty', async () => {
      asUser(['returns:create']);

      await request(app.getHttpServer())
        .post('/tenants/1/returns')
        .set('Cookie', 'uw_access_token=fake-token')
        .send({ ...matchedBody, lines: [] })
        .expect(400);

      expect(mockReturnsService.create).not.toHaveBeenCalled();
    });

    it('rejects with 400 when neither saleId nor overrideApprovedBy is supplied (PRD STORY-024 AC) — a plain validation failure before the controller/service ever runs', async () => {
      asUser(['returns:create']);

      await request(app.getHttpServer())
        .post('/tenants/1/returns')
        .set('Cookie', 'uw_access_token=fake-token')
        .send({
          reason: 'No sale on file',
          lines: [
            { productId: 1, productBatchId: 1, quantity: 1, unitPrice: 10 },
          ],
        })
        .expect(400);

      expect(mockReturnsService.create).not.toHaveBeenCalled();
    });

    it('rejects a request for a tenant the caller does not belong to', async () => {
      asUser(['returns:create'], 2);

      await request(app.getHttpServer())
        .post('/tenants/1/returns')
        .set('Cookie', 'uw_access_token=fake-token')
        .send(matchedBody)
        .expect(403);

      expect(mockReturnsService.create).not.toHaveBeenCalled();
    });
  });

  describe('GET /tenants/:tenantId/returns/:returnId', () => {
    it('rejects a user missing returns:read', async () => {
      asUser([]);

      await request(app.getHttpServer())
        .get('/tenants/1/returns/1')
        .set('Cookie', 'uw_access_token=fake-token')
        .expect(403);

      expect(mockReturnsService.getReturn).not.toHaveBeenCalled();
    });

    it('allows a user with returns:read', async () => {
      asUser(['returns:read']);

      await request(app.getHttpServer())
        .get('/tenants/1/returns/1')
        .set('Cookie', 'uw_access_token=fake-token')
        .expect(200);

      expect(mockReturnsService.getReturn).toHaveBeenCalledWith(1, 1);
    });
  });
});
