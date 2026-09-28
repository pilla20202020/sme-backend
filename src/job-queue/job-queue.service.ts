import { Injectable } from '@nestjs/common';
import { JobStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { TenantScopedPayload } from './interfaces/tenant-scoped-payload.interface';

export interface DispatchOptions {
  priority?: number;
  scheduledAt?: Date;
  maxRetries?: number;
  relatedEntityType?: string;
  relatedEntityId?: bigint;
  createdBy?: number;
}

@Injectable()
export class JobQueueService {
  constructor(private readonly prisma: PrismaService) {}

  async dispatch<T = unknown>(
    jobType: string,
    payload?: T,
    options: DispatchOptions = {},
  ): Promise<bigint> {
    const job = await this.prisma.job.create({
      data: {
        jobType,
        payload: payload !== undefined ? (payload as object) : undefined,
        priority: options.priority ?? 5,
        scheduledAt: options.scheduledAt ?? null,
        maxRetries: options.maxRetries ?? 3,
        relatedEntityType: options.relatedEntityType,
        relatedEntityId: options.relatedEntityId,
        createdBy: options.createdBy,
      },
    });

    return job.id;
  }

  /**
   * Dispatches a job that touches tenant-owned data. Carries tenantId
   * through in the payload (so WorkerService can re-verify the tenant is
   * still valid immediately before the handler runs — the async-job
   * equivalent of TenantScopeGuard, per STORY-004 / PRD NF-06) and records
   * it as the job's related entity for traceability/auditing.
   */
  async dispatchForTenant<T extends object>(
    tenantId: number,
    jobType: string,
    payload: T,
    options: Omit<
      DispatchOptions,
      'relatedEntityType' | 'relatedEntityId'
    > = {},
  ): Promise<bigint> {
    const tenantScopedPayload: T & TenantScopedPayload = {
      ...payload,
      tenantId,
    };

    return this.dispatch(jobType, tenantScopedPayload, {
      ...options,
      relatedEntityType: 'tenant',
      relatedEntityId: BigInt(tenantId),
    });
  }

  async dispatchAt<T = unknown>(
    jobType: string,
    scheduledAt: Date,
    payload?: T,
    options: Omit<DispatchOptions, 'scheduledAt'> = {},
  ): Promise<bigint> {
    return this.dispatch(jobType, payload, { ...options, scheduledAt });
  }

  async cancel(jobId: bigint): Promise<boolean> {
    const result = await this.prisma.job.updateMany({
      where: {
        id: jobId,
        status: { in: [JobStatus.pending, JobStatus.retrying] },
      },
      data: { status: JobStatus.cancelled },
    });

    return result.count > 0;
  }

  async getJob(jobId: bigint) {
    return this.prisma.job.findUnique({
      where: { id: jobId },
      include: { logs: { orderBy: { createdAt: 'desc' } } },
    });
  }

  async getPendingCount(jobType?: string): Promise<number> {
    return this.prisma.job.count({
      where: {
        status: { in: [JobStatus.pending, JobStatus.retrying] },
        ...(jobType ? { jobType } : {}),
      },
    });
  }
}
