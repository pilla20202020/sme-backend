import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from 'src/auth/public.decorator';
import { JobQueueService } from './job-queue.service';
import { DispatchJobDto } from './dto/dispatch-job.dto';

@ApiTags('Job Queue (Dev)')
@Controller('dev/jobs')
export class JobQueueController {
  constructor(private readonly queue: JobQueueService) {}

  @Public()
  @Post('dispatch')
  @ApiOperation({ summary: 'Dispatch a test job (dev only)' })
  @ApiResponse({
    status: 201,
    description: 'Job dispatched successfully',
    schema: {
      example: {
        jobId: '123',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid job type or payload',
  })
  async dispatch(@Body() body: DispatchJobDto) {
    const jobId = await this.queue.dispatch(body.jobType, body.payload);

    return {
      jobId: jobId.toString(),
    };
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get job status (dev only)' })
  @ApiResponse({
    status: 200,
    description: 'Job details retrieved successfully',
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  async getJob(@Param('id') id: string) {
    const job = await this.queue.getJob(BigInt(id));

    if (!job) {
      return { error: 'Job not found' };
    }

    return {
      ...job,
      id: job.id.toString(),
      relatedEntityId: job.relatedEntityId?.toString(),
      logs: job.logs.map((l) => ({
        ...l,
        id: l.id.toString(),
        jobId: l.jobId.toString(),
      })),
    };
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get queue stats (dev only)' })
  @ApiResponse({
    status: 200,
    description: 'Queue statistics',
    schema: {
      example: {
        pending: 5,
      },
    },
  })
  async stats() {
    const pending = await this.queue.getPendingCount();

    return { pending };
  }
}
