import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IJobHandler } from '../interfaces/job-handler.interface';
import { JobRegistryService } from '../job-registry.service';

interface SendEmailPayload {
  to: string;
  subject: string;
  body: string;
}

/**
 * Example job handler — copy this pattern to create your own jobs.
 *
 * 1. Implement IJobHandler with a unique jobType string.
 * 2. Inject JobRegistryService and call registry.register(this) in onModuleInit.
 * 3. Add this class as a provider in its feature module.
 * 4. Dispatch via: jobQueueService.dispatch('send_email', payload)
 */
@Injectable()
export class ExampleEmailJob
  implements IJobHandler<SendEmailPayload>, OnModuleInit
{
  readonly jobType = 'send_email';
  private readonly logger = new Logger(ExampleEmailJob.name);

  constructor(private readonly registry: JobRegistryService) {}

  onModuleInit() {
    this.registry.register(this);
  }

  async handle(payload: SendEmailPayload, jobId: bigint): Promise<void> {
    this.logger.log(
      `[Job ${jobId}] Sending email to ${payload.to}: ${payload.subject}`,
    );
    // Replace with real email sending logic
    await new Promise((r) => setTimeout(r, 200));
    this.logger.log(`[Job ${jobId}] Email sent successfully`);
  }
}
