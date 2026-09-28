import {
  BadRequestException,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { dd as ddFn } from './common/utils/dd';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  global.dd = ddFn;

  app.use(cookieParser());
  app.use(helmet());

  const allowedOrigins = (
    process.env.FRONTEND_URL ||
    (process.env.NODE_ENV === 'production'
      ? (() => {
          throw new Error('FRONTEND_URL is not configured');
        })()
      : 'http://localhost:5173')
  )
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Signature-256'],
    credentials: true,
  });

  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      stopAtFirstError: false,

      exceptionFactory: (errors) => {
        return new BadRequestException({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          errors: errors.map((error) => ({
            field: error.property,
            messages: Object.values(error.constraints || {}),
            value: error.value as unknown,
          })),
        });
      },
    }),
  );

  app.useGlobalInterceptors(new TransformInterceptor());

  if (process.env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('AI SME Backend API')
      .setDescription(
        'AI SME Operating System backend — auth, tenants, and business operations',
      )
      .setVersion('1.0')
      .addCookieAuth('uw_access_token')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(3000);
}
void bootstrap();
