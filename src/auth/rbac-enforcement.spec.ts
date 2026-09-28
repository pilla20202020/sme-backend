import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard, RolesGuard, TenantScopeGuard } from './guards';
import { BranchesController } from '../branches/branches.controller';
import { BranchesService } from '../branches/branches.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantsService } from '../tenants/tenants.service';
import { UsersService } from '../users/users.service';

/**
 * Proves STORY-003's core claim end to end against the REAL local database
 * (seeded roles/permissions, real Prisma queries) rather than assumed mock
 * data: a business owner invites staff with specific roles, and the
 * server-side guard chain enforces exactly what each role's seeded
 * permissions allow — nothing more.
 *
 * No purchase-order module exists yet (that's EPIC-004, a later sprint), so
 * this substitutes the nearest real protected resource — branch reads — for
 * the backlog's literal "cashier attempts a purchase-order action" example.
 * The mechanism under test (RolesGuard + PermissionsGuard reading a real
 * user's real seeded permissions) is identical regardless of which
 * resource sits behind it.
 *
 * The only thing faked here is JWT/JWKS verification (a genuine external
 * network boundary) — role/permission resolution itself runs for real
 * against the seeded local Postgres database.
 */
describe('RBAC enforcement (real DB, real invited roles)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tenantsService: TenantsService;
  let usersService: UsersService;
  let tenantId: number;

  const mockAuthService = {
    decodeToken: jest.fn(),
    verifyAccessToken: jest.fn(),
    resolveUser: jest.fn(),
  };

  const asInvitedUser = (userId: number, roleName: string) => {
    mockAuthService.decodeToken.mockReturnValue({ sub: String(userId) });
    mockAuthService.verifyAccessToken.mockResolvedValue({
      sub: String(userId),
    });
    mockAuthService.resolveUser.mockImplementation(async () => {
      // Mirrors AuthService.resolveUser's own query shape, but keyed by
      // userId (invited users have no ssoUserId) — this is the one place
      // this test steps outside the real AuthService, since real login
      // (STORY-005) doesn't exist yet to produce a session for these users.
      const dbUser = await prisma.user.findUnique({
        where: { userId },
        select: {
          userId: true,
          tenantId: true,
          email: true,
          firstName: true,
          lastName: true,
          roles: {
            select: {
              role: {
                select: {
                  roleName: true,
                  permissions: {
                    select: { permission: { select: { name: true } } },
                  },
                },
              },
            },
          },
        },
      });
      if (!dbUser) return null;
      const roles = dbUser.roles.map((ur) => ur.role.roleName);
      const permissions = [
        ...new Set(
          dbUser.roles.flatMap((ur) =>
            ur.role.permissions.map((rp) => rp.permission.name),
          ),
        ),
      ];
      expect(roles).toContain(roleName);
      return {
        userId: dbUser.userId,
        tenantId: dbUser.tenantId,
        email: dbUser.email,
        firstName: dbUser.firstName,
        lastName: dbUser.lastName,
        roles,
        permissions,
      };
    });
  };

  let cashierUserId: number;
  let managerUserId: number;
  let otherTenantId: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [BranchesController],
      providers: [
        BranchesService,
        TenantsService,
        UsersService,
        PrismaService,
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

    prisma = moduleFixture.get(PrismaService);
    tenantsService = moduleFixture.get(TenantsService);
    usersService = moduleFixture.get(UsersService);

    const tenant = await tenantsService.register({
      name: `RBAC Test Pharmacy ${Date.now()}`,
    });
    tenantId = tenant.tenantId;

    const cashier = await usersService.inviteToTenant(tenantId, {
      email: `cashier-${Date.now()}@example.com`,
      firstName: 'Cash',
      lastName: 'Ier',
      roleName: 'cashier',
      password: 'Sup3rSecret!',
    });
    cashierUserId = cashier.userId;

    const manager = await usersService.inviteToTenant(tenantId, {
      email: `manager-${Date.now()}@example.com`,
      firstName: 'Man',
      lastName: 'Ager',
      roleName: 'manager',
      password: 'Sup3rSecret!',
    });
    managerUserId = manager.userId;

    const otherTenant = await tenantsService.register({
      name: `RBAC Other Tenant ${Date.now()}`,
    });
    otherTenantId = otherTenant.tenantId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('denies a cashier read access to branches — seeded cashier role has zero permissions', async () => {
    asInvitedUser(cashierUserId, 'cashier');

    await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/branches`)
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(403);
  });

  it('denies a cashier the ability to create a branch', async () => {
    asInvitedUser(cashierUserId, 'cashier');

    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/branches`)
      .set('Cookie', 'uw_access_token=fake-token')
      .send({ name: 'Should Not Be Created' })
      .expect(403);
  });

  it('allows a manager to read branches — seeded manager role has branch:read', async () => {
    asInvitedUser(managerUserId, 'manager');

    await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/branches`)
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(200);
  });

  it('still denies a manager the ability to create a branch — branch:create is owner/admin only', async () => {
    asInvitedUser(managerUserId, 'manager');

    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/branches`)
      .set('Cookie', 'uw_access_token=fake-token')
      .send({ name: 'Should Not Be Created' })
      .expect(403);
  });

  it('denies a manager reading branches under a DIFFERENT tenant than the one they were invited into, despite holding branch:read', async () => {
    asInvitedUser(managerUserId, 'manager');

    await request(app.getHttpServer())
      .get(`/tenants/${otherTenantId}/branches`)
      .set('Cookie', 'uw_access_token=fake-token')
      .expect(403);
  });
});
