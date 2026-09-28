import { Module } from '@nestjs/common';
import { AppLoggerService } from './logger.service';
import { buildWinstonLogger } from './winston.config';
import { WINSTON_LOGGER } from './logger.constants';

@Module({
  providers: [
    {
      provide: WINSTON_LOGGER,
      useFactory: buildWinstonLogger,
    },
    AppLoggerService,
  ],
  exports: [AppLoggerService],
})
export class LoggerModule {}
