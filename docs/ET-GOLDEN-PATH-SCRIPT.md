# ET Golden-Path Demo Script — 12 minutes

The demo the judges see. Every beat lands exactly one differentiator; every
click and line is assigned so there is **no improvisation on stage**. Timings in
`[mm:ss]`. Run it against the seeded **Meridian Finance** demo tenant and the
purpose-built demo repo — never the internal Dhancept projects.

> One rule: if something is slow or errors, **keep narrating and move to the next
> beat** — never debug live. The fallbacks (§ Failure drills) exist so the story
> never stalls.

---

## Pre-flight checklist (run 30 min before)

- [ ] Production on the latest build: `curl -s https://sentraiconsole.com/api/v1/auth/bootstrap-status` → build tag is the expected one.
- [ ] Demo tenant reset clean: re-run `node scripts/seed-demo.mjs` (idempotent). Confirm ~6 Meridian models, one drift-armed model, one open + one resolved incident.
- [ ] Signed in as the **Meridian demo CISO** (credentials in your presenter notes — not in this repo). Internal Dhancept projects are in a different org and not visible here.
- [ ] The demo repo is reachable for a live GitHub import (small public mirror), **or** its `.zip` is on the desktop as the upload fallback.
- [ ] Browser: one window, display scaling for **1080p projector** (zoom so the rail + a full card are legible from the back row). Close all other tabs. Dark or light — pick one and stick to it.
- [ ] Local fallback instance running on the laptop (snapshot-restored) + the narrated video open in a background tab. Phone hotspot ready.
- [ ] Nothing that trips the drift breaker has been clicked since the reset (the "Evaluate now" click is a demo beat — save it for beat 7).

**The thesis, memorized (say it in beat 1, repeat it in the close):**
> "Governance vendors start with a questionnaire. We start with your code."

---

## The 12-minute path

### Beat 1 — The claim  ·  `[0:00–1:00]`  ·  *lands: the category*

- **DO:** Open `sentraiconsole.com`. Let the landing page sit for a beat. Click **Launch the console** → the React dashboard.
- **SAY:** "Every AI-governance tool on the market starts the same way — a human fills in a questionnaire about a model someone remembered to declare. The problem is the models nobody declared. So we start somewhere else: the code. Let me show you."
- **FALLBACK:** If the landing is slow, go straight to `/dashboard` — you're already signed in.

### Beat 2 — Live discovery  ·  `[1:00–3:00]`  ·  *lands: code-level discovery*

- **DO:** **Projects → + New Project.** In the wizard: name it `Meridian Retail Lending`, click **Next: add codebase**. On the Codebase step, **GitHub** tab → paste the demo repo URL → **Import & scan**. The scan-results review opens in seconds.
- **DO:** Scroll the discovered list. Point at the **Fraud Graph** candidate.
- **SAY:** "It walked the source with an AST parser and found every AI system — ML models, an agent, an MCP server. And this one" *(point to Fraud Graph)* "is a live `openai.chat.completions` call in the fraud service that is on nobody's inventory. A questionnaire would never have caught it. That's the whole idea — we govern what's *running*, not what someone remembered."
- **FALLBACK:** If the live GitHub import is slow/fails, use **Zip** in the wizard and upload the demo-repo `.zip` — same review screen appears. If both fail, the Meridian tenant is already scanned; open **Model Inventory** and narrate the same discovery from the existing records.

### Beat 3 — Flooring + merge  ·  `[3:00–4:30]`  ·  *lands: security flooring, merge provenance*

- **DO:** Still in the review modal. Point at the **Collections Propensity** row with the **red key icon**.
- **SAY:** "This file has a hardcoded warehouse key in the source. So the moment it's imported, its risk is floored to **HIGH** — not because someone self-assessed it that way, but because we found the secret."
- **DO:** Set **Owner team** = `Collections Engineering` and **Board policy reference** = `BP-AI-2026-04` in the review footer. Click **Import N into inventory**. Read the toast aloud: *"N new · 1 merged."*
- **SAY:** "It also found the same model defined in two files. Instead of dropping the duplicate, it merged them into one record that lists both paths, with a ledger event recording the merge — so the inventory count matches reality."
- **DO:** Open the merged **Collections Propensity** model; show the two source files in its provenance.

### Beat 4 — Auto-governance + self-governance  ·  `[4:30–6:00]`  ·  *lands: auto-generation, provenance, self-governance*

- **DO:** **Model Inventory** → open **Retail Credit Scorer** (or Fraud Graph). Scroll the summary, risk rationale, and remediation blocks.
- **SAY:** "On scan, it drafted the use-case summary, the risk rationale, and a gap-remediation plan — and each one is badged with the model that produced it, so nothing here reads as un-sourced prose."
- **DO:** Point at the inventory row named **`LLM: …`** (the configured provider).
- **SAY:** "And the AI we used to write those drafts? It's sitting right here in the inventory as a governed system in its own right. The tool governs its own AI."

### Beat 5 — Cause and effect  ·  `[6:00–7:30]`  ·  *lands: cause-and-effect governance*

- **DO:** On a model showing an RBI gap, click **Edit** → the **governance workspace** popup opens (verdict cards on the left, form on the right).
- **SAY:** "Say the gap is a missing owner and board policy. I fix them here…"
- **DO:** Fill **Owner team** and **Board policy reference** → **Save & Re-check**. Watch the RBI verdict flip to **Compliant** in place.
- **SAY:** "…and the verdict re-computes live. Governance you can watch cause and effect on, not a report you regenerate overnight."

### Beat 6 — The hard gate  ·  `[7:30–9:00]`  ·  *lands: the CI gate + immutable ledger*

- **DO:** Rail → **CI Gate Ledger.** Open the **blocked** deployment event. Expand the line-level AST evidence.
- **SAY:** "This is the same engine wired into the CI pipeline. This deployment was **blocked** because it shipped an ungoverned model — here's the exact flagged line. That's the difference between a report and a control: this one stops the deploy."
- **DO:** Show the **additive override** on the event.
- **SAY:** "A team lead can override to unblock — but the override is *additive*. It never erases the original failing verdict. The ledger is append-only. That's what an auditor trusts."

### Beat 7 — Monitoring + regulatory clock  ·  `[9:00–10:30]`  ·  *lands: statistical monitoring, RBI operational depth*

- **DO:** Rail → **Drift Monitoring.** On the pre-armed model, click **Evaluate now**. The breaker trips → BCP fallback + remediation text appears.
- **SAY:** "This isn't a threshold someone typed — it's a statistical drift test. It just tripped the circuit breaker and activated the model's business-continuity fallback."
- **DO:** Rail → **Incidents → Report incident.** Fill a substantive account (the button stays disabled until it's substantive — that's the regulator's minimum, by design). Submit.
- **SAY:** "And when something goes wrong, reporting it starts a **24-hour regulatory clock** — RBI's operational reality, built in."
- **FALLBACK:** If "Evaluate now" doesn't trip on the first click, don't re-click and stall — say "it's evaluated clean today" and move to Incidents. Never reset the breaker live.

### Beat 8 — Grounded board reporting  ·  `[10:30–11:30]`  ·  *lands: grounded AI, cost transparency*

- **DO:** Rail → **Compliance Rollup.** Click **draft Board Narrative** → **Readiness PDF.**
- **SAY:** "The board narrative is generated *from* the numbers on this screen — not free-composed — so it can't drift from the evidence."
- **DO:** Rail → **LLM Usage.**
- **SAY:** "And every AI call the platform made is metered here — tokens, latency, cost, success rate. Reliability and spend, transparent."

### Beat 9 — The close  ·  `[11:30–12:00]`  ·  *lands: it's all evidence*

- **DO:** Rail → **Audit Trail.** Scroll to the top — the events from the last twelve minutes are already logged.
- **SAY:** "Everything you just watched — the scan, the flooring, the override, the incident — is already sitting in an immutable audit log. **The demo *is* the evidence.** We started with your code; we ended with a compliance record. That's engineering-driven AI governance."

---

## The 3-minute cutdown (corridor / booth version)

For when you have three minutes, not twelve. Beats 2 → 6 → 9.

- `[0:00–0:20]` **Thesis.** "Governance tools start with a questionnaire. We start with your code."
- `[0:20–1:30]` **Live scan** (beat 2): import the demo repo, candidates appear, point at the shadow LLM call nobody registered.
- `[1:30–2:30]` **The gate** (beat 6): CI Gate Ledger — a blocked deploy with line-level evidence and an additive, immutable override.
- `[2:30–3:00]` **Close** (beat 9): Audit Trail — "everything you watched is already evidence."

---

## Failure drills (rehearsed 13 Aug)

| If… | Then… |
|---|---|
| Live GitHub scan is slow/errors | Zip-upload the demo repo (wizard → Zip). Same review screen. |
| Both scan paths fail | Narrate discovery from the already-seeded Meridian inventory. |
| LLM drafts are blank/slow | The drafts are pre-generated on the seeded tenant — they're already there; don't re-generate live. |
| Drift breaker won't trip | "Evaluated clean today", move on. Never reset live. |
| Venue Wi-Fi dies | Switch to the **local instance** on the laptop (snapshot-restored). Keep narrating. |
| Laptop instance dies | Play the **narrated fallback video**. Don't break stride. |
| A judge hijacks with a hard question | Answer briefly from the Evidence & Narrative Pack, then: "happy to go deep after — let me finish the thread." Return to the script. |

---

## Between judge sessions

Reset the tenant to a clean state in one command:

```bash
node scripts/seed-demo.mjs        # idempotent — re-arms drift, restores incidents
```

Do **not** click "Evaluate now" or file incidents except as demo beats — the reset
re-stages the drift window only when the history is clean.

---

## Companion documents

- **Evidence & Narrative Pack** — the nomination story, judge Q&A, and metrics sheet (your leave-behind and your answer bank for hijack questions).
- **ET-DEPLOY-CHECKLIST.md** — production deploy + reset runbook.
- **Coverage disclosure** — `sentraiconsole.com/coverage`, if a judge probes framework depth mid-demo (don't volunteer it; it's your depth answer, not a beat).
