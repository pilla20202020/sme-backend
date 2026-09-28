import { JobQueueService } from './job-queue.service';

const mockPrisma = {
  job: {
    create: jest.fn(),
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
  },
};

const makeService = () => new JobQueueService(mockPrisma as never);

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.job.create.mockResolvedValue({ id: 1n });
});

describe('JobQueueService', () => {
  describe('dispatch', () => {
    it('creates a job with the given type, payload, and defaults', async () => {
      await makeService().dispatch('send_email', { to: 'a@b.com' });

      expect(mockPrisma.job.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            jobType: 'send_email',
            payload: { to: 'a@b.com' },
            priority: 5,
            maxRetries: 3,
          }) as never,
        }),
      );
    });
  });

  describe('dispatchForTenant', () => {
    it('merges tenantId into the payload', async () => {
      await makeService().dispatchForTenant(7, 'generate_report', {
        reportType: 'sales',
      });

      expect(mockPrisma.job.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            payload: { reportType: 'sales', tenantId: 7 },
          }) as never,
        }),
      );
    });

    it('records the tenant as the related entity for traceability', async () => {
      await makeService().dispatchForTenant(7, 'generate_report', {});

      expect(mockPrisma.job.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            relatedEntityType: 'tenant',
            relatedEntityId: 7n,
          }) as never,
        }),
      );
    });

    it('does not let the caller override tenantId via the payload', async () => {
      await makeService().dispatchForTenant(7, 'generate_report', {
        tenantId: 999,
      } as never);

      expect(mockPrisma.job.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            payload: { tenantId: 7 },
          }) as never,
        }),
      );
    });
  });
});
