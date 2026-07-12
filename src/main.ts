import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Express default body parsers (json + urlencoded) are enabled, so the
    // OAuth2 form-urlencoded /auth/token endpoint works out of the box.
    bodyParser: true,
  });
  const config = app.get(ConfigService);

  // Security headers. The console is a self-contained SPA that loads two CDN
  // scripts (marked, cytoscape), so we allow those explicitly rather than
  // shipping a wide-open CSP.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'script-src': ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'object-src': ["'none'"],
          'frame-ancestors': ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  const corsOrigins = config.get<string[]>('corsOrigins') ?? [];
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    // Reflect only the headers the SPA actually sends; '*' is invalid with credentials.
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Swagger publishes the entire API surface; keep it off in production unless
  // explicitly opted in via EXPOSE_DOCS.
  if (config.get<boolean>('exposeDocs')) {
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
  }

  const port = config.get<number>('port')!;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`SentrAI Console (NestJS) listening on http://localhost:${port}`);
}

void bootstrap();
