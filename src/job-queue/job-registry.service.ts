import { Injectable } from '@nestjs/common';
import { AppLoggerService } from 'src/common/logger/logger.service';
import { IJobHandler } from './interfaces/job-handler.interface';

@Injectable()
export class JobRegistryService {
  private readonly handlers = new Map<string, IJobHandler>();

  constructor(private readonly logger: AppLoggerService) {
    this.logger.setContext(JobRegistryService.name);
  }

  register(handler: IJobHandler): void {
    if (this.handlers.has(handler.jobType)) {
      this.logger.warn(`Handler for "${handler.jobType}" is being overwritten`);
    }
    this.handlers.set(handler.jobType, handler);
    this.logger.log(`Registered handler for job type: "${handler.jobType}"`);
  }

  get(jobType: string): IJobHandler | undefined {
    return this.handlers.get(jobType);
  }

  getRegisteredTypes(): string[] {
    return Array.from(this.handlers.keys());
  }
}
