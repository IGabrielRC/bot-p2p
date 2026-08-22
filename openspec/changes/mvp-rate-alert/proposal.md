# Proposal: mvp-rate-alert

## Intent

Kelly prices every sale off the Binance P2P rate, checked manually many times daily, and learns late when buyers mark orders paid (WA0024/WA0152; PROJECT_BRIEF §3). Ship the confirmed MVP — rate on demand (A) + payment alerts (C) — as a Telegram bot, inline-keyboard-first, demo-ready ASAP before the Phase 2 pitch.

## Scope

### In Scope
- `/tasa`: live buyer-side USDT/VES rate; comparative 10/8/7% margins; in-place refresh button.
- `/calculo <amount>`: separate quotation command with full fee chain.
- Module C: Gmail OAuth read-only polling (<1 min target) → alert, tap-to-copy order number.
- Inline-keyboard UX: instant callback acks, message editing, guided onboarding, friendly Spanish errors.
- `/config` self-service; Telegram-ID allowlist; fail-loud developer alerting.

### Out of Scope
- Module B auto-posting — deferred to post-demo pitch; flag any creep toward B.
- Module D release automation — permanently out.
- Rate-source fallback — later phase; clear error only in MVP.
- Multi-tenant features; non-Telegram channels.

## Capabilities

### New Capabilities
- `rate-query`: /tasa + /calculo flows, comparative margins, refresh, failure path.
- `payment-alert`: paid-email polling → alert delivery, copyable order id.
- `bot-access-config`: allowlist, onboarding, /config, developer alerts.

### Modified Capabilities
None — greenfield (`openspec/specs/` empty).

## Approach

Layers per brief §6: transport ↔ business logic ↔ Binance/Gmail adapters; zero hardcoded client data; secrets encrypted.
- **A**: unauthenticated BAPI search in ONE adapter. Critical: `tradeType=SELL` returns the buyer-side book Kelly sells against (exploration gotcha).
- **C**: baseline C1 = `gmail.readonly` polling `from:binance`, parsing amount/reference/order id. C2 (SAPI C2C read-only key) stays a design-time upgrade candidate.
- Failures alert the developer AND reply friendly Spanish ("Tasa no disponible, operador avisado").

## Business Rules (WA0024/WA0028)

| Rule | Value |
|------|-------|
| Margin over market | 10% default; 8%/7% by market |
| €3 flat fee | Only if ≤€300 AND Spain→Venezuela |
| EUR→USDT margin | ~13–14% |
| Reference book | Buyer side (`tradeType=SELL`) |

## Demo-First Delivery

Decision #9: first slice = minimum demonstrable — /tasa flow, end-to-end payment alert, guided onboarding, /config basics. Kelly demo precedes any Phase 2 talk.

## Affected Areas

| Area | Impact |
|------|--------|
| `src/transport`, `src/core`, `src/adapters/*`, `src/config` | New greenfield skeleton; tree fixed at design |

## Risks

- Endpoint drift breaks /tasa silently (Med) — adapter isolation + mandatory fail-loud alerts.
- Cloudflare/IP blocking (Low) — ~1 call per press, randomized spacing.
- C2 live-status unverified (Med) — C1 committed baseline.
- Quote math errors (Low) — business rules as tested pure functions.

## Rollback Plan

Feature-branch greenfield: revert commits or stop process (kill switch); config additive, no migrations; Gmail token instantly revocable; zero Binance credentials involved.

## Dependencies

BotFather token; Google OAuth app (`gmail.readonly`); hosting pending (brief §10).

## Open Questions (design)

1. Stack: Node.js/grammY vs Python/aiogram 3 — gates design/tasks.
2. Does SAPI C2C expose live order status via read-only API key?

## Success Criteria

- [ ] `/tasa`: live rate + margin buttons; refresh edits in place
- [ ] `/calculo` correct on ≤/> €300 boundary tests
- [ ] Alert <60 s after paid email; order number tap-to-copy
- [ ] Non-allowlisted IDs rejected; Kelly onboarded unaided
- [ ] Failure → Spanish error + developer alert, no fallback
- [ ] Live A+C demo delivered to Kelly
