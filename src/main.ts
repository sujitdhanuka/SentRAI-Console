import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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
          'script-src': ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com', 'https://www.googletagmanager.com'],
          // The console uses inline event handlers (onclick, onsubmit, ...);
          // allow them, consistent with 'unsafe-inline' already on script-src.
          // Helmet's default sets this to 'none', which would break the SPA.
          'script-src-attr': ["'unsafe-inline'"],
          // The consoles load their typefaces (Archivo / Source Serif /
          // IBM Plex Mono) from Google Fonts — without these two entries the
          // CSP silently drops them and every page falls back to system fonts.
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
          // Google Analytics: the gtag loader beacons to google-analytics /
          // googletagmanager endpoints (regional hosts, hence wildcards) and
          // may fall back to an image pixel when fetch is unavailable.
          'img-src': ["'self'", 'data:', 'https://*.google-analytics.com', 'https://www.googletagmanager.com'],
          'connect-src': ["'self'", 'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com'],
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
  // Surface the data-durability posture on boot so a redeploy log makes it
  // obvious whether data lands in the persistent DB or a disposable file.
  const dbProvider = config.get<string>('dbProvider');
  const dbPersistent = config.get<boolean>('dbPersistent');
  // eslint-disable-next-line no-console
  console.log(`SentrAI Console (NestJS) listening on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(
    `Database: ${dbProvider} (${dbPersistent ? 'persistent — data survives redeploys' : 'EPHEMERAL — data is wiped on every redeploy'})`,
  );

  // Optional one-shot demo seed (idempotent). Set SEED_DEMO_TENANT=true to
  // provision the "Meridian Finance" demonstration tenant + a read-only judge
  // account on this instance — e.g. for an award/evaluation review — with no
  // command line or password handling: it authenticates as the already-seeded
  // admin against localhost and reuses scripts/seed-demo.mjs. Unset the flag
  // once seeded (re-running is harmless but does needless work each boot).
  if (['1', 'true', 'yes'].includes(String(process.env.SEED_DEMO_TENANT ?? '').toLowerCase())) {
    const seed = config.get<{ email: string; password: string | null }>('seedAdmin');
    const script = join(process.cwd(), 'scripts', 'seed-demo.mjs');
    if (!seed?.password) {
      // eslint-disable-next-line no-console
      console.warn('[demo-seed] SEED_DEMO_TENANT set but no SEED_ADMIN_PASSWORD — skipping.');
    } else if (!existsSync(script)) {
      // eslint-disable-next-line no-console
      console.warn(`[demo-seed] SEED_DEMO_TENANT set but ${script} not found — skipping.`);
    } else {
      // eslint-disable-next-line no-console
      console.log('[demo-seed] provisioning Meridian demo tenant + read-only judge account…');
      const child = spawn(process.execPath, [script], {
        env: {
          ...process.env,
          SENTRAI_URL: `http://127.0.0.1:${port}`,
          SENTRAI_ADMIN_EMAIL: seed.email,
          SENTRAI_ADMIN_PASSWORD: seed.password,
        },
        stdio: 'inherit',
      });
      // eslint-disable-next-line no-console
      child.on('exit', (code) => console.log(`[demo-seed] finished (exit ${code}).`));
      // eslint-disable-next-line no-console
      child.on('error', (e) => console.warn(`[demo-seed] failed to start: ${String(e)}`));
    }
  }
}

void bootstrap();
