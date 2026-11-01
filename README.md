# Propwise Mini CRM: AI assessment

A small real estate CRM: a NestJS API on Postgres, a Next.js web app and an Expo (React Native) app. Login, leads, messages, listings and tasks already work. **What to build is in [TASK.md](TASK.md).**

## What you need

- Node.js 24 (24.3 or newer) or 22 (22.13 or newer), and pnpm 10 (`corepack enable`, or `npm i -g pnpm@10`)
- Docker Desktop (or another Docker), running
- For mobile, one of:
  - **Expo Go** on your phone (same Wi-Fi as your laptop). On an **iPhone**, Expo Go now needs a free Expo account: sign in inside Expo Go and run `npx expo login` on your laptop. Android phones don't need this.
  - an **iOS Simulator** (Mac with Xcode) or an **Android emulator**

`pnpm run check-machine` checks all of this.

## Setup (1 to 3 minutes on our test laptop)

```bash
pnpm run bootstrap
```

That installs the three apps, creates `api/.env` and `web/.env.local`, starts Postgres in Docker (port 5442, this laptop only) and loads the seed data. Then put your key in `api/.env`:

```
ANTHROPIC_API_KEY=<the key we gave you>
```

## Run it

Each in its own terminal:

```bash
pnpm dev:api      # http://localhost:3001
pnpm dev:web      # http://localhost:3000
pnpm dev:mobile   # then press i (iOS Simulator), a (Android emulator), w (browser), or scan the QR code with Expo Go
```

Sign in as **sara@marinabay.test** / **challenge123** (Marina Bay Realty). A second agency's agent, **omar@desertkey.test** / **challenge123** (Desert Key Properties), is there to check that agencies can't see each other's data.

The mobile app calls the API on the computer that serves it, on port 3001. If your phone can't reach it, set `EXPO_PUBLIC_API_URL=http://<your laptop's IP>:3001` in `mobile/.env` and allow port 3001 through your firewall.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm db:reset` | Drops all tables, runs the migrations and reloads the seed data. Times in the seed are relative to now, so a fresh reset always has a message from "18 minutes ago". Ids stay the same across resets. |
| `pnpm -C api db:migration:create` | Writes a migration for your entity changes (run `pnpm -C api db:migrate` first). |
| `pnpm -C api db:migrate` | Applies pending migrations. |
| `pnpm -C api test` | API unit tests (`src/**/*.spec.ts`). |
| `pnpm -C api test:e2e` | API end-to-end tests (`test/*.e2e-spec.ts`), against a separate `challenge_test` database that is reset first. |
| `pnpm -C web test` | Web component tests (Vitest + Testing Library). |
| `pnpm -C mobile test` | Mobile component tests (jest-expo + Testing Library). |
| `pnpm -C api eval` | The AI assistant's eval suite against the real model. Resets the test database itself, writes `api/evals/REPORT.md` and a trace per case. `--case <name>` runs one. Needs a working `ANTHROPIC_API_KEY`. |
| `pnpm check` | Type checks and all tests in all three apps. |

## The AI assistant

Built on top of the CRM above: it reads a lead's message, works out what they want, recommends
listings from the agent's own agency, and drafts a follow-up task that is only saved once the agent
approves it. See [NOTES.md](NOTES.md) for the decisions, the known weaknesses, and how to run it.

The model reads language; code decides every fact and owns the only write. It has two read-only
tools (`search_properties`, `get_property`) and no write tool, the agency id lives in a closure
rather than a tool parameter, and every recommendation is re-checked against the database before it
is returned.

```
POST   /leads/:leadId/assistant/runs                 analyse a message -> 201 AssistantRun
GET    /leads/:leadId/assistant/runs/:runId          one run
GET    /leads/:leadId/assistant/runs?limit=20        the run history, newest first
POST   /leads/:leadId/assistant/runs/:runId/messages a follow-up chat turn -> a new run
POST   .../runs/:runId/actions/:actionId/approve     the only path that creates a task
POST   .../runs/:runId/actions/:actionId/reject      saves nothing
```

In the UI it is the "AI assistant" panel on the web lead page and the card on the mobile lead
screen. Start the API in UTC (`TZ=UTC pnpm dev:api`) — all times are rendered in the agent's
`Asia/Dubai` timezone, so running the API in a different zone is the interesting case.

## How it's put together

```
api/      NestJS 11 + MikroORM 6 + Postgres 16
  src/entities/       Agency, Agent, Lead, Message, Property, Task
  src/leads/          GET/POST /leads, GET /leads/:id, POST /leads/:id/messages
  src/properties/     GET /properties (filters), POST /properties, GET /properties/:id
  src/tasks/          GET/POST /leads/:id/tasks, PATCH /tasks/:id
  src/auth/           POST /auth/login, GET /auth/me, the JWT guard
  src/common/dto.ts   every response shape
  src/db/             migrations, seed, reset
  test/               end-to-end tests
web/      Next.js 15 (App Router) + Tailwind
  src/app/leads/[id]/page.tsx    the lead page, with the "AI assistant" panel
mobile/   Expo SDK 57 + Expo Router
  src/app/leads/[id].tsx         the lead screen, with the "AI assistant" card
seed/     the seed data, as JSON
```

- **Every route needs a login** except `POST /auth/login` and `GET /health`. The guard puts `{ id, agencyId }` on the request, and every service scopes its queries to `agencyId`. Another agency's records answer 404.
- **Listings are for sale**, priced in AED. Each agency's listing codes (`reference`, e.g. `MBR-1001`) are unique within that agency. `annualRentAed` is the estimated yearly rent if the unit were let (null when unknown). `bedrooms: 0` is a studio. `status` is `available`, `reserved` or `sold`.
- **Messages** have a `direction` (`inbound` from the lead, `outbound` from the agent) and a `sentAt`. `POST /leads/:id/messages` records one, as a WhatsApp or email integration would. `GET /leads/:id` returns the newest 200, oldest first, and `messageCount`.
- **Lists are capped**: leads and properties come in pages (`limit` up to 100, default 20) with a `total`; a lead's tasks stop at 100, with the total in the `X-Total-Count` header.
- **Times** are stored in UTC and sent with an offset (`2026-10-16T10:00:00+04:00` or `…Z`); the API rejects times without one. Agents have a `timezone` (`Asia/Dubai`), and both apps show times in it.

### Useful requests

```bash
TOKEN=$(curl -s localhost:3001/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"sara@marinabay.test","password":"challenge123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')

curl -s "localhost:3001/leads" -H "Authorization: Bearer $TOKEN"
curl -s "localhost:3001/properties?area=Dubai%20Marina&minBedrooms=2&maxBedrooms=2&maxPriceAed=2200000&status=available" \
  -H "Authorization: Bearer $TOKEN"
```

## Trouble

- **Windows: tests or tools fail with "not defined" or "cannot find module" errors**: the folder path is probably too deep. pnpm's package paths can go past Windows' 260-character limit. Clone into a short folder such as `C:\dev`.
- **Port already in use**: something else is on 3000, 3001, 5442 or 8081. Stop it if you can. To move the API, change `PORT` in `api/.env`, `NEXT_PUBLIC_API_URL` in `web/.env.local` and set `EXPO_PUBLIC_API_URL` in `mobile/.env`. To move the database, change the port in `docker-compose.yml` and both URLs in `api/.env`.
- **Expo Go on iPhone shows a sign-in error**: sign in to the same Expo account in Expo Go and with `npx expo login`.
- **`ECONNREFUSED ::1:5442`**: the database listens on `127.0.0.1` only. Use `127.0.0.1`, not `localhost`, in database URLs.
- **Database errors after changing entities**: write a migration (`pnpm -C api db:migration:create`), or start over with `pnpm db:reset`.
