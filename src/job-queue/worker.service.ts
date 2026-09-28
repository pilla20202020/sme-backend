import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AppLoggerService } from 'src/common/logger/logger.service';
import { JobStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { JobRegistryService } from './job-registry.service';

const POLL_INTERVAL_MS = 20_000;
const CONCURRENCY = 3;

interface ClaimedJob {
  id: bigint;
}

@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private pollTimer: NodeJS.Timeout | null = null;
  private activeJobs = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: JobRegistryService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(WorkerService.name);
  }

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.logger.log(
      `Worker started — polling every ${POLL_INTERVAL_MS / 1000}s, concurrency: ${CONCURRENCY}`,
    );
    this.pollTimer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  private async poll(): Promise<void> {
    const available = CONCURRENCY - this.activeJobs;
    if (available <= 0) return;

    let claimed: ClaimedJob[];
    try {
      claimed = await this.claimJobs(available);
    } catch (err) {
      this.logger.error(
        `Worker poll failed (DB unreachable or table missing): ${err instanceof Error ? err.message : err}`,
      );
      return;
    }

    for (const { id } of claimed) {
      this.activeJobs++;
      void this.runJob(id).finally(() => this.activeJobs--);
    }
  }

  // Atomically claim up to `limit` pending jobs using SKIP LOCKED so
  // concurrent workers never pick up the same row.
  private async claimJobs(limit: number): Promise<ClaimedJob[]> {
    return this.prisma.$queryRaw<ClaimedJob[]>`
      UPDATE jobs
      SET status     = ${JobStatus.running},
          started_at = NOW(),
          updated_at = NOW()
      WHERE id IN (
        SELECT id FROM jobs
        WHERE status IN (${JobStatus.pending}, ${JobStatus.retrying})
          AND (scheduled_at IS NULL OR scheduled_at <= NOW())
        ORDER BY priority ASC, created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `;
  }

  private async failJob(jobId: bigint, reason: string): Promise<void> {
    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        failedAt: new Date(),
        lastError: reason,
      },
    });
  }

  /**
   * The async-job equivalent of TenantScopeGuard for synchronous requests
   * (STORY-004 / PRD NF-06): if a job's payload carries a tenantId (i.e. it
   * was dispatched via JobQueueService.dispatchForTenant), the tenant must
   * still exist and be active before its handler runs — enforced centrally
   * here, not left to each handler to remember.
   */
  private async verifyTenantContext(payload: unknown): Promise<string | null> {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('tenantId' in payload)
    ) {
      return null; // Not a tenant-scoped job — nothing to enforce.
    }

    const tenantId = payload.tenantId;
    if (typeof tenantId !== 'number') {
      return `Invalid tenantId in job payload: ${JSON.stringify(tenantId)}`;
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { tenantId },
      select: { isActive: true },
    });

    if (!tenant) {
      return `Tenant ${tenantId} no longer exists`;
    }
    if (!tenant.isActive) {
      return `Tenant ${tenantId} is no longer active`;
    }
    return null;
  }

  private async runJob(jobId: bigint): Promise<void> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return;

    const handler = this.registry.get(job.jobType);
    if (!handler) {
      this.logger.warn(
        `No handler for job type "${job.jobType}" — marking failed`,
      );
      await this.failJob(
        jobId,
        `No handler registered for type "${job.jobType}"`,
      );
      return;
    }

    const tenantContextError = await this.verifyTenantContext(job.payload);
    if (tenantContextError) {
      this.logger.warn(
        `Job ${jobId} (${job.jobType}) failed tenant-context check: ${tenantContextError}`,
      );
      await this.failJob(jobId, tenantContextError);
      return;
    }

    const attempt = job.retryCount + 1;
    const log = await this.prisma.jobLog.create({
      data: {
        jobId,
        attempt,
        status: JobStatus.running,
        startedAt: new Date(),
      },
    });

    try {
      const output = await handler.handle(job.payload, job.id);

      await this.prisma.$transaction([
        this.prisma.job.update({
          where: { id: jobId },
          data: { status: JobStatus.completed, completedAt: new Date() },
        }),
        this.prisma.jobLog.update({
          where: { id: log.id },
          data: {
            status: JobStatus.completed,
            finishedAt: new Date(),
            output: output !== undefined ? (output as object) : undefined,
          },
        }),
      ]);

      this.logger.log(`Job ${jobId} (${job.jobType}) completed`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const newRetryCount = job.retryCount + 1;
      const exhausted = newRetryCount >= job.maxRetries;

      // Exponential back-off: 30 s, 60 s, 120 s, …
      const backoffMs = Math.pow(2, newRetryCount) * 30_000;
      const retryAt = new Date(Date.now() + backoffMs);

      await this.prisma.$transaction([
        this.prisma.job.update({
          where: { id: jobId },
          data: {
            status: exhausted ? JobStatus.failed : JobStatus.retrying,
            retryCount: newRetryCount,
            lastError: errorMsg,
            failedAt: exhausted ? new Date() : null,
            scheduledAt: exhausted ? undefined : retryAt,
          },
        }),
        this.prisma.jobLog.update({
          where: { id: log.id },
          data: {
            status: exhausted ? JobStatus.failed : JobStatus.retrying,
            finishedAt: new Date(),
            errorDetail: errorMsg,
          },
        }),
      ]);

      this.logger.error(
        `Job ${jobId} (${job.jobType}) failed (attempt ${attempt}/${job.maxRetries}): ${errorMsg}`,
      );
    }
  }
}
