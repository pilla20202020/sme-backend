import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';

export class DispatchJobDto {
  @ApiProperty({
    example: 'send_email',
  })
  @IsString()
  jobType: string;

  @ApiProperty({
    example: {
      to: 'test@example.com',
      subject: 'Hello',
      body: 'Test body is this latest',
    },
    required: false,
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
