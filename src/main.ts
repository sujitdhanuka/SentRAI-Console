import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Express default body parsers (json + urlencoded) are enabled, so the
    // OAuth2 form-urlencoded /auth/token endpoint works out of the box.
    bodyParser: true,
  });
  const config = app.get(ConfigService);

  app.enableCors({
    origin: config.get<string[]>('corsOrigins'),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: '*',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('SentRAI - Console')
    .setDescription(
      'RBI SentrAI Framework Compliance Backend. Implements Recommendations 16, 21–26: ' +
        'AI Inventory Ledger, Drift Monitoring, Audit Framework, and Incident Reporting.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = config.get<number>('port')!;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`SentrAI Console (NestJS) listening on http://localhost:${port}`);
}

void bootstrap();
