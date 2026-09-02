import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';

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

  // Enable automatic DTO validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Set up Swagger API Documentation
  const config = new DocumentBuilder()
    .setTitle('DocMind API')
    .setDescription('RAG-Based Document Question Answering Backend')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get<number>('port') || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger docs available at: http://localhost:${port}/api/docs`);
}
void bootstrap();
