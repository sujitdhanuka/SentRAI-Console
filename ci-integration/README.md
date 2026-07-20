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

   Or mint it from the app with no curl: **CI Gate Ledger → “⚙ Set up CI
   scanning”** (ADMIN/CISO) generates a token and a ready-to-run snippet.

2. **Add a policy** — copy [`policy.example.yaml`](policy.example.yaml) to
   `.sentrai/policy.yaml` in the target repo and tune the gates.

3. **Add the pipeline job** — copy [`github-workflow.yml`](github-workflow.yml)
   to `.github/workflows/sentrai-gate.yml`. It references the **packaged action**
   (below) — nothing to vendor.

## GitHub Action (recommended)

Reference the packaged action directly — no script to copy:

```yaml
- name: SentRAI Pre-Deployment Gate
  id: gate
  uses: sujitdhanuka/SentRAI-Console/ci-integration/sentrai-gate-action@v1
  with:
    sentrai-url: ${{ vars.SENTRAI_URL }}
    ci-token: ${{ secrets.SENTRAI_CI_TOKEN }}
```

| Input | Required | Default | Description |
|---|---|---|---|
| `sentrai-url` | yes | — | Base URL of your SentRAI Console. |
| `ci-token` | yes | — | Project-scoped CI service token (a secret). |
| `fail-on` | no | `fail` | `fail` blocks the deploy; `never` reports only. |
| `max-mb` | no | `20` | Max total size of the scanned snapshot. |
| `sarif-file` | no | `sentrai-results.sarif` | Where to write the SARIF report. |

| Output | Description |
|---|---|
| `verdict` | `pass` or `fail`. |
| `gate-event-id` | The immutable gate-event id in the ledger. |
| `blocking-violations` | Count of blocking violations. |
| `sarif-file` | Path to the SARIF report (feed to `upload-sarif`). |

The action emits GitHub `::error::` annotations on the offending files and a job
summary, and exits non-zero on `fail` so the deploy is blocked.

### Versioning the action

Consumers pin to a tag. To publish `v1`, tag this repo:

```bash
git tag -f v1 && git push -f origin v1   # move v1 to the current commit
```

Use `@v1` for a stable pin, or `@main` to always track the latest. (Optionally
list it on the GitHub Marketplace from the repo's *Releases*.)

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
