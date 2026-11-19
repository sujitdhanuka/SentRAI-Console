# SentRAI in CI/CD — the pre-deployment gate

The SentRAI gate runs in your pipeline on every pull request and push. It scans the checked-out code for AI usage, resolves each detected model against the project's governed inventory, evaluates your policy, and returns **pass** or **fail** with SARIF. A `fail` exits non-zero and blocks the merge or deploy.

This is Stage 8 of the [Workflow Guide](WORKFLOW-GUIDE.md). The source for everything here lives in [`ci-integration/`](../ci-integration/README.md).

---

## 1. How it works

```
 Developer opens PR / pushes
          │
          ▼
 CI job: sentrai-gate (Action or gate.mjs)
   • bundles source files (.py .js .ts .go .java .rb .ipynb .yaml .json .md …,
     skips node_modules/.git/dist/build/venv/vendor, files > 512 KB)
   • includes .sentrai/policy.yaml
          │  POST /api/v1/ci/scan   (Authorization: Bearer <CI token>)
          ▼
 SentRAI Console
   1. AST + regex scan of the snapshot
   2. resolve each detected model against the project's inventory
   3. evaluate .sentrai/policy.yaml (or the default policy)
   4. append an immutable deployment_gate_events row
   5. if code already landed on the default branch and fails → raise incidents
          │
          ▼
 { verdict, summary, blocking_violations[], sarif, gate_event_id, ... }
          │
   pass → exit 0          fail / API error / timeout → exit 1 (fails closed)
          │
          ▼
 SARIF → GitHub Security tab · event → CI Gate Ledger in the console
```

**Key properties**

- **Token-scoped.** The pipeline uses a project-scoped **CI service token** (a `type:ci` JWT). It can only call the scan endpoint; it cannot sign in to the console. Valid 365 days; rotate by minting a new one.
- **Read-only on your code.** The runner sends a snapshot and writes a SARIF file. It never changes the repo.
- **Fails closed.** A missing token, an unreachable console, or an API error all exit 1. A gate that can't run never silently allows a deploy.
- **Policy-as-code.** Rules live in `.sentrai/policy.yaml` in the scanned repo. A missing or malformed file falls back to a safe default.
- **Auditable.** Every decision, including overrides, is in the append-only CI Gate Ledger.

### What fails the gate

| Violation | Example |
|---|---|
| **Shadow AI** | A HIGH/CRITICAL model in code with no registered, owned, policy-backed inventory entry |
| **Missing governance** | A registered HIGH model with no owner team, board policy, bias-test evidence, … (per policy) |
| **Unauthorized tool use** | An agent or MCP server calls a tool outside its permitted set (e.g. `initiate_refund`) |
| **Risk escalation** | Code now scans as HIGH/CRITICAL but the model is registered at a lower tier (e.g. an LLM replaced a human review step) |

A model is classed HIGH when, for example, an LLM or agent sits in a credit, loan, fraud, anomaly or trading path, or its file contains a hardcoded secret. Under the default policy, MEDIUM and LOW models are reported but don't block.

---

## 2. Mint a CI token

**In the console** *(ADMIN or CISO)*: **CI Gate Ledger → ⚙ Set up CI scanning**. Pick the project to gate. The console generates the token (shown **once**) and a ready-to-paste pipeline step.

**Or via the API:**

```bash
curl -X POST "$SENTRAI_URL/api/v1/ci/tokens" \
  -H "Authorization: Bearer <admin-or-ciso-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"project_id":"<project-uuid>","label":"acme-lending-ci"}'
# → { "project_id": "...", "token": "eyJ...", "usage": "Store as the SENTRAI_CI_TOKEN secret ..." }
```

Store it in your CI system:

| Name | Kind | Value |
|---|---|---|
| `SENTRAI_CI_TOKEN` | **secret** | the token |
| `SENTRAI_URL` | variable | your console base URL, e.g. `https://sentraiconsole.com` |

---

## 3. Write the policy

Create `.sentrai/policy.yaml` in the repository you're gating. Each `block_on` rule fails the build when a detected model of that severity is missing any listed requirement.

```yaml
# .sentrai/policy.yaml
gates:
  block_on:
    - severity: HIGH
      missing:
        - registered          # a governed inventory entry exists (not shadow AI)
        - owner_team          # a named, non-"unassigned" owner
        - board_policy_ref    # linked to a board-approved AI policy
        - bias_test_evidence  # a bias_test artifact is attached

    - severity: CRITICAL
      missing:
        - registered
        - owner_team
        - board_policy_ref
        - human_oversight     # human-in-the-loop enabled
        - red_team_evidence   # red-team date or red_team artifact

  # Agents/MCP servers calling tools outside their permitted set fail the gate.
  tool_authorization:
    enforce: true             # default true
    require_declaration: false  # true = also fail agents with no permitted set declared

  # Fail when code scans HIGH/CRITICAL but the model is registered lower.
  risk_escalation:
    enforce: true             # default true

  frameworks: [eu_ai_act, nist_ai_rmf, rbi_free_ai, iso_42001]
```

**Requirement keys**

| Key | Passes when | How to satisfy it in SentRAI |
|---|---|---|
| `registered` | a governed model backs the asset | import from the scan review, or **+ Register Model** |
| `owner_team` | a named owner is set | governance workspace → Owner team |
| `board_policy_ref` | a board policy is linked | governance workspace → Board policy reference |
| `human_oversight` | human-in-the-loop is on | governance workspace → Human oversight |
| `bias_test_evidence` | a `bias_test` artifact is attached | `POST /api/v1/inventory/models/:id/evidence` with `type: bias_test` |
| `red_team_evidence` | a red-team date or `red_team` artifact exists | governance workspace → Adversarial / red-team evidence |

**Default policy** (no file, empty file, or invalid YAML): HIGH and CRITICAL models must be `registered`, have an `owner_team` and a `board_policy_ref`; tool authorization and risk escalation are enforced.

> Start with the default, get to green, then add `bias_test_evidence` and `red_team_evidence` once owners have uploaded evidence. Adding them on day one usually blocks every HIGH model at once.

---

## 4. Add the pipeline job

### 4.1 GitHub Actions — packaged action (recommended)

`.github/workflows/sentrai-gate.yml`:

```yaml
name: SentRAI AI Compliance Gate

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  security-events: write   # upload SARIF to the Security tab

jobs:
  sentrai-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: SentRAI Pre-Deployment Gate
        id: gate
        uses: sujitdhanuka/SentRAI-Console/ci-integration/sentrai-gate-action@v1
        with:
          sentrai-url: ${{ vars.SENTRAI_URL }}
          ci-token: ${{ secrets.SENTRAI_CI_TOKEN }}
          # fail-on: never      # report-only rollout (see §6)
          # max-mb: 20
          # sarif-file: sentrai-results.sarif

      - name: Upload SARIF to the Security tab
        if: always() && steps.gate.outputs.sarif-file != ''
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: ${{ steps.gate.outputs.sarif-file }}
```

| Input | Required | Default | Meaning |
|---|---|---|---|
| `sentrai-url` | yes | — | Console base URL |
| `ci-token` | yes | — | Project-scoped CI token (secret) |
| `fail-on` | no | `fail` | `fail` blocks; `never` reports only |
| `max-mb` | no | `20` | Max snapshot size in MB |
| `sarif-file` | no | `sentrai-results.sarif` | SARIF output path |

| Output | Meaning |
|---|---|
| `verdict` | `pass` or `fail` |
| `gate-event-id` | Ledger id of this decision |
| `blocking-violations` | Count of blocking violations |
| `sarif-file` | Path to the SARIF report |

The action also writes `::error::` annotations on offending files and a job summary.

### 4.2 GitHub Actions — self-contained (private repos)

GitHub can't pull an action from a private repo into another repo without changing *Settings → Actions → General → Access*. To avoid that, fetch the runner from your console at run time:

```yaml
name: SentRAI AI Compliance Gate

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  security-events: write

jobs:
  sentrai-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: SentRAI Pre-Deployment Gate
        env:
          SENTRAI_URL: ${{ vars.SENTRAI_URL }}
          SENTRAI_CI_TOKEN: ${{ secrets.SENTRAI_CI_TOKEN }}
          GITHUB_SHA: ${{ github.event.pull_request.head.sha || github.sha }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          GITHUB_RUN_ID: ${{ github.run_id }}
        run: |
          curl -sSfL "$SENTRAI_URL/api/v1/ci/gate.mjs" -o sentrai-gate.mjs
          node sentrai-gate.mjs

      - name: Upload SARIF to the Security tab
        if: always() && hashFiles('sentrai-results.sarif') != ''
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: sentrai-results.sarif
```

`GET /api/v1/ci/gate.mjs` is public and served with no-cache, so pipelines always run the latest runner.

### 4.3 GitLab CI

The runner reads GitHub-style variable names, so map GitLab's predefined variables onto them. Set `SENTRAI_URL` (variable) and `SENTRAI_CI_TOKEN` (masked, protected variable) under *Settings → CI/CD → Variables*.

```yaml
# .gitlab-ci.yml
stages: [governance]

sentrai-gate:
  stage: governance
  image: node:20-alpine
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  variables:
    GITHUB_SHA: $CI_COMMIT_SHA
    PR_NUMBER: $CI_MERGE_REQUEST_IID
    GITHUB_RUN_ID: $CI_PIPELINE_ID
  before_script:
    - apk add --no-cache curl
  script:
    - curl -sSfL "$SENTRAI_URL/api/v1/ci/gate.mjs" -o sentrai-gate.mjs
    - node sentrai-gate.mjs
  artifacts:
    when: always
    paths: [sentrai-results.sarif]
    expire_in: 30 days
```

To make it blocking, enable *Settings → Merge requests → Pipelines must succeed*.

### 4.4 Jenkins (declarative)

```groovy
pipeline {
  agent { docker { image 'node:20' } }
  environment {
    SENTRAI_URL      = 'https://sentraiconsole.com'
    SENTRAI_CI_TOKEN = credentials('sentrai-ci-token')   // Secret text credential
    GITHUB_SHA       = "${env.GIT_COMMIT}"
    PR_NUMBER        = "${env.CHANGE_ID ?: ''}"
    GITHUB_RUN_ID    = "${env.BUILD_ID}"
  }
  stages {
    stage('SentRAI gate') {
      steps {
        sh 'curl -sSfL "$SENTRAI_URL/api/v1/ci/gate.mjs" -o sentrai-gate.mjs'
        sh 'node sentrai-gate.mjs'
      }
      post { always { archiveArtifacts artifacts: 'sentrai-results.sarif', allowEmptyArchive: true } }
    }
  }
}
```

### 4.5 Any other runner

Any system with Node 18+ works:

```bash
export SENTRAI_URL=https://sentraiconsole.com
export SENTRAI_CI_TOKEN=***            # secret
export GITHUB_SHA=<commit>             # optional context
export PR_NUMBER=<pr/mr number>        # optional
export GITHUB_RUN_ID=<pipeline id>     # optional
export SENTRAI_SARIF_OUT=sentrai-results.sarif   # optional
export SENTRAI_MAX_MB=20                         # optional
curl -sSfL "$SENTRAI_URL/api/v1/ci/gate.mjs" -o sentrai-gate.mjs
node sentrai-gate.mjs                  # exit 0 = pass, 1 = fail or error
```

> **Note on automatic incidents.** When a gate fails on a push to the default branch (code that has already landed), SentRAI raises an incident per affected model. The runner detects a default-branch push from GitHub's `GITHUB_EVENT_NAME` / `GITHUB_EVENT_PATH`, so on GitLab, Jenkins and other runners this is currently off: the gate still blocks and logs, but no incident is raised.

### 4.6 Local dry run

```bash
SENTRAI_URL=http://localhost:8002 SENTRAI_CI_TOKEN=<token> node ci-integration/sentrai-gate.mjs
```

---

## 5. Keep the inventory in sync from your database

Static scanning only sees models used in code. If your app also stores models as database rows, push them into the inventory with `ci-integration/sync-models.mjs`. It is idempotent, so run it nightly or as a pipeline step.

```bash
SENTRAI_URL=https://sentraiconsole.com \
SENTRAI_PROJECT_ID=<project-uuid> \
SENTRAI_EMAIL=svc-governance@acme.com SENTRAI_PASSWORD=*** \
MODELS_FILE=models.json \
node ci-integration/sync-models.mjs
```

Each row in `models.json` needs `name`, `model_type`, `functional_area` and `use_case_description`; `owner_team` and `board_policy_ref` are optional. `model_type` is one of `MACHINE_LEARNING`, `DEEP_LEARNING`, `NLP`, `GENERATIVE_AI`, `RULES_BASED`, `HYBRID`, `AGENT`, `TOOL`, `MCP_SERVER`.

This uses an OWNER/ADMIN login, **not** the CI scan token.

Example nightly job (GitHub Actions):

```yaml
name: SentRAI inventory sync
on:
  schedule: [{ cron: '0 2 * * *' }]
  workflow_dispatch:
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: ./scripts/export-models.sh > models.json   # your export
      - run: node ci-integration/sync-models.mjs
        env:
          SENTRAI_URL: ${{ vars.SENTRAI_URL }}
          SENTRAI_PROJECT_ID: ${{ vars.SENTRAI_PROJECT_ID }}
          SENTRAI_EMAIL: ${{ secrets.SENTRAI_SYNC_EMAIL }}
          SENTRAI_PASSWORD: ${{ secrets.SENTRAI_SYNC_PASSWORD }}
          MODELS_FILE: models.json
```

(Copy `sync-models.mjs` into the app repo, or fetch it, since it lives in the SentRAI repo.)

---

## 6. Roll it out

1. **Report-only first.** Set `fail-on: never` (action) for a week. Developers see findings in the Security tab and job summary, nothing is blocked.
2. **Fix the baseline.** Work the CI Gate Ledger and the inventory's Open Gaps until the default branch passes: register shadow models, set owners and board policies, declare permitted tools for agents.
3. **Turn on blocking.** Remove `fail-on: never`.
4. **Require the check.** GitHub: *Settings → Branches → Branch protection rule* for `main` → *Require status checks to pass* → select **SentRAI AI Compliance Gate**. GitLab: *Pipelines must succeed*.
5. **Tighten the policy.** Add `bias_test_evidence`, `red_team_evidence`, `human_oversight`, or `require_declaration: true` as evidence lands.

---

## 7. Review gate results in the console

**CI Gate Ledger** *(ADMIN, CISO, REVIEWER, APPROVER)*

- Columns: commit (short SHA + PR), project, when, **verdict** (`PASS` / `FAIL` / `OVERRIDDEN`), models detected, and triage reasons (with a `SHADOW` badge).
- **Audit →** opens the event: each blocking violation with the flagged file and an inline code viewer on the exact lines, the missing controls, and **View SARIF / Download .sarif**, the same report the pipeline uploaded.
- **Grant Auditing Sign-Off Override** *(ADMIN, CISO, APPROVER)*: record a justification to unblock a failed gate. It's additive: the original `FAIL` stays on the record, and the event shows as `OVERRIDDEN` with who, when and why.

Overrides are a ledger decision; to let the PR through, re-run the pipeline after the underlying gap is fixed, or use your branch-protection bypass process with the override as the audit evidence.

**API**

```bash
GET  /api/v1/ci/events?verdict=fail&limit=50&project_id=<id>
GET  /api/v1/ci/events/:id/sarif
POST /api/v1/ci/events/:id/override        {"reason":"Approved by MRC 2026-11-10, ticket GRC-142"}
GET  /api/v1/ci/projects/:projectId/gate-history?limit=50
```

---

## 8. Fixing a failed gate

| Gate message | Fix |
|---|---|
| `[SHADOW]` model not registered | Import it from a scan review or **+ Register Model** in the gated project |
| missing `owner_team` / `board_policy_ref` / `human_oversight` | Model Inventory → **Edit** → fill the field → **Save & Re-check** |
| missing `bias_test_evidence` | Attach a `bias_test` artifact (Workflow Guide § 5.1) |
| missing `red_team_evidence` | Governance workspace → **Adversarial / red-team evidence** |
| unauthorized tool `X` | Governance workspace → **Tool Authorization**: permit `X` if it's sanctioned, otherwise remove the call |
| risk escalation | Re-assess the model: update its risk rationale and governance for the higher tier, get board sign-off, or restore the human step |
| hardcoded secret | Remove it from code, rotate the credential, push again |
| `HTTP 401` / `Could not reach` | Token expired, wrong project, or wrong `SENTRAI_URL`; the gate fails closed |
| `snapshot exceeds … bytes` | Raise `max-mb` / `SENTRAI_MAX_MB`, or remove large generated files from the checkout |

Then push again. A new gate event is appended; the earlier `FAIL` stays in the ledger.

---

## 9. Runtime follow-through

Each CI scan returns a `SENTRAI_MODEL_ID` for every governed asset it detects. Stamp it into the deployed build as an environment variable so the running agent can:

- tag telemetry it posts to `POST /api/v1/telemetry/events` (Runtime Visibility), and
- poll its kill switch at `GET /api/v1/control/models/:id/poll` each loop.

That joins the CI decision, the deployed service and its runtime behaviour on one model timeline.
