# sentRAI Console UI — Model Inventory Dashboard

A single-viewport AI Governance / Model Inventory dashboard: the fleet-level view of every
AI component tracked against four frameworks (RBI FREE-AI 7 Sutras, NIST AI RMF 1.0,
EU AI Act, ISO 42001), with prioritized gaps, a governance calendar, an edit drawer, and a
grievance intake — all against typed demo data.

## Run

```bash
cd console-ui
npm install
npm run dev        # http://localhost:5199
npm run build      # tsc --noEmit (strict) + vite build
```

Dark theme is the default; the toggle persists to `localStorage`. The layout is fixed-viewport
(no page scroll ≥1024px — verified at 1366×768, 1440×900, 1920×1080); only the matrix body,
gaps queue, calendar, and detail body scroll internally.

## Swapping the mock for the real API

Every component talks exclusively to the `GovernanceProvider` interface in
[`src/providers/governance.ts`](src/providers/governance.ts). To go live:

1. Write `class HttpGovernanceProvider implements GovernanceProvider` that maps:
   - `getComponents()` → `GET /api/v1/inventory/models` (+ project/compliance rollup)
   - `getGaps()` → blocking gaps from the compliance endpoints
   - `getCalendar()` → audit-due / red-team schedules
   - `getGrievances()` / `fileGrievance()` → the grievance endpoints
   - `saveComponent()` → `PATCH /api/v1/inventory/models/:id/governance`
   - `exportAudit()` → the portfolio PDF endpoint
2. Change ONE line: `export const provider: GovernanceProvider = new HttpGovernanceProvider()`.

No component imports the mock directly, so nothing else changes. One intentional deviation
from the original spec: `fileGrievance` returns `{ id }` (instead of `void`) so the UI can
toast the generated grievance id.

## Where evidence URLs come from

Each framework check carries `evidenceUrl`. In the real backend these are the model's
**evidence artifacts** (bias-test reports, red-team reports, conformity assessments) attached
via the evidence endpoints — compliance status must be traceable to an artifact. An `ok`
status with `evidenceUrl: null` renders a small amber dot: *compliant-but-unevidenced*,
deliberately not a clean green.

## Where the ledger lives

`MockGovernanceProvider` appends `{ts, actor, action, targetId}` to an in-memory array (and
`console.info`s it) on every `saveComponent` / `fileGrievance` / `exportAudit`. In the real
backend this is the **append-only audit ledger** (`model_ledger_events` + audit trail) — the
Audit Ledger nav item wires to it next.

## Structure

- `src/providers/governance.ts` — types + `GovernanceProvider` + mock with seeded fleet
- `src/stores/consoleUi.ts` — theme, env filter, selection, drawer/modal, toasts
- `src/stores/governanceData.ts` — fetch state; `load()` is also retry + post-save refetch
- `src/pages/InventoryDashboard.tsx` — composition only
- `src/components/console/*` — KPI band, matrix, status/drift cells, detail, gaps, calendar,
  edit drawer (focus-trapped, Esc), grievance modal
- `src/components/ui/*` — Badge, Panel, Skeleton, Toast atoms
- `src/tokens.css` — the full dark/light token sets; components never hardcode hex
