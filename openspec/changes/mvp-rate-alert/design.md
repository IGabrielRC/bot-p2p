# Design: mvp-rate-alert

## Technical Approach

Greenfield Node.js 22 LTS + TypeScript service on grammY (long polling), layered per brief §6: `transport` (handlers/keyboards/Spanish copy) ↔ `core` (business logic) ↔ `adapters` (Binance BAPI, Gmail) over `infra` (SQLite, AES-GCM vault, redacting logger). ALL BAPI knowledge lives in ONE module (`adapters/binance`). Per-client state in SQLite; secrets encrypted; failures page the developer via a distinct Telegram chat. Implements specs `rate-query`, `payment-alert`, `bot-access-config`.

## Architecture Decisions

### D1 — Stack: Node.js + TypeScript + grammY
| Criterion | grammY/TS | aiogram 3 (Py 3.10+, v3.25–3.27) |
|---|---|---|
| Inline UX DX | Verified 1:1 match to spec contract: `InlineKeyboard`, `bot.on("callback_query:data")` + `answerCallbackQuery` (instant ack), `ctx.api.editMessageText` (edit-in-place), `bot.catch` (global fail-loud) | Equivalent capability |
| Money-math safety | TS strict + decimal.js end-to-end | pydantic optional |
| Deploy footprint | node:22-alpine container | similar |
| Phase 2 ecosystem | Playwright; conversations plugin | Playwright |

**Choice**: Node/TS + grammY. **Rationale**: our inline interaction contract maps directly onto verified grammY APIs; end-to-end typing protects the money core; transformer middleware gives per-client concerns later. Source: context7 `/grammyjs/website` (keyboard/callbacks, hydrate/editMessageText, errors guide).

### D2 — `/calculo` arithmetic (locked pure function)
Inputs: `amountEur`, `corridor` (`"ES->VE" | "OTHER"` — MVP ships ES→VE only; OTHER kept in the union so ineligible-corridor behavior is representable and unit-testable), `marginPct` (default from client config; tiers 10/8/7), `convMarginPct` (**default 13.5%**, midpoint of 13–14%, configurable). All math in `decimal.js` — never floats.
1. Fee: `€3` iff `amountEur ≤ 300` AND `corridor === "ES->VE"` (exact Decimal compare; €300 included, €300.01 excluded).
2. Conversion: `eurNet = amountEur − fee`; `usdtEq = eurNet × usdtPerEur × (1 − convMarginPct)`; `usdtPerEur` from the BAPI USDT/EUR search pinned to **`tradeType=BUY`** — Kelly converts received EUR into USDT, i.e. SHE is buying USDT with EUR, and searcher-perspective semantics mirror the VES leg (`SELL` there because she sells USDT). Reusing `SELL` on this leg is a defect even if results look plausible.
3. Margin over buyer-side rate: `priceVes = buyerSideUsdtVes × (1 − marginPct)`; `finalBs = usdtEq × priceVes`.
Rates carried at scale 8; round ONCE at output (`finalBs` ROUND_HALF_UP, 2 dp). Breakdown lines mirror steps; fee line present/absent exactly per spec scenarios. Invalid/non-positive input never reaches the function — transport validates and replies Spanish usage guidance; a non-ES→VE corridor request gets the same usage-guidance reply at transport, while the pure function remains total and handles `"OTHER"` itself (full breakdown, no fee line — exercised by direct unit test, keeping the M1 gate check valid).

### D3 — Module C detection (C1 baseline)
`googleapis`, scope `gmail.readonly`. One-time installed-app OAuth locally (`npm run auth:gmail`) stores refresh token encrypted. Poll loop every **45 s**: `messages.list(q:"from:binance.com newer_than:1d")` → fetch unseen (`format=full`) → classify `payment_paid | ignorable | anomaly`. Only `payment_paid` alerts; `anomaly` stores snippet + developer notice; ignorable silent. Delivery semantics — **at-least-once (product-owner option B)**: `processed_messages(message_id PK, status pending|sent)` with insert-pending → send → mark-sent. A crash between send and mark-sent ⇒ redelivery by the recovery sweep (harmless duplicate for Kelly); silent loss NEVER. Steady-state duplicates impossible (id-keyed claim before send). A runtime sweeper retries `pending` rows every 30 s with exponential backoff capped at 10 min; after 5 failed attempts it escalates to a developer alert — no stall-until-restart. Library handles token refresh; auth failure ⇒ immediate developer alert PLUS `clientNotice(chatId, copyKey)` calm-Spanish notice pushed to the client chat (Telegram Bot API works outside any request context, so background poller failure handlers can call it directly; mechanism distinct from developerAlerts). Secrets: AES-256-GCM envelope (`ENCRYPTION_KEY` 32-byte hex from env, file 0600), ciphertext in `vault` table; pino `redact` paths — no secret logged. OS keyring rejected: headless VPS has no standard keyring.

### D4 — C2 (SAPI C2C) verification — timeboxed probe, promotion decided at M3
Live doc check today failed (search provider down; developers.binance.com JS-rendered). **Timebox A — 60 min, post-scaffold**: (1) enumerate documented endpoints under developers.binance.com/docs/c2c/rest-api; (2) authenticated read-only smoke probe with a personal key. The promotion criterion lives OUTSIDE the timebox: an observable live order-state change within <60 s across ≥3 real transactions during Kelly's M3 pilot decides promotion. If promoted, swap `MailPoller` for `OrderStatusPoller` behind the shared `PaymentEventSource` interface; C1 remains baseline until then. Confidence LOW — C1 ships.

### D5 — Hosting: cheap VPS, long-lived process
In-process 45 s scheduler + long polling meets the <60 s target deterministically; serverless adds cold starts + cron-granularity floors that eat the budget and complicate SQLite state. One systemd/Docker process, tiny `/healthz` endpoint watched by an external uptime monitor, `Restart=on-failure`. Same model scales to dozens of tenants. ~€4–5/month.

### D6 — Delivery milestones (decision #10 order)
- **M1 Dogfood** (gate: Gabri-only allowlist): /tasa comparative view; /calculo 300 / 300.01 / ineligible-corridor (transport replies Spanish usage guidance; fee-line absence additionally proven by the quote() `"OTHER"` unit test); real paid-email alert <60 s; failure drill (cut network → Spanish error + dev alert). Exit: checklist executed on Gabri's chat ID + demo video recorded.
- **M2 Demo package**: video + trust/revocation handoff doc for Kelly.
- **M3 Kelly pilot**: allowlist switched to Kelly; her Gmail connected; ≥5 consecutive clean trading days.
- **M4 Phase 2 pitch** only after M3 sign-off.

### Cross-cutting
Zero hardcoded client data. SQLite: `clients(chat_id PK, name, default_margin_pct, conv_margin_pct, locale, onboarded_at)`, `processed_messages`, `parse_anomalies`, `audit_log(actor, action, detail, ts)` (rejections, config edits, privileged actions), `vault(client_id, kind, iv, tag, ciphertext)`. Developer alerting = Telegram message to `DEVELOPER_CHAT_ID` (same bot, distinct chat); client-facing notices from background handlers go through `clientNotice` (see D3). Randomized spacing: per-client jitter (0.5–2 s) wrapper around every outbound BAPI call, day 1.

Rapid-refresh concurrency (implements rate-query "Rapid repeated presses"): single-flight/debounce keyed by message ID — while a refresh for a card is in flight, further presses for that card are coalesced into it or gracefully rejected. Telegram's `message is not modified` BadRequest is caught and swallowed. Stale callback_query targets are ignored: the handler checks message date/edit age against a freshness window before doing work.

Allowlist guard (accessGuard): checks `from.id` — never chat.id — for BOTH commands AND callback_query; a press on forwarded/re-posted buttons is guarded by `callback_query.from.id`. If the bot is added to a group, ALL non-allowlisted senders are denied regardless of which chat they act from. Inline mode is DISABLED via BotFather settings — recorded as a documented setup step so inline queries can never bypass the guard.

## Data Flow

```
Kelly ─cmd─▶ transport ─▶ accessGuard ─▶ core.quote/rateService ─▶ BapiAdapter ─▶ bapi.binance.com
  ▲             │ deny→audit      │              (VES leg: tradeType=SELL · EUR leg: BUY, jitter)
  │             ▼                 ▼
Telegram ◀── alertSvc ◀── gmailPoller ◀─ gmail.readonly (45 s)     devAlerts ─▶ DEVELOPER_CHAT_ID
  ▲               │ dedupe · retry/backoff · anomalies · audit      clientNotice ─▶ client chat (ES notice)
  │               ▼
SQLite (clients · processed_messages · audit_log · vault)
```

## File Changes

| File | Action | Description |
|---|---|---|
| `src/index.ts` | Create | Composition root, graceful shutdown, healthz |
| `src/bot.ts` | Create | grammY wiring, `bot.catch` fail-loud |
| `src/transport/handlers/{tasa,calculo,config,start}.ts` | Create | Commands + callbacks, validation |
| `src/transport/{keyboards,copy.es}.ts` | Create | Inline keyboards; Spanish strings isolated |
| `src/core/quote.ts` | Create | Pure pricing chain (D2) |
| `src/core/rateService.ts` | Create | Buyer-side lookups, no-fallback |
| `src/core/paymentAlertService.ts` | Create | Alert format/delivery, tap-to-copy |
| `src/core/{accessGuard,developerAlerts,clientNotice,audit}.ts` | Create | Allowlist, fail-loud dev alerts, background-safe client notices, audit trail |
| `src/adapters/binance/{bapiClient,rateLimiter}.ts` | Create | ALL gray-zone BAPI knowledge + spacing |
| `src/adapters/gmail/{gmailPoller,parsePaidEmail}.ts` | Create | C1 detection + parsing |
| `src/infra/{db,vault,logger,env}.ts` | Create | Schema/migrations, AES-GCM, redact log |
| `scripts/auth-gmail.ts` | Create | One-time OAuth grant |
| `test/**` | Create | Mirrors src layout |

Nothing modified/deleted elsewhere.

## Interfaces / Contracts

```ts
// core/quote.ts — pure, total
interface QuoteInput { amountEur: Decimal; corridor: "ES->VE" | "OTHER"; marginPct: Decimal; convMarginPct: Decimal; }
interface QuoteRates { usdtVesBuyerSide: Decimal; usdtPerEur: Decimal; }
type QuoteStep = { kind: "fee"|"conversion"|"margin"|"total"; labelEs: string; value: string };
function quote(i: QuoteInput, r: QuoteRates): { steps: QuoteStep[]; finalBs: Decimal };
// corridor="OTHER": total behavior — breakdown omits the fee line; transport normally rejects OTHER
// upstream with Spanish usage guidance, so the function's OTHER path is exercised by direct unit test.

// adapters — swappable source enables C1→C2 promotion (D4)
interface PaymentEventSource { start(onEvent: (e: PaidEvent) => Promise<void>): void; stop(): void; }
interface PaidEvent { orderId: string; amount: string; reference: string; } // orderId rendered monospace tap-to-copy

// notifications — both callable from background poller failure handlers (no request context needed)
function developerAlert(detail: string): Promise<void>;                // → DEVELOPER_CHAT_ID
function clientNotice(chatId: number, copyKey: string): Promise<void>; // → client chat, calm Spanish copy
```

## Testing Strategy
| Layer | What | Approach |
|---|---|---|
| Unit | quote(): €300 incl / 300.01 excl / `corridor:"OTHER"` → no fee line / rounding; BAPI payload assertions PER LEG — USDT/VES lookup asserts `tradeType:"SELL"` and USDT/EUR lookup separately asserts `tradeType:"BUY"` (no shared generic assertion); email classifier + parser on fixture emails | Vitest |
| Integration | duplicate-poll dedupe in steady state; crash between send & mark-sent ⇒ exactly-one recovery redelivery, never silent loss; persistent send failure ⇒ backoff retries then developer escalation; token expiry → dev alert AND clientNotice delivered; rate failure → Spanish error, no stale value; rapid-refresh storm ⇒ presses coalesced/rejected gracefully, `message is not modified` swallowed, stale callbacks ignored | In-memory SQLite + recorded HTTP fixtures + fake Telegram API |
| E2E | M1 checklist: real bot token, real paid-email latency, failure drill | Manual milestone gate |

## Threat Matrix
N/A — no OS command routing, shell/subprocess execution, VCS/PR automation, executable-file classification, or host process-integration boundary; only outbound HTTPS APIs (Telegram/Binance/Gmail).

## Task-Level Notes (inputs for sdd-tasks — captured, not fully designed here)
- **Email classifier criteria (review F9)**: pin accept/reject rules (sender address, subject markers, mandatory fields) for the paid-email classifier before parsing; freeze the fixture set once real samples are collected.
- **Unit convention & scale discipline (review F10)**: margins stored/compared as percent numbers (10 = 10%) everywhere — one convention, converted exactly once at the multiply site; decimal.js intermediate scale fixed at 8 end-to-end.
- **healthz depth (review F11)**: `/healthz` must report poller heartbeat freshness plus a SQLite read probe, not bare process liveness.
- **Ops hygiene (review F12)**: document an ENCRYPTION_KEY rotation runbook (re-encrypt `vault` rows under the new key) and a pruning policy for `processed_messages`/`parse_anomalies` (e.g., >90 days).

## Migration / Rollout
Greenfield, no migration. Rollout gated by milestones (D6). Kill switches: stop process; revoke Google OAuth grant; rotate bot token. Config additive.

## Open Questions
- [x] Hosting sign-off (brief §10): cheap VPS long-lived process CONFIRMED by product owner 2026-08-22.
- [ ] Confirm BAPI USDT/EUR lookup returns usable shape during tasks-phase smoke test before `/calculo` ships.
- [ ] Collect real Binance paid-notification email templates (ES/EN) from Kelly's mailbox during M1 setup.
