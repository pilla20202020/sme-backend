import { JobStatus } from '@prisma/client';
import { WorkerService } from './worker.service';

const mockLogger = {
  setContext: jest.fn().mockReturnThis(),
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const mockPrisma = {
  job: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  jobLog: {
    create: jest.fn(),
    update: jest.fn(),
  },
  tenant: {
    findUnique: jest.fn(),
  },
  $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
};

const mockHandler = { jobType: 'generate_report', handle: jest.fn() };
const mockRegistry = { get: jest.fn().mockReturnValue(mockHandler) };

// runJob is private — invoked via an explicit cast, the standard way to
// exercise private methods directly rather than only through the polling
// timer (which is disabled in the 'test' NODE_ENV anyway).
const callRunJob = (service: WorkerService, jobId: bigint) =>
  (service as unknown as { runJob(id: bigint): Promise<void> }).runJob(jobId);

const makeService = () =>
  new WorkerService(
    mockPrisma as never,
    mockRegistry as never,
    mockLogger as never,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.jobLog.create.mockResolvedValue({ id: 1n });
  mockPrisma.job.update.mockResolvedValue({});
  mockPrisma.jobLog.update.mockResolvedValue({});
});

describe('WorkerService — tenant-context enforcement (STORY-004 / NF-06)', () => {
  it('runs the handler normally for a job with no tenantId in its payload', async () => {
    mockPrisma.job.findUnique.mockResolvedValue({
      id: 1n,
      jobType: 'generate_report',
      payload: { format: 'csv' },
      retryCount: 0,
      maxRetries: 3,
    });

    await callRunJob(makeService(), 1n);

    expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
    expect(mockHandler.handle).toHaveBeenCalledWith({ format: 'csv' }, 1n);
  });

  it('runs the handler when the tenant-scoped job payload references an active tenant', async () => {
    mockPrisma.job.findUnique.mockResolvedValue({
      id: 2n,
      jobType: 'generate_report',
      payload: { tenantId: 7, format: 'csv' },
      retryCount: 0,
      maxRetries: 3,
    });
    mockPrisma.tenant.findUnique.mockResolvedValue({ isActive: true });

    await callRunJob(makeService(), 2n);

    expect(mockPrisma.tenant.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 7 } }),
    );
    expect(mockHandler.handle).toHaveBeenCalledWith(
      { tenantId: 7, format: 'csv' },
      2n,
    );
  });

  it('fails the job WITHOUT calling the handler when the referenced tenant no longer exists', async () => {
    mockPrisma.job.findUnique.mockResolvedValue({
      id: 3n,
      jobType: 'generate_report',
      payload: { tenantId: 999 },
      retryCount: 0,
      maxRetries: 3,
    });
    mockPrisma.tenant.findUnique.mockResolvedValue(null);

    await callRunJob(makeService(), 3n);

    expect(mockHandler.handle).not.toHaveBeenCalled();
    expect(mockPrisma.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 3n },
        data: expect.objectContaining({
          status: JobStatus.failed,
          lastError: expect.stringContaining('no longer exists') as unknown,
        }) as never,
      }),
    );
  });

  it('fails the job WITHOUT calling the handler when the referenced tenant is inactive', async () => {
    mockPrisma.job.findUnique.mockResolvedValue({
      id: 4n,
      jobType: 'generate_report',
      payload: { tenantId: 7 },
      retryCount: 0,
      maxRetries: 3,
    });
    mockPrisma.tenant.findUnique.mockResolvedValue({ isActive: false });

    await callRunJob(makeService(), 4n);

    expect(mockHandler.handle).not.toHaveBeenCalled();
    expect(mockPrisma.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 4n },
        data: expect.objectContaining({
          status: JobStatus.failed,
          lastError: expect.stringContaining('no longer active') as unknown,
        }) as never,
      }),
    );
  });

  it('never creates a job-log entry for a job that failed tenant-context enforcement', async () => {
    mockPrisma.job.findUnique.mockResolvedValue({
      id: 5n,
      jobType: 'generate_report',
      payload: { tenantId: 999 },
      retryCount: 0,
      maxRetries: 3,
    });
    mockPrisma.tenant.findUnique.mockResolvedValue(null);

    await callRunJob(makeService(), 5n);

    expect(mockPrisma.jobLog.create).not.toHaveBeenCalled();
  });
});
