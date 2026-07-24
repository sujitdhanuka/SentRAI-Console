# ET Award — Live GitHub-Import Demo (Meridian Finance)

Show the judges the real thing: point the console at a GitHub repo and watch it
discover the AI hiding inside — instead of a pre-baked seed. This is the
strongest version of the "we start with your code, not your questionnaire"
thesis, and it doubles as live proof the big-repo scan bug is fixed.

The demo codebase already exists at `scripts/demo/repo/` (six realistic AI
systems, Meridian-branded). This doc covers publishing it as a GitHub repo and
running the demo live.

---

## The one honest constraint (read this first)

A code scan produces an **inventory**. It cannot produce **runtime history**.
So a live import gives you discovery, typing, risk-flooring, merge, and
governance — but it does **not** give you:

- pre-staged **drift windows** (the reference-vs-live scores that make
  "Evaluate now" trip the breaker on stage), or
- the two **incidents** (the open P2 with a running 24-hour regulatory clock,
  and the resolved P4).

Those are time-series / event data. `seed-demo.mjs` stages them. You therefore
run the demo as a **hybrid**: discovery is live; the monitoring + incident beats
are staged. Two clean ways to arrange that are below — pick one and rehearse it.

---

## Step 1 — Publish the Meridian repo to GitHub (your hands, once)

The staging script builds a zip fallback **and** can publish the public mirror.
Publishing creates a repo under **your** GitHub account, so you run it.

```bash
cd ~/dev/sentrai                      # your relocated clone
gh auth status                        # make sure gh is logged in
bash scripts/demo/stage-demo-repo.sh --publish sujitdhanuka/meridian-finance
```

It prints the live-scan URL: `https://github.com/sujitdhanuka/meridian-finance`.

- The repo contains a **fake** secret (`WAREHOUSE_KEY`) on purpose — it's a demo
  beat, not a real credential. Its format (`wh_live_mrdn_…`) doesn't match a
  known provider pattern, so GitHub push-protection normally won't flag it. If
  it ever does, allow it for this repo (it's fake) or use the zip path.
- Public repo → **no token needed** to import it in the console. Leave the token
  field blank.

> Prefer not to touch GitHub at all? The same script always writes
> `~/Desktop/demo-repo.zip`. The live beat then uses **Codebase → Zip** instead
> of GitHub import — identical discovery, just a different source.

---

## Step 2 — Pick your staging pattern

### Pattern A — "Seed for depth, import for the wow" (recommended, zero scripts mid-demo)

Everything just works and nothing is fragile. Two projects under one tenant.

1. **Before the session** (reset): run the full seeder — it stages the tenant
   plus the `Retail Lending Platform` project with governance, drift and
   incidents already in place.
   ```bash
   SENTRAI_URL=https://sentraiconsole.com \
   SENTRAI_ADMIN_EMAIL=<admin> SENTRAI_ADMIN_PASSWORD=<pw> \
   MERIDIAN_CISO_PASSWORD='<demo-pw>' \
   node scripts/seed-demo.mjs
   ```
2. **Live in front of the judge**: create a *new* project (e.g.
   `Platform Repo — onboarding`) and import the GitHub repo into it (Step 3).
   The judge watches discovery happen on a genuinely empty project.
3. Pivot to the pre-seeded `Retail Lending Platform` for the Monitoring,
   Incidents and Rollup beats.

Narrative that ties the two projects together: *"This is the estate we already
govern. Now let me show you exactly how a new codebase enters governance — I'll
onboard our platform repo live."*

### Pattern B — "One project, discovery fully live" (purest, needs one setup touch)

Single project, everything discovered live — but you must layer the runtime
state onto the imported models with one script run, done during setup (not on
stage).

1. **Before the session**: stage only the tenant + an empty project.
   ```bash
   SEED_CONTEXT_ONLY=1 \
   SENTRAI_URL=https://sentraiconsole.com \
   SENTRAI_ADMIN_EMAIL=<admin> SENTRAI_ADMIN_PASSWORD=<pw> \
   MERIDIAN_CISO_PASSWORD='<demo-pw>' \
   node scripts/seed-demo.mjs
   ```
2. **Import the repo live** into `Retail Lending Platform` (Step 3).
3. **Layer the runtime state** — run the seeder again, no flag. It sees the
   models already exist, **skips discovery**, and only adds governance + drift +
   incidents:
   ```bash
   node scripts/seed-demo.mjs            # same env as above, WITHOUT SEED_CONTEXT_ONLY
   ```

Caveat: steps 2–3 happen during your setup/rehearsal, so at judge-time the
project is already populated. If you want the judge to watch the import itself,
use Pattern A, or reset and repeat 2–3 between sessions.

---

## Step 3 — The live import click-path (the beat itself)

In the console, signed in as the Meridian CISO (`priya.ciso@meridianfinance.demo`):

1. **New Project** (or open the empty one) → name it.
2. **Codebase → GitHub.**
   - Repository URL: `https://github.com/sujitdhanuka/meridian-finance`
   - Branch: `main`
   - Access token: **blank** (public repo)
3. **Scan.** Candidates appear in seconds. Narrate as they land:
   - a **shadow** `openai.chat.completions` call in `svc/fraud/fraud_graph.py`
     that no questionnaire would have caught;
   - the same `collections_propensity` model in **two files**
     (`jobs/` and `svc/collections/`) — watch it **merge** into one record
     listing both paths;
   - a **LangChain agent** (`svc/support/copilot_agent.py`) typed as an agent;
   - an **MCP server** (`mcp/statement_mcp_server.py`) — breadth of discovery.
4. **Import all.** On the review screen set **Owner team** = `Model Risk
   Committee` and **Board policy reference** = `MF-AI-POL-2026-01` for the batch.
5. Land in the inventory. Open **Retail Credit Scorer** → the four AI drafts are
   already populated and provider-badged. Fix owner/policy, **Save & Re-check**,
   watch RBI flip to Compliant in place.
6. **CI Gate Ledger** → the blocked deploy with line-level evidence + an additive
   override.
7. (Pattern A: switch to the seeded project) **Monitoring → Evaluate now** trips
   the breaker → BCP fallback. **Incidents** shows the open P2 with its 24-hour
   clock. **Rollup → Board narrative → Readiness PDF.**

The `WAREHOUSE_KEY` in `jobs/collections_propensity.py` floors that model's risk
to **HIGH** on import — call it out; the finding, not a self-assessment, drives
the tier.

---

## Fallbacks (rehearse these too)

| If… | Do this |
| --- | --- |
| GitHub / network is flaky on stage | Codebase → **Zip** with `~/Desktop/demo-repo.zip` — same discovery. |
| The whole live path stalls | Cut to the narrated fallback video (ET-B2). |
| A judge wants proof it's the real build | `https://sentraiconsole.com/api/v1/auth/bootstrap-status` → build `1.0.0`. |

See `docs/ET-GOLDEN-PATH-SCRIPT.md` for the full 12-minute narration and
`docs/ET-DEPLOY-CHECKLIST.md` for seeding the tenant on production.
