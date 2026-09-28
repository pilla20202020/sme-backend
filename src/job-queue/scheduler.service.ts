import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AppLoggerService } from 'src/common/logger/logger.service';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { JobQueueService } from './job-queue.service';
import { getNextCronRunDate } from './utils/cron-helper';

const SCHEDULER_INTERVAL_MS = 60_000; // check every minute

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueueService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(SchedulerService.name);
  }

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.logger.log('Recurring job scheduler started');
    this.timer = setInterval(() => void this.tick(), SCHEDULER_INTERVAL_MS);
    // Run immediately on startup so we don't wait a full minute
    void this.tick();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    const now = new Date();

    let due: Awaited<
      ReturnType<typeof this.prisma.recurringJobSchedule.findMany>
    >;
    try {
      due = await this.prisma.recurringJobSchedule.findMany({
        where: {
          isActive: true,
          OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
        },
      });
    } catch (err) {
      this.logger.error(
        `Scheduler tick failed (DB unreachable or table missing): ${err instanceof Error ? err.message : err}`,
      );
      return;
    }

    for (const schedule of due) {
      try {
        await this.queue.dispatch(
          schedule.jobType,
          schedule.payloadTemplate ?? undefined,
        );

        const nextRunAt = getNextCronRunDate(schedule.cronExpression, now);

        await this.prisma.recurringJobSchedule.update({
          where: { id: schedule.id },
          data: { lastRunAt: now, nextRunAt },
        });

        this.logger.log(
          `Dispatched recurring job "${schedule.name}" (${schedule.jobType}), next run: ${nextRunAt.toISOString()}`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to dispatch recurring job "${schedule.name}": ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  async registerSchedule(
    name: string,
    jobType: string,
    cronExpression: string,
    payloadTemplate?: Record<string, unknown>,
  ): Promise<void> {
    const nextRunAt = getNextCronRunDate(cronExpression, new Date());
    const jsonPayload = payloadTemplate as Prisma.InputJsonValue | undefined;

    await this.prisma.recurringJobSchedule.upsert({
      where: { name },
      create: {
        name,
        jobType,
        cronExpression,
        payloadTemplate: jsonPayload,
        nextRunAt,
      },
      update: {
        jobType,
        cronExpression,
        payloadTemplate: jsonPayload,
        nextRunAt,
        isActive: true,
      },
    });

    this.logger.log(
      `Recurring schedule upserted: "${name}" (${cronExpression})`,
    );
  }

  async pauseSchedule(name: string): Promise<void> {
    await this.prisma.recurringJobSchedule.update({
      where: { name },
      data: { isActive: false },
    });
  }

  async resumeSchedule(name: string): Promise<void> {
    await this.prisma.recurringJobSchedule.update({
      where: { name },
      data: { isActive: true },
    });
  }
}
