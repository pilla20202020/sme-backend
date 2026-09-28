import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  INestApplication,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Public } from '../auth/public.decorator';
import { TransformInterceptor } from '../common/interceptors/transform.interceptor';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction } from './audit-action.decorator';
import { AuditLogService, ANONYMOUS_ACTOR_LABEL } from './audit-log.service';
import { AuditInterceptor } from './audit.interceptor';

// A tiny, throwaway controller — exists only so this spec can drive real
// HTTP requests through the real AuditInterceptor + TransformInterceptor +
// JwtAuthGuard stack, in the exact same registration order as production
// (APP_INTERCEPTOR providers registered during module compilation, then
// TransformInterceptor added via app.useGlobalInterceptors() afterward —
// see audit.interceptor.ts's doc comment for why that order matters).
@Controller({ path: 'tenants/:tenantId/widgets' })
class TestWidgetsController {
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AuditAction('widget.create', 'Widget')
  create(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Body() body: { fail?: boolean; name?: string },
  ) {
    if (body?.fail) {
      throw new BadRequestException('boom');
    }
    return { widgetId: 42, tenantId, name: body?.name ?? 'Widget' };
  }

  @Post('public')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @AuditAction('widget.create_public', 'Widget')
  createPublic(@Param('tenantId', ParseIntPipe) tenantId: number) {
    return { widgetId: 99, tenantId };
  }

  @Get()
  @AuditAction('widget.list', 'Widget')
  list() {
    return { data: [{ widgetId: 1 }], meta: { total: 1 } };
  }
}

describe('AuditInterceptor (real guard + interceptor integration)', () => {
  let app: INestApplication<App>;
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

  const asUser = (overrides: Partial<Record<string, unknown>> = {}) => {
    mockAuthService.decodeToken.mockReturnValue({ sub: '1' });
    mockAuthService.verifyAccessToken.mockResolvedValue({ sub: '1' });
    mockAuthService.resolveUser.mockResolvedValue({
      userId: 5,
      email: 'rita@example.com',
      firstName: 'Rita',
      lastName: 'Sharma',
      roles: ['owner'],
      permissions: [],
      ...overrides,
    });
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    auditRows = [];

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [TestWidgetsController],
      providers: [
        AuditLogService,
        { provide: PrismaService, useValue: fakePrisma },
        { provide: AuthService, useValue: mockAuthService },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    // Registered AFTER module compilation, exactly like main.ts's
    // `app.useGlobalInterceptors(new TransformInterceptor())` — the same
    // relative ordering as production between the module-scanned
    // APP_INTERCEPTOR (AuditInterceptor, above) and this explicit call.
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('(a) a successful mutating request produces exactly one AuditLog row with the right fields', async () => {
    asUser();

    const res = await request(app.getHttpServer())
      .post('/tenants/1/widgets')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({ name: 'Gadget' })
      .expect(201);

    expect((res.body as { data: { widgetId: number } }).data.widgetId).toBe(42);

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      tenantId: 1,
      actorUserId: 5,
      actorLabel: 'Rita Sharma (owner)',
      action: 'widget.create',
      targetType: 'Widget',
      targetId: '42',
    });
    // Proves the interceptor saw the already-transformed `data` object
    // (TransformInterceptor ran first / is innermost), not the outer
    // { success, data } wrapper and not some other raw shape.
    expect(auditRows[0].metadata).toEqual({
      widgetId: 42,
      tenantId: 1,
      name: 'Gadget',
    });
  });

  it('(b) a failed/thrown request produces zero AuditLog rows', async () => {
    asUser();

    await request(app.getHttpServer())
      .post('/tenants/1/widgets')
      .set('Cookie', 'uw_access_token=fake-token')
      .send({ fail: true })
      .expect(400);

    expect(auditRows).toHaveLength(0);
  });

  it('(c) a GET request produces zero AuditLog rows even though the handler carries @AuditAction', async () => {
    asUser();

    await request(app.getHttpServer())
      .get('/tenants/1/widgets')
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(200);

    expect(auditRows).toHaveLength(0);
  });

  it('(d) an anonymous (@Public()) mutating request still produces a row with the anonymous actor label', async () => {
    const res = await request(app.getHttpServer())
      .post('/tenants/1/widgets/public')
      .expect(201);

    expect((res.body as { data: { widgetId: number } }).data.widgetId).toBe(99);

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      tenantId: 1,
      actorUserId: null,
      actorLabel: ANONYMOUS_ACTOR_LABEL,
      action: 'widget.create_public',
      targetType: 'Widget',
      targetId: '99',
    });
  });

  it('rejects an authenticated, non-public request with no auth cookie before ever reaching the handler', async () => {
    await request(app.getHttpServer())
      .post('/tenants/1/widgets')
      .send({ name: 'Gadget' })
      .expect(401);

    expect(auditRows).toHaveLength(0);
  });
});
