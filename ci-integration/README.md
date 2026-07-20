# Sentrai-Console — Shift-Left CI Gate

Block non-compliant and **shadow** AI models *before* they reach production. This
folder contains everything needed to wire Sentrai-Console into a CI/CD pipeline
as a read-only, pre-deployment compliance gate.

## How it works

```
Developer PR ─► CI runs sentrai-gate.mjs ─► POST /api/v1/ci/scan (CI token)
                                                     │
                        scan (AST+regex) ─ resolve against inventory ─ evaluate policy.yaml
                                                     │
                        append immutable deployment_gate_events row (audit trail)
                                                     │
             ◄── { verdict, summary, blocking_violations, sarif } ──┘
                                                     │
                            pass → exit 0    │    fail → exit 1 + SARIF
```

- **Stateless & token-scoped.** The pipeline authenticates with a project-scoped
  **CI service token** (a `type:ci` JWT), never an interactive login.
- **Shadow-AI aware.** Each detected model is resolved against the project's
  governed inventory. A HIGH-risk model with no registered, owned, policy-backed
  counterpart is flagged as *shadow AI* and blocks the build.
- **Policy-as-code.** Rules live in `.sentrai/policy.yaml` in the scanned repo.
  A malformed/missing policy falls back to a safe default (fail-closed).
- **Auditor-ready.** Every decision is written to an append-only
  `deployment_gate_events` ledger, queryable at
  `GET /api/v1/ci/projects/:projectId/gate-history`.
- **Native SARIF.** Violations upload to the GitHub/GitLab Security tab.

## Setup (3 steps)

1. **Mint a CI token** (admin/CISO), scoped to the project you want to gate:
   ```bash
   curl -X POST "$SENTRAI_URL/api/v1/ci/tokens" \
     -H "Authorization: Bearer <admin-jwt>" -H "Content-Type: application/json" \
     -d '{"project_id":"<project-uuid>","label":"acme-web"}'
   # → { "token": "eyJ..." }
   ```
   Store the token as the `SENTRAI_CI_TOKEN` secret and your API base URL as
   `SENTRAI_URL` in the pipeline.

2. **Add a policy** — copy [`policy.example.yaml`](policy.example.yaml) to
   `.sentrai/policy.yaml` in the target repo and tune the gates.

3. **Add the pipeline job** — copy [`github-workflow.yml`](github-workflow.yml)
   to `.github/workflows/sentrai-gate.yml` and vendor
   [`sentrai-gate.mjs`](sentrai-gate.mjs) to `.sentrai/sentrai-gate.mjs`.

## Verdict semantics

| Verdict | Exit | Meaning |
|---|---|---|
| `pass` | 0 | No detected model violates the active policy. |
| `fail` | 1 | One or more HIGH/CRITICAL models are shadow or missing required governance. |
| API/network error | 1 | **Fails closed** — a gate that can't run must not silently allow a deploy. |

## Local dry-run

```bash
SENTRAI_URL=http://localhost:8002 \
SENTRAI_CI_TOKEN=<token> \
node ci-integration/sentrai-gate.mjs
```

## Policy requirement keys

| Key | Passes when… |
|---|---|
| `registered` | a governed model backs this asset (not shadow AI) |
| `owner_team` | a named, non-"unassigned" owner is set |
| `board_policy_ref` | the model links a board-approved AI policy |
| `human_oversight` | human-in-the-loop is enabled |
| `bias_test_evidence` | a `bias_test` evidence artifact is attached |
| `red_team_evidence` | a red-team date or `red_team` artifact exists |

GitLab CI, Jenkins, and other runners work the same way — call
`sentrai-gate.mjs` with the same environment variables and honor its exit code.
