# Propwise Mini CRM + AI lead assistant

A small real-estate CRM — NestJS API on Postgres, a Next.js web app, an Expo (React Native) app —
with an **AI lead assistant** built on top of it.

The assistant reads a lead's WhatsApp or email message, works out what they want, recommends
listings from the agent's own agency, and drafts a follow-up task that **is only saved once the
agent approves it**. It answers the brief in [TASK.md](TASK.md).

- **[NOTES.md](NOTES.md)** — the decisions I would defend, and an honest list of what is weak
- **[PLAN.md](PLAN.md)** — the phase-by-phase plan, with an amendment for every deviation and bug
- **[docs/ARCHITECTURE_AND_PLAN.md](docs/ARCHITECTURE_AND_PLAN.md)** — the original design record
  (about half Arabic; `PLAN.md` is the English route through it)

---

# Architecture

Design record: [docs/ARCHITECTURE_AND_PLAN.md](docs/ARCHITECTURE_AND_PLAN.md). This section follows
its stage numbering and routing table; where the shipped code diverges from it, the deviation is
recorded as an amendment in [PLAN.md](PLAN.md) and noted below.

## Five governing principles

Straight from the design doc, and everything else follows from them:

1. **The model understands language.** It is used in exactly two places: understanding text
   (extraction) and composing the reasons and the reply.
2. **Code decides the facts.** Numbers, dates, eligibility, isolation, status, and every database
   write.
3. **No write without approval.** No write tool is exposed to the model at all. The only path that
   creates a task is `approve`.
4. **The contract is literal.** The four endpoints and the `AssistantRun` / `ProposedAction` shapes
   are exactly as the brief defines them. Additions are new fields and new endpoints only.
5. **A failure is a failure.** Any model or tool-infrastructure error yields `status: "failed"`. It
   never says "no properties found".

## The pipeline

One run goes through seven stages:

```
  POST /leads/:id/assistant/runs {messageId?}        POST .../runs/:runId/messages {content}
  (the lead's message = DATA)                        (the agent's message = INSTRUCTIONS)
                 └────────────────────┬────────────────────┘
                                      ▼
  1. CONTEXT            (code)   lead (agency-scoped) · the message (400/404/422) ·
                                 last 10 messages · on chat: the parent run + last 6 turns ·
                                 the agency's areas, from the database
                                      ▼
  2. EXTRACTION         (model)  intent · each field with evidence {sourceId, quote} ·
                                 a timing phrase · property references
                                 no tools — generateText + Output.object(ExtractionSchema)
                                      ▼
  3. VALIDATE+NORMALIZE (code)   the quote must exist in the message it cites · the area must be
                                 one of the agency's · the amount must match the quote
                                 bad shape → one retry → failed;  bad evidence → field dropped
                                      ▼
  4. MERGE + ROUTE      (code)   merge onto the parent's state → RequirementsState
                                 pick one of six routes (table below)
                 ┌────────────────────┴────────────────────┐
                 ▼ search / property_question              ▼ rent / clarify / change_follow_up / closed
  5. AGENT + READ-ONLY TOOLS (model)            5'. TEMPLATE RESPONSE (code)
     sees a verified brief + the agent's turn       summary + reply from fixed templates
     tools: search_properties · get_property        no model call, no tools
     every tool call → trace
                 └────────────────────┬────────────────────┘
                                      ▼
  6. GUARDRAILS + ACTION    (code)   every propertyId re-checked against the database ·
                                     yield computed in code · deterministic ordering ·
                                     dueAt = f(timing, sentAt, agent.timezone) · pending_approval
                                      ▼
  7. PERSIST (em.fork)               assistant_runs + assistant_actions ONLY
                                     Lead, Message, Property and Task are never touched
                                      ▼
                       201 AssistantRun → web / mobile
                                      │
            POST .../actions/:actionId/approve   ← the only write path
            (transaction + PESSIMISTIC_WRITE → exactly one Task)
```

**One deliberate divergence from the design doc:** it specifies three tools, including
`compare_properties`. That was the first item on the plan's cut line and was cut, so the code has
two. `search_properties` alone covers the comparison the recommendations need.

## Trust levels

Three levels, from the design doc's section 9. Note that the agent and the lead are **not** equally
trusted — that asymmetry is what makes chat safe to add:

| Level | Source | How it is treated |
|---|---|---|
| 1. System | the code and the system prompt | never changes |
| 2. The agent | `agentMessage`, from an authenticated endpoint | **instructions, within bounds**: change the area, budget or appointment, ask questions. Cannot bypass approval, see another agency, or recommend something unavailable |
| 3. Lead + listings | message bodies and property descriptions | **data only**, inside tags |

## Six layers against injection

Ordered strongest to weakest — deliberately, because the strong ones do not depend on the model
behaving:

1. **There are no write tools at all**, so nothing can be executed no matter what the text says.
2. **`agencyId` lives in a closure**, not a tool parameter, so another agency cannot be requested.
3. **Code guardrails re-check every recommendation** against the database.
4. **The extraction model has no tools**, and it is the only one that sees raw lead messages.
5. **The agent sees a structured brief** — verified values and short evidenced preferences. It sees
   a property description only through `get_property`, wrapped as data.
6. **Prompt instructions** saying tagged content is data.

Layers 1–3 hold even if the model is fully persuaded; 4–6 reduce how often it is asked to be. Two
hardening details added after review: untrusted text has `<`/`>` neutralised so a body cannot close
its own tag and escalate to top-level prompt text, and the flag that closes a lead is evidence-gated
like every other field — without that, injected text could suppress the follow-up entirely.

## Routing

After merging, code picks one of six routes
([policy/router.ts](api/src/assistant/policy/router.ts)). This is the design doc's table, section 2:

| Route | Condition | Stage 5? | Recommendations | Proposed action | summary/reply |
|---|---|---|---|---|---|
| `search` | at least one search field (area, bedrooms, budget or type) and `transaction ≠ rent` | **yes** | from the agent, after the guardrails | a follow-up task | the agent |
| `property_question` | chat: a question about a specific listing | **yes** | **carried forward** from the parent run, re-verified | carried forward from the parent if it exists and is pending, otherwise none | the agent |
| `change_follow_up` | chat: the agent asks to move the appointment | no | carried forward, re-verified | a new task with the new date | template |
| `rent` | `transaction = rent` | no | `[]` | a follow-up task | template: listings are for sale only |
| `clarify` | no search field at all (e.g. "Hi") | no | `[]` | a follow-up task, to ask what they want | template |
| `closed` | the lead explicitly closed the topic | no | `[]` | `[]` | template |

Two notes the doc makes, both load-bearing:

- On `search`, finding nothing suitable is `recommendations: []` with `status: completed` and a
  summary that says so explicitly — not a failure.
- *"Approve it"* typed in chat classifies as `other`, routes to `property_question` needing no
  tools, and the reply points the agent at the Approve button. **No write happens.**

The shipped router drops the doc's literal `intent = requirements` condition on `search`: any
analysis-triggered run with a search field routes there regardless of intent, so a question that
carries a search field still searches. Recorded as amendment A8.

## Guardrails

Every recommendation the agent returns is re-checked in code
([policy/guardrails.ts](api/src/assistant/policy/guardrails.ts)) before it reaches the response —
the model's list is a *proposal*, not the answer. In order, per the doc's section 3.6:

1. the `propertyId` exists — re-fetched as `{ id, agency: agencyId }`, so existence and ownership
   are one query
2. `status === 'available'`
3. it appeared in a successful tool's output **in this run** — or was carried forward from the
   parent run and re-verified by steps 1 and 2
4. it matches the hard constraints: `area ∈ locations` (if any), `bedrooms` within range (if given),
   `type === propertyType` (if given), and `minAed ≤ price ≤ effectiveMax`, where `effectiveMax` is
   `maxAed × 1.05` when the qualifier is `around` and `maxAed` otherwise
5. deduped, capped at 5

Then:

- **Ordering.** With a yield preference, a deterministic code sort: `grossYield` descending,
  unknown last, then price ascending. Otherwise the agent's own order is kept.
- **Dropped recommendations** are recorded in `steps` with the reason, so a missing listing is
  explainable rather than mysterious.
- **A failing tool.** An infrastructure error (a database or service exception) makes the run
  `failed`. A tool *input-validation* error instead goes back to the model to correct, is recorded
  in the trace with an `error`, and does not fail the run on its own.

## Chat turns

A follow-up turn creates a **new run** rather than editing the old one. It carries `parentRun`,
reuses the parent's analysed message, and merges the agent's stated fields onto the parent's
requirements — so Sara only has to say what changed. It writes nothing to the conversation.

## Data model

The feature added two tables (`Migration20261030094536`) and changed nothing that existed:

```
assistant_runs     one analysis. requirements, recommendations, summary, trace, steps (jsonb),
                   plus parent_run_id, trigger ('analysis' | 'chat'), agent_message
assistant_actions  the proposed follow-up. status pending_approval | approved | rejected,
                   and a UNIQUE task_id so one action can never create two tasks
```

## Endpoints

```
POST   /leads/:leadId/assistant/runs                  analyse a message        201 AssistantRun
GET    /leads/:leadId/assistant/runs/:runId           one run                  200
POST   .../runs/:runId/actions/:actionId/approve      creates the task         200 { action, task }
POST   .../runs/:runId/actions/:actionId/reject       saves nothing            200 { action }

GET    /leads/:leadId/assistant/runs?limit=20   (additive)  run history, newest first
POST   /leads/:leadId/assistant/runs/:runId/messages  (additive)  a chat turn → a new run
```

Additive response fields, none of which change an existing field's meaning: `parentRunId`,
`trigger`, `agentMessage`, `reply`, `extraction`, `steps`, and `recommendations[].property`.

---

# The solution: choices worth defending

**Extraction is evidence-gated.** A field survives only if the model quotes the message it came
from *and* code finds that quote in it. This is what turns "a message is data, not instructions"
from a prompt instruction into an enforced property: text can argue for anything, but it cannot
produce a requirement the lead never stated. The same gate covers the flag that closes a lead —
without it, injected text could suppress the follow-up and report the lead as uninterested.

**`requirements` records what the lead said; matching is allowed to be kinder.** "Around 2M" is
stored as `2000000` and matched up to `2100000` (5%); "under" and "up to" get no tolerance. So a
recommendation can sit slightly above the `budgetAed.max` in the same response — deliberately.
Refusing a 2.05M flat to someone who said "around 2M" is worse behaviour; reporting 2.1M as their
budget would misreport them. The real ceiling is disclosed as `extraction.budgetEffectiveMaxAed`
with a `budget_tolerance` entry in `steps`, so the arithmetic is explainable.

**A budget bound needs the wording, not just a number.** "Around 2M AED" contains 2,000,000, so
amount-matching alone cannot tell a floor from a ceiling — a hallucinated minimum matches the quote
as well as the real maximum does. The qualifier decides which bounds may exist, which stops a
phantom floor silently dropping cheaper listings that fit.

**Dates anchor on whose words they were.** A lead's "tomorrow" is the day after *their message* was
sent, in `Asia/Dubai`, even when that lands on a Saturday and even if Sara reads it a day later.
The agent's own "move it to Tuesday" anchors on now. All date maths goes through luxon — never a
local `Date` method, because the API is graded under `TZ=UTC`.

**The UI shows exactly one proposal.** A chat turn leaves the previous run's action pending, and a
`property_question` turn proposes nothing while an older action is still live. The contract has no
"superseded" status and adding one was off-limits — so the UI walks the run chain newest-first and
surfaces a single action. Without that, one follow-up could be approved twice into two tasks.

**A failure is never "nothing found".** A model or tool failure gives `status: "failed"` with an
`error`, empty recommendations and empty actions. The UI renders that visibly differently from a
completed run that matched nothing.

[NOTES.md](NOTES.md) has the rest, including what is still weak.

---

# Running it

## What you need

- Node.js 24 (24.3+) or 22 (22.13+), and pnpm 10 (`corepack enable`, or `npm i -g pnpm@10`)
- Docker Desktop (or another Docker), running
- For mobile: **Expo Go** on your phone (same Wi-Fi), or an iOS Simulator / Android emulator

`pnpm run check-machine` checks all of this.

## Setup

```bash
pnpm run bootstrap
```

Installs the three apps, creates `api/.env` and `web/.env.local`, starts Postgres in Docker (port
5442, this laptop only) and loads the seed data. Then put your key in `api/.env`:

```
ANTHROPIC_API_KEY=<the key>
```

## Start it

Each in its own terminal:

```bash
TZ=UTC pnpm dev:api    # http://localhost:3001   (PowerShell: $env:TZ='UTC'; pnpm dev:api)
pnpm dev:web           # http://localhost:3000
pnpm dev:mobile        # press i / a / w, or scan the QR with Expo Go
```

**`TZ=UTC` is the interesting case**, and it is how the API is graded: all times render in the
agent's `Asia/Dubai` zone, so running the process in a different zone is what proves the timezone
handling rather than hiding a bug.

Sign in as **sara@marinabay.test** / **challenge123** (Marina Bay Realty). A second agency's agent,
**omar@desertkey.test** / **challenge123** (Desert Key Properties), exists to check that agencies
cannot see each other's data.

The mobile app calls the API on the computer that serves it, port 3001. If your phone can't reach
it, set `EXPO_PUBLIC_API_URL=http://<your laptop's IP>:3001` in `mobile/.env` and allow port 3001
through your firewall.

## See it work

Sign in as Sara, then on the lead page use the **AI assistant** panel on the right:

| Lead | What it shows |
|---|---|
| **Priya Nair** | The full path. Analyze → she wants to **rent**, so no listings and a summary saying why → **Approve** → the task appears in the Tasks panel below, dated in Dubai time |
| **Karim Mansour** | The main scenario: 2-bed Dubai Marina, around 2M, good rental yield, follow up tomorrow → requirements, recommendations with price and gross yield, and a dated follow-up |
| **Lina Haddad** | Nothing in the agency fits → `recommendations: []` with a summary explaining it — *not* an error |
| **Fatima Al Suwaidi** | Her message is in **Arabic**; extraction handles it |
| **Hassan Ali** | Only said "Hi" → the Analyze button is **disabled**, with a tooltip explaining why |
| **omar@desertkey.test** | Sign out and back in — a different agency, different leads, and Sara's run ids return 404 |

## Commands

| Command | What it does |
|---|---|
| `pnpm check` | Type checks and all tests in all three apps — **233 tests** |
| `pnpm -C api eval` | The assistant's eval suite against the real model: **17 cases**. Resets the test database itself, writes `api/evals/REPORT.md` and a trace per case. Needs a funded key |
| `pnpm -C api eval --case 2-matching-karim` | One case |
| `pnpm db:reset` | Drops all tables, migrates and reloads the seed. Seed times are relative to now; ids stay stable |
| `pnpm -C api test` / `test:e2e` | API unit tests / end-to-end tests against a separate `challenge_test` database |
| `pnpm -C web test` / `pnpm -C mobile test` | Component tests (Vitest, jest-expo) |
| `pnpm -C api db:migration:create` / `db:migrate` | Write / apply a migration |

The eval suite resets the database itself, so running it twice in a row is the "same verdicts
twice" check. **Note:** the committed `api/evals/REPORT.md` shows 17/17 but predates the last round
of fixes — the key ran out of credit before it could be regenerated. `NOTES.md` explains.

## Running without the assessment key

`ANTHROPIC_API_KEY` is the supported path and the default. There is one escape hatch for local
development, added when that key ran out of credit:

```
# api/.env — routes the model through OpenRouter's OpenAI-compatible API instead
OPENROUTER_API_KEY=sk-or-v1-...
ASSISTANT_MODEL=nvidia/nemotron-3.5-super-vl:free
```

Unset in a normal checkout, so nothing about the delivered behaviour changes. Two things to know:
model ids there carry a provider prefix (`anthropic/claude-sonnet-4.5`, not a bare name), and
`@ai-sdk/openai` is pinned to **3.0.135** because v4 depends on `@ai-sdk/provider@4` while `ai@6`
uses `3.0.x` — a mismatch `generateText` rejects.

A free model handles extraction (English and Arabic), routing, the template routes, the
timezone-correct date, and approve creating a task. It does **not** call tools, so the `search`
route returns no recommendations — model capability, not a code path.

---

# How the CRM is put together

```
api/      NestJS 11 + MikroORM 6 + Postgres 16
  src/assistant/      the AI assistant — extraction, policy, agent, guardrails, routes
  src/entities/       Agency, Agent, Lead, Message, Property, Task
  src/leads/          GET/POST /leads, GET /leads/:id, POST /leads/:id/messages
  src/properties/     GET /properties (filters), POST /properties, GET /properties/:id
  src/tasks/          GET/POST /leads/:id/tasks, PATCH /tasks/:id
  src/auth/           POST /auth/login, GET /auth/me, the JWT guard
  src/common/dto.ts   every response shape
  src/db/             migrations, seed, reset
  evals/              the eval suite: harness, 17 cases, report, traces
  test/               end-to-end tests
web/      Next.js 15 (App Router) + Tailwind
  src/components/     AssistantPanel, RunCard, ActionCard
  src/app/leads/[id]/page.tsx    the lead page
mobile/   Expo SDK 57 + Expo Router
  src/components/     AssistantPanel, RunCard, ActionCard
  src/app/leads/[id].tsx         the lead screen
seed/     the seed data, as JSON
```

- **Every route needs a login** except `POST /auth/login` and `GET /health`. The guard puts
  `{ id, agencyId }` on the request, and every service scopes its queries to `agencyId`. Another
  agency's records answer 404.
- **Listings are for sale**, priced in AED. Listing codes (`reference`, e.g. `MBR-1001`) are unique
  within an agency. `annualRentAed` is the estimated yearly rent if let (null when unknown).
  `bedrooms: 0` is a studio. `status` is `available`, `reserved` or `sold`.
- **Messages** have a `direction` (`inbound` from the lead, `outbound` from the agent) and a
  `sentAt`. `GET /leads/:id` returns the newest 200, oldest first, and `messageCount`.
- **Lists are capped**: leads and properties page with `limit` up to 100 (default 20) and a
  `total`; a lead's tasks stop at 100, with the total in `X-Total-Count`.
- **Times** are stored in UTC and sent with an offset (`2026-10-16T10:00:00+04:00` or `…Z`); the API
  rejects times without one. Agents have a `timezone` (`Asia/Dubai`), and both apps show times in it.

## Useful requests

```bash
TOKEN=$(curl -s localhost:3001/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"sara@marinabay.test","password":"challenge123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')

curl -s "localhost:3001/leads" -H "Authorization: Bearer $TOKEN"

# analyse a lead's latest message
curl -s -X POST "localhost:3001/leads/<leadId>/assistant/runs" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'
```

## Trouble

- **Windows: "not defined" or "cannot find module"**: the folder path is probably too deep —
  pnpm's paths can pass Windows' 260-character limit. Clone into a short folder such as `C:\dev`.
- **Port already in use**: something is on 3000, 3001, 5442 or 8081. To move the API, change `PORT`
  in `api/.env`, `NEXT_PUBLIC_API_URL` in `web/.env.local` and `EXPO_PUBLIC_API_URL` in
  `mobile/.env`. To move the database, change the port in `docker-compose.yml` and both URLs in
  `api/.env`.
- **Expo Go on iPhone shows a sign-in error**: sign in to the same Expo account in Expo Go and with
  `npx expo login`.
- **`ECONNREFUSED ::1:5442`**: the database listens on `127.0.0.1` only. Use `127.0.0.1`, not
  `localhost`, in database URLs.
- **Database errors after changing entities**: write a migration
  (`pnpm -C api db:migration:create`), or start over with `pnpm db:reset`.
