import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RolesGuard, TenantScopeGuard } from '../auth/guards';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogService } from './audit-log.service';

describe('AuditLogsController (guard integration — STORY-037)', () => {
  let app: INestApplication<App>;

  const mockAuditLogService = {
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

  const asTenantOwner = (permissions: string[]) => {
    mockAuthService.decodeToken.mockReturnValue({ sub: '2' });
    mockAuthService.verifyAccessToken.mockResolvedValue({ sub: '2' });
    mockAuthService.resolveUser.mockResolvedValue({
      userId: 2,
      tenantId: 1,
      email: 'owner@example.com',
      firstName: 'Owner',
      lastName: 'User',
      roles: ['owner'],
      permissions,
    });
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AuditLogsController],
      providers: [
        { provide: AuditLogService, useValue: mockAuditLogService },
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

  it('rejects with no auth cookie', async () => {
    await request(app.getHttpServer()).get('/tenants/1/audit-logs').expect(401);

    expect(mockAuditLogService.findAll).not.toHaveBeenCalled();
  });

  it('rejects a tenant owner querying their own tenant’s audit log (admin-only, deliberate exception — AC-2)', async () => {
    asTenantOwner(['audit:read']);

    await request(app.getHttpServer())
      .get('/tenants/1/audit-logs')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(403);

    expect(mockAuditLogService.findAll).not.toHaveBeenCalled();
  });

  it('rejects an admin missing audit:read', async () => {
    asAdmin([]);

    await request(app.getHttpServer())
      .get('/tenants/1/audit-logs')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(403);

    expect(mockAuditLogService.findAll).not.toHaveBeenCalled();
  });

  it('allows an admin with audit:read', async () => {
    asAdmin(['audit:read']);

    await request(app.getHttpServer())
      .get('/tenants/1/audit-logs')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(200);

    expect(mockAuditLogService.findAll).toHaveBeenCalledTimes(1);
  });

  it('forwards actorUserId/action/from/to filters, all combined (AC-1)', async () => {
    asAdmin(['audit:read']);

    await request(app.getHttpServer())
      .get('/tenants/1/audit-logs')
      .set('Cookie', 'uw_access_token=fake-token')
      .query({
        actorUserId: '5',
        action: 'branch.create',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-31T23:59:59.000Z',
      })
      .expect(200);

    expect(mockAuditLogService.findAll).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        actorUserId: 5,
        action: 'branch.create',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-31T23:59:59.000Z',
      }) as never,
    );
  });
});
