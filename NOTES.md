# NOTES

An AI assistant for the Propwise lead pipeline: it reads a lead's message, works out what they
want, recommends listings from the agent's own agency, and drafts a follow-up task that only
appears once the agent approves it.

## What it does

A run goes through seven stages. The split is deliberate: **the model reads language, code decides
facts and owns every write.**

1. **Context** — the lead, the analysed message, the last 10 messages, and the agency's areas.
2. **Extract** (model, structured output) — requirements, intent, follow-up timing. Every field has
   to quote the message it came from, and code checks the quote is really there.
3. **Merge** (code) — the extracted fields overlay the previous state, field by field.
4. **Route** (code) — `search`, `property_question`, `change_follow_up`, `rent`, `clarify` or
   `closed`. Three of those never call the model at all.
5. **Agent** (model + read-only tools) — `search_properties` and `get_property`. The agency id is
   not a tool parameter; it lives in a closure, so the model cannot ask about another agency.
6. **Guardrails** (code) — every recommendation is re-fetched from the database and re-checked:
   it exists, belongs to this agency, is `available`, appeared in this run's own tool output, and
   meets the hard constraints. Then deduped, sorted, capped at 5.
7. **Propose** (code) — one follow-up task, `pending_approval`. `POST …/approve` is the only code
   path in the whole feature that creates a task.

**Endpoints.** The four from the brief, plus two additive ones:

```
POST   /leads/:leadId/assistant/runs                               201 AssistantRun
GET    /leads/:leadId/assistant/runs/:runId                        200 AssistantRun
POST   /leads/:leadId/assistant/runs/:runId/actions/:actionId/approve   200 { action, task }
POST   /leads/:leadId/assistant/runs/:runId/actions/:actionId/reject    200 { action }
POST   /leads/:leadId/assistant/runs/:runId/messages   (additive)  201 AssistantRun  — a chat turn
GET    /leads/:leadId/assistant/runs?limit=20          (additive)  200 { items, total }
```

Additive response fields, none of which change an existing field's meaning: `parentRunId`,
`trigger`, `agentMessage`, `reply`, `extraction`, `steps`, and `recommendations[].property`.

**UI.** Web (`web/src/components/AssistantPanel.tsx`) loads the latest run, analyses, shows what was
understood and the recommendations, approves or rejects, and has a chat box; an approved task shows
up in the Tasks panel beside it. Mobile mirrors it including approve/reject, without chat.

## How to run it

```bash
pnpm bootstrap                      # deps + Postgres in Docker
# put ANTHROPIC_API_KEY=... in api/.env

pnpm db:reset                       # recreate tables + seed
TZ=UTC pnpm dev:api                 # :3001   (PowerShell: $env:TZ='UTC'; pnpm dev:api)
pnpm dev:web                        # :3000   Sara: sara@marinabay.test / challenge123
pnpm dev:mobile                     # Expo

pnpm -C api eval                    # the eval suite -> api/evals/REPORT.md + traces/
pnpm -C api eval --case 2-matching-karim    # one case
pnpm check                          # typecheck + tests, all three apps (218 tests)
```

The eval suite resets the test database itself, so running it twice in a row is the
"same verdicts twice" check. It needs a working key — every route makes at least one model call.

## Decisions I would defend

**The model never writes, and never decides a fact.** It has two read-only tools and no write tool,
so there is nothing for an injected instruction to execute. Prices, yields, dates, eligibility,
agency scope and the one write all live in code.

**Extraction is evidence-gated.** A field survives only if the model quotes the message it came
from and code finds that quote in it. This is what makes "a message is data, not instructions"
enforceable rather than aspirational: text can argue for anything, but it cannot produce a
requirement it did not state. The same gate covers `closed`, because closing a lead suppresses the
follow-up — that was the one hole an audit found, and it is fixed.

**`requirements` is what the lead said; matching is allowed to be kinder.** "Around 2M" is stored
as `2000000` and matched up to `2100000` (5%); "under" and "up to" get no tolerance. So a
recommendation can sit slightly above the `budgetAed.max` in the same response — deliberately, and
the real ceiling is disclosed as `extraction.budgetEffectiveMaxAed` with a `budget_tolerance` entry
in `steps`. Refusing a 2.05M flat to someone who said "around 2M" would be worse behaviour; the
alternative of reporting 2.1M as the budget would misreport what they asked for.

**Dates anchor on whose words they were.** A lead's "tomorrow" is the day after *their message* was
sent, in `Asia/Dubai`, even if that is a Saturday and even if Sara reads it a day later. The agent's
own "move it to Tuesday" anchors on now. All date maths goes through luxon — never a local `Date`
method, since the API is graded under `TZ=UTC`.

**A chat turn is a new run, not an edit.** It carries `parentRun`, reuses the parent's analysed
message, and writes nothing to the conversation. Its requirements start from the parent's state so
Sara only has to say what changed.

**The UI shows exactly one proposal.** A chat turn leaves the previous run's action pending, and a
`property_question` turn proposes nothing while an older action is still live. The contract has no
"superseded" status and adding one was off-limits, so the UI walks the run chain newest-first and
surfaces a single action — otherwise one follow-up could be approved twice into two tasks.

**Failure is never silence.** A model or tool failure gives `status: "failed"` with an `error`, empty
recommendations and empty actions — never "no matching properties".

## What is weak or missing

Honest list. The first two are blockers I could not clear; the rest are known and unfixed.

1. **The committed eval report is stale.** `api/evals/REPORT.md` shows 17/17, but it was generated
   *before* the six fixes in `fix(assistant): six defects found reviewing phase 6`.
   `traces/13-chat-narrowing.json` still shows the `dueAt: null` bug that commit fixed. The
   assessment key now returns `invalid x-api-key`, so it cannot be regenerated —
   **`pnpm -C api eval` needs re-running with a working key.** Those six fixes are covered instead
   by three e2e regression tests that each fail without them.
2. **"Same verdicts twice" is unverified against the shipped code**, for the same reason. No
   sampling parameters are set anywhere, so the model runs at the provider default; the assertions
   are written as sets and orderings rather than exact matches to tolerate that.
3. **A hallucinated `budget.minAed` is not challenged.** The evidence check validates
   `maxAed ?? minAed`, so only the larger amount is scrutinised. Committed traces show `minAed`
   set to 2,000,000 for Karim, which silently dropped MBR-1007 and MBR-1002 from his shortlist.
4. **A tool-infrastructure failure reports the wrong cause.** `Trace.firstInfraError()` exists but
   is never called, so the run's `error` is whatever escaped the abort rather than the real reason.
   The trace entry carries the truth; the `error` string does not.
5. **A tool call whose arguments fail validation leaves no trace entry.** `recordInputError` is
   unwired (no `onStepFinish`), so "every tool call, in order" has a gap for that one case.
6. **`5b-injection-description-mbr1019` passes vacuously.** MBR-1019 is a 4-bed 6.2M villa that
   never entered the model's context for a 2-bed Marina lead, so the assertion proves little.
   `5c-injection-chat-mbr1019` is the real test — it forces a `get_property` on it first.
7. **The two date eval cases are tautological** — they compute the expected value with
   `computeDueAt`, the function under test, because seed timestamps are relative to "now" and
   cannot be hardcoded. They prove the service wires the right `sentAt` through; the date maths
   itself is proven by `follow-up-date.spec.ts`, which hardcodes a Friday → Saturday case.
8. **`intent` is not evidence-gated**, and `summary`, `reply` and the task title/notes are free
   model prose. The recommendation *list* is injection-proof; the text Sara reads is not.
9. **Untrusted text is interpolated into the prompt without escaping.** A message body containing
   a literal `</lead_message>` could close its tag. It cannot forge the agent's trusted channel
   (that id only resolves on a chat turn, and the quote must be in Sara's own text) and it cannot
   add a recommendation or write anything, but the prose channel is reachable.
10. **`guardrails.ts`'s `other_agency` check cannot fire** — the SQL `WHERE` already filtered the
    row. Isolation is real, but that particular line reads as more defence than it provides.
11. **Not verified end to end**: `analyze → approve → task appears` in a browser, the Expo Go run,
    and a manual `curl` round against all five seed leads. All three need one live model call.
12. **`compare_properties` and mobile chat were cut**, in that order, as the plan's cut line
    intended.
13. **`docs/ARCHITECTURE_AND_PLAN.md` is about half Arabic** and is superseded in roughly twenty
    places by `PLAN.md`'s amendments. It is kept as the original design record those amendments
    reference by section, not as a description of the current code.

## Tests

| | |
|---|---|
| `TZ=UTC pnpm -C api test` | 116 unit — policy, dates, guardrails, extraction, tracing, agent runner |
| `pnpm -C api test:e2e` | 66 e2e — real Postgres, mocked model, full route and error matrix |
| `pnpm -C web test` | 27 — the cards and the one-proposal rule |
| `pnpm -C mobile test` | 16 — the same, on React Native |
| `pnpm -C api eval` | 17 cases against the real model, covering all eight required categories |

## How I worked

`CLAUDE.md` holds the binding rules; `PLAN.md` is the phase-by-phase plan with an amendments
section recording every deliberate deviation and every bug found along the way — including the ones
that cost the most to find (`tsx` silently dropping decorator metadata, the structured-output union
limit, and the follow-up action being decided by the model instead of by code). Each phase was
planned, reviewed, then applied. Several phases were reviewed adversarially afterwards by
independent passes with no prior context, which is how the `closed` hole, the budget-disclosure gap
and the one-proposal bug were found.

**AI session history** (brief item 4) is at `~/.claude/projects/c--dev-propwise-ai-challenge/` —
two `.jsonl` transcripts. They are deliberately **not** committed: ~25 MB, and they contain a
credential that was pasted into the session.
