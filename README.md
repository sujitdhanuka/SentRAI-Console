# SentrAI Compliance Console — Node.js (NestJS) Edition

A full port of the Python/FastAPI SentrAI Compliance Console to **NestJS + TypeScript**,
built so it can be hosted on **Hostinger** (or any Node host) with no Python runtime. It
serves the original single-page dashboard unchanged and reproduces every API endpoint and
business rule of the Python backend.

- **Runtime:** NestJS 10 + TypeScript, Express platform
- **Database:** TypeORM — **SQLite** locally, **MariaDB/MySQL** in production, chosen from one env var
- **Auth:** JWT (Passport), bcrypt password hashing, role-based access control
- **Discovery:** regex + **web-tree-sitter (WASM)** AST scanning with alias/variable resolution (renamed clients
  attributed to their SDK) and data-flow-lite model-usage detection (`from_pretrained`, ONNX `InferenceSession`,
  artifact loads the regex misses); remote GitHub/GitLab scan; k8s/Triton infra scan; `ast_coverage` reported per scan
- **Compliance:** 7-Sutras + NIST/EU-AI-Act/ISO-42001 validators, plugin registry
- **Monitoring:** PSI + 1-D Wasserstein drift math (pure TS), BCP circuit breaker
- **Shift-left CI gate:** stateless `/api/v1/ci/scan` endpoint + policy-as-code + append-only
  gate ledger + SARIF — blocks shadow/ungoverned AI pre-deployment. See [`ci-integration/`](ci-integration/README.md).
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
3. Set the app's environment variables in hPanel (the current hosted site's values):
   ```
   DB_PROVIDER=mariadb
   DB_HOST=82.25.121.7
   DB_PORT=3306
   DB_USER=u709389505_sentrai
   DB_NAME=u709389505_sentrai
   MYSQL_PWD=<db password>      # or DB_PASSWORD — either is read; DB_PASSWORD wins
   DB_SYNCHRONIZE=true          # or false + run migrations (see below)
   JWT_SECRET=<a long random string>
   CORS_ORIGINS=https://<your-domain>
   ```
4. Deploy. On first boot the schema is created (or run migrations) and the default admin is
   seeded. **Change the admin password immediately** via the Users tab.

### Converting an existing SQLite deployment to MariaDB

If the hosted site previously ran on SQLite and you want to keep its data, run the
one-shot converter **on the host where the SQLite file lives** (it creates the schema
on the target and copies every table, preserving IDs):

```bash
SQLITE_PATH=./dev.db \
DB_HOST=82.25.121.7 DB_PORT=3306 \
DB_USER=u709389505_sentrai DB_NAME=u709389505_sentrai \
MYSQL_PWD=<db password> \
npm run db:convert                       # or: node dist/scripts/sqlite-to-mariadb.js
```

The converter refuses to touch a target that already has users unless `FORCE=1` is set
(re-runs upsert by primary key, so `FORCE=1` is idempotent). Starting fresh instead?
Skip the converter — with `DB_SYNCHRONIZE=true` the schema is created and the admin
seeded on first boot. Local development stays on SQLite (`DB_PROVIDER=sqlite`).

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
