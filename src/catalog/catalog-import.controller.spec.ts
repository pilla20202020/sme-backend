import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RolesGuard, TenantScopeGuard } from '../auth/guards';
import { CatalogImportController } from './catalog-import.controller';
import { CatalogImportService } from './catalog-import.service';

describe('CatalogImportController (guard integration)', () => {
  let app: INestApplication<App>;

  const mockCatalogImportService = {
    importProducts: jest
      .fn()
      .mockResolvedValue({ created: 0, updated: 0, failed: [] }),
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
      controllers: [CatalogImportController],
      providers: [
        { provide: CatalogImportService, useValue: mockCatalogImportService },
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

  it('rejects POST .../products/import with no auth cookie', async () => {
    await request(app.getHttpServer())
      .post('/tenants/1/products/import')
      .send([{ name: 'X', unit: 'tablet', currentPrice: 1 }])
      .expect(401);

    expect(mockCatalogImportService.importProducts).not.toHaveBeenCalled();
  });

  it('rejects POST .../products/import for an admin missing catalog:create', async () => {
    asAdmin([]);

    await request(app.getHttpServer())
      .post('/tenants/1/products/import')
      .set('Cookie', 'uw_access_token=fake-token')
      .send([{ name: 'X', unit: 'tablet', currentPrice: 1 }])
      .expect(403);

    expect(mockCatalogImportService.importProducts).not.toHaveBeenCalled();
  });

  it('allows POST .../products/import for an admin with catalog:create and passes the raw array through untouched', async () => {
    asAdmin(['catalog:create']);
    const rows = [{ name: 'X', unit: 'tablet', currentPrice: 1 }];

    await request(app.getHttpServer())
      .post('/tenants/1/products/import')
      .set('Cookie', 'uw_access_token=fake-token')
      .send(rows)
      .expect(200);

    expect(mockCatalogImportService.importProducts).toHaveBeenCalledWith(
      1,
      rows,
    );
  });
});
