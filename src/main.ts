import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger({
      level: 'debug',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.ms(),
        winston.format.json(),
      ),
      defaultMeta: { service: 'docmind-api' },
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.ms(),
            winston.format.simple(),
          ),
        }),
      ],
    }),
  });
  const configService = app.get(ConfigService);

  // Security headers with helmet
  app.use(
    helmet({
      contentSecurityPolicy:
        process.env.NODE_ENV === 'production' ? undefined : false,
    }),
  );

  // Configure CORS
  const isProduction = process.env.NODE_ENV === 'production';
  const corsOriginsConfig = configService.get<string>('corsOrigins');
  const allowedOrigins = corsOriginsConfig
    ? corsOriginsConfig
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    : [];

  app.enableCors({
    origin: isProduction && allowedOrigins.length > 0 ? allowedOrigins : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-api-key',
      'x-workspace-id',
    ],
    credentials: true,
  });

  // Enable graceful shutdown hooks
  app.enableShutdownHooks();

  // Enable global exception filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Enable global HTTP request logging
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Enable automatic DTO validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Configure global API routing prefix and URI-based versioning (/api/v1/...)
  app.setGlobalPrefix('api', {
    exclude: ['/', 'health', 'metrics'],
  });
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Set up Swagger API Documentation
  const config = new DocumentBuilder()
    .setTitle('DocMind API')
    .setDescription('RAG-Based Document Question Answering Backend')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'x-api-key')
    .addSecurityRequirements('x-api-key')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get<number>('port') || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger docs available at: http://localhost:${port}/api/docs`);
}
void bootstrap();
