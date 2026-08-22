# Tasks: mvp-rate-alert — MVP Rate + Payment Alert Bot

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~2,900 (range 2,400–3,200, incl. tests) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 scaffold/secrets → PR2 persistence/probes → PR3 BAPI/rates → PR4 quote/calculo → PR5 gmail-parse/alert-fmt → PR6 poller/dedupe/retry → PR7 access/config/notices → PR8 tasa UX/runtime → PR9 auth-gmail/docs/M1 gate |
| Delivery strategy | auto-chain (cached preflight, Engram #939) |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

Reasoning (taught, not hidden — preference #936): greenfield, 5 layers, 31 tasks ≈ 2.9k lines cannot honor a 400-line review budget in one PR. Every slice below is independently mergeable and revertible, so stacked-to-main wins over feature-branch-chain tracker overhead for a solo-dev repo with no remote yet. Override allowed before apply.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Scaffold + env + vault/logger | PR 1 | `npx vitest run test/infra` | N/A — no process behavior yet | Delete new files; deps additive |
| 2 | DB schema + audit + BAPI probes | PR 2 | `npx vitest run test/infra test/adapters/binance` | N/A — probes recorded as fixtures | Drop db/audit modules + fixture files |
| 3 | BAPI client (RED legs) + rateService | PR 3 | `npx vitest run test/adapters test/core/rateService` | Fixture-replay HTTP, offline | Remove adapter+service files |
| 4 | quote() + /calculo + copy/keyboards | PR 4 | `npx vitest run test/core/quote test/transport` | N/A until bot wired (PR 8) | Remove core/quote + calculo handler |
| 5 | Gmail fixtures + classifier/parser + alert format | PR 5 | `npx vitest run test/adapters/gmail test/core/paymentAlertService` | Fixture emails, offline | Remove gmail parse + alert-format files |
| 6 | Poller + dedupe/redelivery + backoff + token-path | PR 6 | `npx vitest run test/adapters/gmail/poller test/integration` | In-memory SQLite crash/restart sim | Remove poller/sweeper; parser stays usable |
| 7 | accessGuard + onboarding + /config + notices | PR 7 | `npx vitest run test/core/accessGuard test/transport/config` | Fake Telegram API suite | Remove guard/onboarding/config modules |
| 8 | /tasa UX + failure path + bot/index/healthz | PR 8 | `npx vitest run test/transport test/integration` | `npm start` against @BotFather test bot; press refresh | Stop process; remove bot wiring files |
| 9 | auth-gmail script + README/runbooks + M1 gate | PR 9 | `npx vitest run` (full) | Manual: OAuth grant; M1 checklist on Gabri chat | Revoke OAuth grant; docs-only revert |

## Phase 1: Foundation / Infrastructure

- [ ] 1.1 **Project scaffold**: create `package.json` (Node 22 LTS, TS strict, deps: grammY, decimal.js, googleapis, pino, better-sqlite3), `tsconfig.json`, `vitest.config.ts`, eslint+prettier configs, extend `.gitignore`. Done: `npm run build` + `npx vitest run` green on placeholder suite. ~120L
- [ ] 1.2 **Env config** `src/infra/env.ts`: typed parse of `BOT_TOKEN`, `DEVELOPER_CHAT_ID`, `ENCRYPTION_KEY` (32-byte hex), `ALLOWLIST_TELEGRAM_IDS`, `GMAIL_POLL_INTERVAL_S=45`, `ALERT_RETRY_BASE_S=30`, `ALERT_RETRY_CAP_S=600`, `ALERT_RETRY_MAX_ATTEMPTS=5`, `BAPI_TIMEOUT_MS`; fail-fast on missing/invalid. Write `.env.example` documenting every var. Test: missing var throws loud error; defaults asserted (`test/infra/env.test.ts`). ~110L
- [ ] 1.3 **SQLite layer** `src/infra/db.ts`: tables `clients(chat_id PK, name, default_margin_pct, conv_margin_pct, locale, onboarded_at)`, `processed_messages(message_id PK, status)`, `parse_anomalies`, `audit_log(actor, action, detail, ts)`, `vault(client_id, kind, iv, tag, ciphertext)`; in-memory mode for tests. Test: schema + PK constraint (`test/infra/db.test.ts`). ~90L
- [ ] 1.4 **AES-256-GCM vault** `src/infra/vault.ts`: encrypt/decrypt envelope, key from `ENCRYPTION_KEY`. Test: roundtrip; tampered tag rejects; ciphertext ≠ plaintext (`test/infra/vault.test.ts`). ~80L
- [ ] 1.5 **Redacting logger** `src/infra/logger.ts`: pino with `redact` paths for token/key fields. Test: injected secret absent from emitted line (`test/infra/logger.test.ts`). ~50L
- [ ] 1.6 **Audit trail** `src/core/audit.ts`: `record(actor, action, detail)` with timestamp. Test: row persisted and readable (`test/core/audit.test.ts`). ~40L
- [ ] 1.7 **GATE for 4.3 — BAPI USDT/EUR BUY smoke probe** (design Open Question): unauthenticated probe script `scripts/bapi-smoke.ts` calling P2P search with `tradeType=BUY, fiat=EUR`; record real response shape as `test/fixtures/bapi/usdt-eur-buy.json`. Done: fixture committed + usability verdict noted in change log. Blocks 4.3. ~30L
- [ ] 1.8 **Timebox A (60 min)** — SAPI C2C endpoint enumeration + authenticated read-only smoke probe (personal key); outcome recorded in change notes. Promotion decision deferred to M3; C1 remains baseline either way. Notes-only. ~15L

## Phase 2: Core Business Logic

- [ ] 2.1 **Pure pricing chain** `src/core/quote.ts` per D2: €3 fee iff amount ≤ €300 AND corridor `ES->VE` (exact Decimal compare); `usdtEq = eurNet × usdtPerEur × (1 − convMarginPct)`; `priceVes = buyerSideUsdtVesBuyerSide × (1 − marginPct)`; margins as percent numbers (10 = 10%), converted exactly once; intermediate scale 8; single final rounding (ROUND_HALF_UP, 2 dp); `"OTHER"` corridor = total function omitting fee line. Tests (`test/core/quote.test.ts`): €300 fee present / €300.01 fee absent / OTHER no-fee-line / rounding / percent-convention regression (review F10). ~180L
- [ ] 2.2 **RED-first BAPI client** `src/adapters/binance/bapiClient.ts` + jitter wrapper `rateLimiter.ts` (randomized 0.5–2 s spacing around every outbound call): write payload tests FIRST (`test/adapters/binance/payload.test.ts`) — VES lookup separately asserts request `tradeType:"SELL"`; USDT/EUR lookup SEPARATELY asserts `tradeType:"BUY"`; no shared generic assertion. Then implement client until green. ~200L
- [ ] 2.3 **Rate service** `src/core/rateService.ts`: buyer-side lookups, NO fallback source; timeout → typed error carrying failing-source identity. Tests with recorded fixtures + simulated timeout (`test/core/rateService.test.ts`). ~120L
- [ ] 2.4 **Classifier criteria pinning (review F9)** — BEFORE parser implementation: freeze accept/reject rules (sender address, subject markers, mandatory fields amount/reference/orderId) in `docs/email-classifier-rules.md`; collect real Binance paid-email samples from Kelly's mailbox (M1 setup; synthetic fixtures acceptable interim, marked TODO). Freeze fixture set in `test/fixtures/gmail/`. Gate for 2.5. ~60L
- [ ] 2.5 **Email classifier + parser** `src/adapters/gmail/parsePaidEmail.ts`: classify `payment_paid | ignorable | anomaly` strictly per 2.4 rules; extract PaidEvent fields. Tests: one per frozen fixture; malformed fixture → `anomaly`, never partial event (`test/adapters/gmail/parsePaidEmail.test.ts`). ~140L
- [ ] 2.6 **Gmail poller** `src/adapters/gmail/gmailPoller.ts` implementing `PaymentEventSource` (C1): 45 s loop (env-tunable), `messages.list(q:"from:binance.com newer_than:1d")`, fetch unseen `format=full`, dedupe claim `insert-pending → send → mark-sent`. Integration tests (`test/integration/delivery.test.ts`): steady-state repeat poll ⇒ no second alert; simulated crash between send and mark-sent ⇒ exactly-one recovery redelivery, never silent loss. ~200L
- [ ] 2.7 **Retry/backoff sweeper**: retries `pending` rows every 30 s, exponential backoff capped 10 min, after 5 failed attempts escalates via `developerAlert`; constants from env (task 1.2), never literals. Integration test: persistent send failure ⇒ escalation observed (`test/integration/backoff.test.ts`). ~120L

## Phase 3: Platform — Access, Config, Notifications

- [ ] 3.1 **Notification channels** `src/core/developerAlerts.ts` + `src/core/clientNotice.ts`: both callable outside any request context; developer alerts → `DEVELOPER_CHAT_ID`; client notices → calm Spanish copyKey lookup. Tests with fake Telegram API (`test/core/notifications.test.ts`). ~80L
- [ ] 3.2 **Token-expiry path**: Gmail auth failure ⇒ immediate `developerAlert` AND `clientNotice(chatId, "service_unavailable")`. Integration test asserts BOTH delivered (`test/integration/token-expiry.test.ts`). ~60L
- [ ] 3.3 **accessGuard** `src/core/accessGuard.ts`: checks `from.id` (never chat.id) for BOTH commands and `callback_query`; non-allowlisted ⇒ no logic executes, no capability disclosure, rejection audited. Tests: denied command, denied forwarded-button press, authorized pass-through (`test/core/accessGuard.test.ts`). ~80L
- [ ] 3.4 **Onboarding `/start`** `src/transport/handlers/start.ts`: guided welcome, plain-language Spanish, inline buttons for rates/quotes/alerts/settings; `onboarded_at` persisted. Test: first-contact flow renders four capability buttons (`test/transport/start.test.ts`). ~90L
- [ ] 3.5 **`/config` self-service** `src/transport/handlers/config.ts`: inline-button margin-tier selection persists to `clients.default_margin_pct`. Test: select 8% ⇒ subsequent `/tasa` and `/calculo` default to 8% (`test/transport/config.test.ts`). ~120L

## Phase 4: Transport UX & Runtime

- [ ] 4.1 **Copy + keyboards** `src/transport/copy.es.ts` (all Spanish strings isolated) + `src/transport/keyboards.ts` (inline builders). Test: keyboard shapes; copy keys resolve (`test/transport/copy.test.ts`). ~80L
- [ ] 4.2 **`/tasa` + in-place refresh** `src/transport/handlers/tasa.ts`: one comparative message (market + 10/8/7% tiers side by side); refresh ⇒ instant `answerCallbackQuery` ack, `editMessageText` in place, NEVER new message; single-flight debounce keyed by message ID coalesces rapid presses; catch+swallow `message is not modified` BadRequest; stale callbacks ignored via message-age freshness window. Tests (`test/transport/tasa.test.ts`): same-message edit; storm ⇒ coalesced/graceful; ack precedes work. ~180L
- [ ] 4.3 **`/calculo` handler** `src/transport/handlers/calculo.ts` (requires 1.7 fixture): validate positive numeric amount + ES->VE corridor; invalid/non-positive/ineligible ⇒ friendly professional-Spanish usage guidance, no calculation; valid ⇒ render quote() breakdown steps + final Bs. Tests: `/calculo 300` fee line present; `/calculo 300.01` no fee line; garbage input ⇒ guidance (`test/transport/calculo.test.ts`). ~120L
- [ ] 4.4 **Rate failure path**: timeout/unusable data ⇒ edit-in-place Spanish "Tasa no disponible, operador avisado"; NO stale or invented rate; `developerAlert` identifies failing source. Integration test (`test/integration/rate-failure.test.ts`). ~70L
- [ ] 4.5 **Alert formatter** `src/core/paymentAlertService.ts`: renders amount, reference, orderId as monospace tap-to-copy (`<code>`); NO external links to Binance. Test: content assertions + link-absence scan (`test/core/paymentAlertService.test.ts`). ~70L
- [ ] 4.6 **Runtime composition** `src/bot.ts` (grammY wiring, middleware order = accessGuard first, `bot.catch` fail-loud) + `src/index.ts` (composition root, graceful shutdown SIGTERM/SIGINT, `/healthz` HTTP endpoint reporting poller-heartbeat freshness + SQLite read probe — review F11, not bare liveness). Test: healthz returns degraded when heartbeat stale (`test/integration/healthz.test.ts`). ~130L
- [ ] 4.7 **One-time OAuth grant** `scripts/auth-gmail.ts`: installed-app flow, scope pinned `gmail.readonly`, refresh token stored encrypted via vault. Manual verify + credential-hygiene check: token absent from logs/code, read-only scope confirmed (`npm run auth:gmail`). ~70L

## Phase 5: Ops Hygiene, Docs, Milestone Gate

- [ ] 5.1 **README**: setup, env var table, systemd/Docker run model (VPS per D5), external uptime monitor on `/healthz`, and REQUIRED BotFather setup step: inline mode DISABLED (documents the allowlist-bypass prevention from design). Docs-only. ~80L
- [ ] 5.2 **Key-rotation runbook (review F12)** `docs/ops-runbook.md`: ENCRYPTION_KEY rotation procedure (decrypt `vault` rows under old key, re-encrypt under new, atomic swap, verify). Docs-only. ~70L
- [ ] 5.3 **Pruning policy + sweeper (review F12)**: documented >90-day retention for `processed_messages`/`parse_anomalies` in ops runbook + scheduled prune in poller loop. Test: old rows pruned, recent kept (`test/integration/prune.test.ts`). ~50L
- [ ] 5.4 **M1 DOGFOOD GATE** (manual, Gabri's chat ID) — execute and record pass/fail per item in change notes: (a) `/tasa` comparative view renders; (b) `/calculo 300` shows fee; (c) `/calculo 300.01` no fee line; (d) ineligible-corridor input ⇒ Spanish guidance; (e) real paid-email alert arrives <60 s (measure actual latency); (f) FAILURE DRILL: cut network ⇒ Spanish error shown AND developer alert received; (g) demo video recorded. Exit: all items pass + video exists. 0L code

## Traceability Matrix (spec scenario → tasks)

| Spec scenario | Tasks | Status |
|---|---|---|
| rate-query: happy path comparison | 4.2, 2.3 | covered |
| rate-query: correct book side (SELL) | 2.2 (RED) | covered |
| rate-query: refresh updates same message | 4.2 | covered |
| rate-query: rapid repeated presses | 4.2, 2.2 | covered |
| rate-query: fee boundary €300 | 2.1, 4.3 | covered |
| rate-query: above threshold €300.01 | 2.1, 4.3 | covered |
| rate-query: fee-ineligible corridor | 2.1, 4.3 | covered |
| rate-query: invalid input guidance | 4.3 | covered |
| rate-query: endpoint timeout | 4.4, 2.3 | covered |
| payment-alert: timely delivery <60 s | 2.6, 5.4(e) | covered |
| payment-alert: complete parsed alert | 2.5, 4.5 | covered |
| payment-alert: malformed body → anomaly | 2.4, 2.5 | covered |
| payment-alert: steady-state duplicate none | 2.6 | covered |
| payment-alert: crash-recovery redelivery | 2.6 | covered |
| payment-alert: persistent failure escalates | 2.7 | covered |
| payment-alert: credential hygiene | 1.4, 1.5, 4.7 | covered |
| access: unauthorized rejected + audited | 3.3, 1.6 | covered |
| access: authorized owner served | 3.3 | covered |
| access: first contact onboarding | 3.4 | covered |
| access: change default margin | 3.5 | covered |
| access: slow work behind button (instant ack) | 4.2, 4.1 | covered |
| access: token expiry dual notify | 3.2 | covered |
| access: log inspection (no secrets, audit) | 1.5, 1.6 | covered |

Uncovered scenarios: none — no blocked items.

## Conventions honored (openspec/config.yaml)

Phases + hierarchical numbering; each task one-session sized; all Binance knowledge confined to `src/adapters/binance/*`; zero hardcoded client data (all client state in SQLite via `/config`); fail-loud alerts on every endpoint/auth failure; secrets only via AES-GCM vault; code/comments/docs in English, bot-facing copy in neutral professional Spanish (`copy.es.ts` isolated).
