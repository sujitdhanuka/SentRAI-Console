# Interim manual process: Colorado SB 26-189 (effective 1 January 2027)

A stopgap for lenders and other deployers using SentRAI until the adverse-action and
reconsideration kit (plan epic E2.2) ships. It describes what to do by hand and what to
record. It is not legal advice: confirm each step with counsel, and check the Colorado
Attorney General's rules, which are due by 1 January 2027.

Creditors whose adverse-action notices already meet ECOA / FCRA requirements are carved
out of the adverse-outcome notice duty (CO-3). The other steps still apply.

## 1. Before the system influences a decision (CO-2)

- Publish a clear notice that automated decision-making technology (ADMT) materially
  influences the decision. The SentRAI public transparency card for the model can serve as
  the linked notice: copy its URL into your application journey.
- Record: model ID, notice URL, date published.

## 2. After an adverse outcome (CO-3)

Send the consumer a plain-language notice containing:

- a description of the decision and the role the ADMT played in it;
- the data inputs used (take them from the SentRAI explainability record for the decision,
  if your serving system sends one);
- how to get more information;
- the consumer's rights, including the steps in section 3.

Record: decision reference, date sent, channel, explainability record ID.

## 3. Data correction and human review (CO-4)

When a consumer asks to correct personal data or for human review:

1. Log the request as a grievance in SentRAI against the model, and put the decision
   reference at the start of the description so it can be matched later.
2. Assign a trained reviewer who has the authority to override the decision.
3. Record the reviewer, the evidence considered, any corrected data and the outcome in the
   log below and in the grievance resolution notes.

## 4. Records (CO-5)

Keep notices, requests and review outcomes for at least 3 years after the decision.
SentRAI keeps its ledger and grievance records but has no retention policy yet, so also
keep the log below in your records system.

## 5. If you are the developer (CO-1)

Give deployers: intended and known harmful uses, training data categories, known
limitations and risks, and human review instructions. Attach the document as `model_card`
evidence on the model, and tell deployers when it materially changes.

## Decision log

| Decision ref | Model ID | Adverse? | Notice sent (date, channel) | Request type (correction / review) | Reviewer and authority | Evidence considered | Outcome and date | Grievance ID |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |  |
