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

  // CI scan payloads carry a repository snapshot, so the default 100kb JSON
  // limit is far too small — raise it (the CI token guard + rate limiter bound
  // the abuse surface). Configurable via CI_MAX_PAYLOAD_MB.
  const maxPayloadMb = parseInt(process.env.CI_MAX_PAYLOAD_MB ?? '25', 10);
  app.useBodyParser('json', { limit: `${maxPayloadMb}mb` });

  // Security headers. The console is a self-contained SPA that loads two CDN
  // scripts (marked, cytoscape), so we allow those explicitly rather than
  // shipping a wide-open CSP.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'script-src': ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'],
          // The console uses inline event handlers (onclick, onsubmit, ...);
          // allow them, consistent with 'unsafe-inline' already on script-src.
          // Helmet's default sets this to 'none', which would break the SPA.
          'script-src-attr': ["'unsafe-inline'"],
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
