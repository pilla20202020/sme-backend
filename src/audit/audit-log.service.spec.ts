import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService, ANONYMOUS_ACTOR_LABEL } from './audit-log.service';

describe('AuditLogService', () => {
  let service: AuditLogService;

  const fakePrisma = {
    auditLog: {
      create: jest.fn<Promise<unknown>, [{ data: Record<string, unknown> }]>(),
      findMany: jest.fn<
        Promise<unknown[]>,
        [{ where: Record<string, unknown>; skip: number; take: number }]
      >(),
      count: jest.fn<Promise<number>, [{ where: Record<string, unknown> }]>(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: PrismaService, useValue: fakePrisma },
      ],
    }).compile();

    service = module.get(AuditLogService);
  });

  describe('extractTargetId', () => {
    it('extracts the first key ending in "Id" from a response data object', () => {
      expect(
        service.extractTargetId({ productId: 42, name: 'Paracetamol' }),
      ).toBe('42');
    });

    it('prefers the first "Id"-suffixed key when several exist', () => {
      expect(
        service.extractTargetId({
          receiptId: 7,
          purchaseOrderId: 3,
        }),
      ).toBe('7');
    });

    it('stringifies a string-valued id', () => {
      expect(service.extractTargetId({ targetId: 'abc-123' })).toBe('abc-123');
    });

    it('returns null when no key ends in "Id"', () => {
      expect(
        service.extractTargetId({ name: 'no id here', count: 5 }),
      ).toBeNull();
    });

    it('returns null for null/undefined data', () => {
      expect(service.extractTargetId(null)).toBeNull();
      expect(service.extractTargetId(undefined)).toBeNull();
    });

    it('returns null for an array (e.g. a bulk-import/paginated response)', () => {
      expect(service.extractTargetId([{ productId: 1 }])).toBeNull();
    });

    it('returns null for a primitive', () => {
      expect(service.extractTargetId('just a string')).toBeNull();
      expect(service.extractTargetId(42)).toBeNull();
    });
  });

  describe('buildActorLabel', () => {
    it('returns the anonymous label when no user is present', () => {
      expect(service.buildActorLabel(undefined)).toBe(ANONYMOUS_ACTOR_LABEL);
      expect(service.buildActorLabel(null)).toBe(ANONYMOUS_ACTOR_LABEL);
    });

    it('builds "First Last (roles)" for a resolved user', () => {
      expect(
        service.buildActorLabel({
          firstName: 'Rita',
          lastName: 'Sharma',
          roles: ['owner'],
        }),
      ).toBe('Rita Sharma (owner)');
    });

    it('joins multiple roles with a comma', () => {
      expect(
        service.buildActorLabel({
          firstName: 'A',
          lastName: 'B',
          roles: ['admin', 'owner'],
        }),
      ).toBe('A B (admin,owner)');
    });
  });

  describe('record', () => {
    it('writes an AuditLog row via prisma.auditLog.create', async () => {
      fakePrisma.auditLog.create.mockResolvedValue({});

      await service.record({
        tenantId: 1,
        actorUserId: 5,
        actorLabel: 'Rita Sharma (owner)',
        action: 'branch.create',
        targetType: 'Branch',
        targetId: '9',
        metadata: { branchId: 9, name: 'Downtown' },
      });

      expect(fakePrisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          tenantId: 1,
          actorUserId: 5,
          actorLabel: 'Rita Sharma (owner)',
          action: 'branch.create',
          targetType: 'Branch',
          targetId: '9',
          metadata: { branchId: 9, name: 'Downtown' },
        },
      });
    });

    it('stores Prisma.JsonNull when metadata is null/undefined', async () => {
      fakePrisma.auditLog.create.mockResolvedValue({});

      await service.record({
        tenantId: 1,
        actorUserId: null,
        actorLabel: ANONYMOUS_ACTOR_LABEL,
        action: 'tenant.create',
        targetType: 'Tenant',
        targetId: null,
        metadata: undefined,
      });

      const call = fakePrisma.auditLog.create.mock.calls[0][0];
      expect(call.data.metadata).toBe(Prisma.JsonNull);
    });

    it('never throws when the write fails — logs and swallows the error', async () => {
      fakePrisma.auditLog.create.mockRejectedValue(new Error('DB is down'));

      await expect(
        service.record({
          tenantId: 1,
          actorUserId: null,
          actorLabel: ANONYMOUS_ACTOR_LABEL,
          action: 'tenant.create',
          targetType: 'Tenant',
          targetId: '1',
          metadata: { tenantId: 1 },
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('findAll', () => {
    it('combines actorUserId/action/from/to filters', async () => {
      fakePrisma.auditLog.findMany.mockResolvedValue([]);
      fakePrisma.auditLog.count.mockResolvedValue(0);

      await service.findAll(1, {
        page: 1,
        per_page: 25,
        actorUserId: 5,
        action: 'branch.create',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-31T23:59:59.000Z',
      });

      const where = fakePrisma.auditLog.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        tenantId: 1,
        actorUserId: 5,
        action: 'branch.create',
      });
      expect(where.createdAt).toEqual({
        gte: new Date('2026-01-01T00:00:00.000Z'),
        lte: new Date('2026-01-31T23:59:59.000Z'),
      });
    });

    it('omits filters that were not provided', async () => {
      fakePrisma.auditLog.findMany.mockResolvedValue([]);
      fakePrisma.auditLog.count.mockResolvedValue(0);

      await service.findAll(1, { page: 1, per_page: 25 });

      const where = fakePrisma.auditLog.findMany.mock.calls[0][0].where;
      expect(where).toEqual({ tenantId: 1 });
    });

    it('maps a bigint id to a string and paginates correctly', async () => {
      fakePrisma.auditLog.findMany.mockResolvedValue([
        {
          id: BigInt(7),
          tenantId: 1,
          actorUserId: 5,
          actorLabel: 'Rita Sharma (owner)',
          action: 'branch.create',
          targetType: 'Branch',
          targetId: '9',
          metadata: { branchId: 9 },
          createdAt: new Date('2026-01-05T10:00:00Z'),
        },
      ]);
      fakePrisma.auditLog.count.mockResolvedValue(1);

      const result = await service.findAll(1, { page: 1, per_page: 25 });

      expect(result.data[0].id).toBe('7');
      expect(typeof result.data[0].id).toBe('string');
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        per_page: 25,
        total_pages: 1,
      });
    });
  });
});
