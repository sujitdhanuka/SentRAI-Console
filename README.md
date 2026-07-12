# SentrAI Compliance Console — Node.js (NestJS) Edition

A full port of the Python/FastAPI SentrAI Compliance Console to **NestJS + TypeScript**,
built so it can be hosted on **Hostinger** (or any Node host) with no Python runtime. It
serves the original single-page dashboard unchanged and reproduces every API endpoint and
business rule of the Python backend.

- **Runtime:** NestJS 10 + TypeScript, Express platform
- **Database:** TypeORM — **SQLite** locally, **MariaDB/MySQL** in production, chosen from one env var
- **Auth:** JWT (Passport), bcrypt password hashing, role-based access control
- **Discovery:** regex + **web-tree-sitter (WASM)** AST scanning, remote GitHub/GitLab scan, k8s/Triton infra scan
- **Compliance:** 7-Sutras + NIST/EU-AI-Act/ISO-42001 validators, plugin registry
- **Monitoring:** PSI + 1-D Wasserstein drift math (pure TS), BCP circuit breaker
- **Extras:** PDF export (pdfkit), Prometheus `/metrics`, DPDP PII masking, scheduled jobs, Neo4j lineage

## Quick start (local, SQLite)

```bash
cp .env.example .env         # DB_PROVIDER=sqlite is the default
npm install
npm run start:dev            # http://localhost:8002
```

Open http://localhost:8002 for the public landing page (product, pricing, responsible-AI
overview), then head to http://localhost:8002/console and sign in with the seeded admin:

- **Email:** `admin@sentrai.local`
- **Password:** `admin123`

API docs (Swagger) are at `/docs`.

## Production build & run

```bash
npm ci
npm run build
npm run start:prod           # node dist/main
```

## Configuration (`.env`)

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port | `8002` |
| `CORS_ORIGINS` | Comma-separated allowed origins | `http://localhost:8002` |
| `DB_PROVIDER` | `sqlite` (local) or `mariadb` (prod) | `sqlite` |
| `SQLITE_PATH` | SQLite file path (sqlite only) | `./dev.db` |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | MariaDB connection (mariadb only) | — |
| `DB_SYNCHRONIZE` | Auto-create schema on boot (vs migrations) | `true` |
| `JWT_SECRET` | HS256 signing secret — **set a strong value in prod** | dev fallback |
| `NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD` | Optional graph lineage (runs in mock mode if unreachable) | — |
| `PSI_WARNING_THRESHOLD` / `PSI_ALERT_THRESHOLD` / `INVENTORY_UPDATE_SLA_DAYS` | Thresholds | `0.10` / `0.20` / `180` |

## Deploying on Hostinger

1. In hPanel, create a **Node.js application** (Node 20+), pointing at the repository root.
   Set the **application startup file** to `dist/main.js` and the **build command**
   to `npm run build`.
2. Create a **MariaDB database** from hPanel and note its host/user/password/name.
3. Set the app's environment variables in hPanel:
   ```
   DB_PROVIDER=mariadb
   DB_HOST=<hostinger db host>
   DB_PORT=3306
   DB_USER=<db user>
   DB_PASSWORD=<db password>
   DB_NAME=<db name>
   DB_SYNCHRONIZE=true          # or false + run migrations (see below)
   JWT_SECRET=<a long random string>
   CORS_ORIGINS=https://<your-domain>
   ```
4. Deploy. On first boot the schema is created (or run migrations) and the default admin is
   seeded. **Change the admin password immediately** via the Users tab.

### Schema management

- **Simple (default):** `DB_SYNCHRONIZE=true` auto-creates/updates tables on boot — fine for
  a single-instance console.
- **Controlled:** set `DB_SYNCHRONIZE=false` and manage schema with migrations:
  ```bash
  npm run migration:generate -- src/database/migrations/Init
  npm run migration:run
  ```

## Architecture

```
src/
  main.ts, app.module.ts        bootstrap, global JWT + roles guards, static serving, Swagger
  config/                       env-driven configuration
  common/                       enums, decorators (@Public, @Roles, @CurrentUser), guards, dpdp, password
  database/                     TypeORM entities, dual-DB DataSource factory, admin seed
  auth/                         JWT strategy, login/refresh/register/me
  organizations/ users/ projects/ inventory/ incidents/ monitoring/ audit/ metrics/
  compliance/                   sutras + framework validators, plugin registry, PDF generator
  domain/                       triage, drift math, incident SLA, audit-trail factory (pure logic)
  discovery/                    scanner, tree-sitter, connectors, agents, neo4j
  tasks/                        scheduled cron jobs
public/                         landing page (landing.html, served at /) + the dashboard (index.html, served at /console) + static/, docs/
```

## Tests

```bash
npm test                       # unit tests (drift math, validators, plugins, triage)
npm run test:e2e               # supertest end-to-end over an in-memory SQLite DB
```

## Notable fixes vs. the Python original

- **`/metrics` drift alerts:** the Python code compared drift status against lowercase strings
  that never matched the uppercase `DriftStatus` values, so it always reported `0`. Fixed to
  count `WARNING`, `CIRCUIT_BREAKER_TRIPPED`, and `HUMAN_REVIEW_REQUIRED`.
- **PDF export endpoint** is public (the dashboard opens it via a plain `<a href>` that cannot
  carry a bearer token; the model id is an unguessable UUID). In the Python app that link
  returned 401.
- **`/auth/me`** returns the real `full_name` (the access token now carries a `name` claim);
  the Python version returned an empty string.
- **RBI plugin** now builds a complete model entry so it actually evaluates the sutras (the
  Python version always hit an exception branch and returned an error placeholder).
- **Tree-sitter** degrades gracefully to regex-only if the WASM grammars can't load, so the
  app never hard-fails on a restricted host (the Python import was unguarded).
