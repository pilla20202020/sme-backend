import { Global, Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { LoggerModule } from 'src/common/logger/logger.module';
import { ExampleEmailJob } from './examples/example-email.job';
import { JobQueueController } from './job-queue.controller';
import { JobQueueService } from './job-queue.service';
import { JobRegistryService } from './job-registry.service';
import { SchedulerService } from './scheduler.service';
import { WorkerService } from './worker.service';

@Global()
@Module({
  imports: [PrismaModule, LoggerModule],
  controllers: [JobQueueController],
  providers: [
    JobQueueService,
    JobRegistryService,
    WorkerService,
    SchedulerService,
    // Example handler — remove or replace with real handlers
    ExampleEmailJob,
  ],
  exports: [JobQueueService, JobRegistryService, SchedulerService],
})
export class JobQueueModule {}
