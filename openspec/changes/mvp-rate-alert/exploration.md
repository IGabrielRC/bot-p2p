# Exploration — mvp-rate-alert

> Phase: sdd-explore · Date: 2026-08-22 · Mode: hybrid
> Question: is MVP Modules A + C (rate on demand + payment alert, inline-keyboard UX) technically viable with near-zero risk and no Binance credentials?

## Verdict

✅ **Viable.** Module A has multiple working no-auth data sources verified in 2026. Module C has two independent implementation paths. No session tokens needed anywhere in this scope. Main risk is undocumented-endpoint drift, mitigated by adapter isolation + fail-loud monitoring (already mandated in `openspec/config.yaml`).

## Module A — Rate on demand

### Data sources (verified)

| # | Source | Auth | Notes |
|---|--------|------|-------|
| 1 | `POST https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search` | None | Classic frontend endpoint; alive in 2026 (parse.bot health check verified days ago; autop2p.dev documents it as "most queried"). JSON body: `{asset, fiat, tradeType, page, rows, payTypes, ...}` |
| 2 | `GET https://www.binance.com/bapi/c2c/v1/public/c2c/agent/quote-price?fiat=&asset=&tradeType=` | None | Simpler quick-quote endpoint published in Binance's own P2P skill docs (binance.com/en/skills/detail/binance/p2p) |
| 3 | `GET https://www.usdt.com.ve/api/v1/rates/current` | None | Free, CORS-enabled, 5-min refresh; median of top verified-seller VES offers from Binance + Bybit (+ BCV). Good secondary/fallback |
| 4 | Cotizave `GET https://api.cotizave.com/v1/fx/rates` | Free API key | 1,500 req/month free; 7 exchanges; bid/ask/mid per market. Commercial-grade fallback |

### Critical semantic gotcha (documented, must reach spec/design)

In BAPI search, **`tradeType` is from the searcher's perspective**: `tradeType=BUY` ("I want to buy") returns **SELL ads**; `tradeType=SELL` returns **BUY ads** (the prices buyers pay). Kelly sells USDT → her reference rate is the **buyer-side book**, i.e. `tradeType=SELL`. Source: autop2p.dev/api/reference/market-data.

### Business rules to encode (from client's own words, WA0024/WA0028)

- Price shown = market rate − margin (10% default; 8% or 7% depending on market conditions — configurable per query).
- €3 flat fee applies ONLY when: transfer ≤ €300 AND Spain→Venezuela.
- Configurable fiat pair (VES primary; EUR conversion margin ~13–14% tracked separately).

## Module C — Payment-received alert

| Path | Mechanism | Credentials | Assessment |
|------|-----------|-------------|------------|
| C1: Gmail OAuth | Read-only scope `gmail.readonly`; poll `messages.list` filtered `from:binance` (buyer-paid notification emails); parse amount/reference/order id | Google OAuth token (revocable) | Stable, documented Google API; brief §4 recommends it. Poll interval tradeoff (latency vs quota) |
| C2: Binance SAPI C2C | Signed HMAC requests with a **standard read-only API key** (`api.binance.com/sapi/v1/c2c/*`) — NOT a session-token hijack | Official API key/secret | ⚠️ Promising but UNVERIFIED for live order-status changes (historically exposes trade history; autop2p claims 44 c2c endpoints exist vs 1 officially documented). Verify exact endpoint + fields during design before betting on it |

**Open question for design phase:** if C2 works with an official read-only API key, it beats email parsing in robustness. Keep C1 as baseline plan, C2 as upgrade candidate. Do NOT block MVP on this decision.

## Telegram UX (Module A + alert delivery)

- Inline keyboards: official Bot API `InlineKeyboardMarkup` / callback queries (core.telegram.org/bots/api#inlinekeyboardmarkup). Mature wrappers: grammY (TS) and aiogram/python-telegram-bot (Python).
- Long polling is sufficient for MVP volume (single client); webhook adds TLS/domain requirements for zero latency benefit at 8–10 ops/day.

## Stack comparison (decision deferred to proposal)

| Criterion | Node.js + TypeScript (grammY) | Python (aiogram 3) |
|-----------|-------------------------------|--------------------|
| Inline keyboard DX | Excellent, TS-first framework | Excellent |
| Type safety end-to-end | Strong | Optional (pydantic) |
| Deploy footprint | Single container | Single container |
| Ecosystem for future Phase 2 (session automation) | Playwright/puppeteer available | playwright available |

Both fully capable. Decision inputs: developer familiarity, hosting preference, long-term multi-tenant ambitions.

## Risks

1. 🟠 Undocumented endpoints can change without notice → adapter module + multi-source fallback chain + developer alerting (fail-loud) is mandatory, not optional.
2. 🟡 Cloudflare/IP blocking on high-frequency calls → MVP needs ~1 call per `/tasa` press (trivially low); add per-client randomized spacing now to be multi-tenant-ready.
3. 🟡 C2 (SAPI) unverified for live status → keep C1 baseline.
4. 🟢 Rate math errors (margin/fee rules) → encode business rules in pure functions with tests once stack lands.

## Sources

- https://autop2p.dev/api/reference/market-data/ — BAPI search endpoint, tradeType semantics, rate-limit layers
- https://www.binance.com/en/skills/detail/binance/p2p — MGS agent public endpoints (quote-price, ad-list, trade-methods)
- https://stackoverflow.com/a/71872412 — BAPI request body shape (community-verified)
- https://www.usdt.com.ve/datos + /api — free USDT/VES current-rate API + methodology (median of verified-seller offers)
- https://cotizave.com/api-tasas-venezuela — free-tier multi-exchange VES rates API
- https://core.telegram.org/bots/api#inlinekeyboardmarkup — inline keyboard contract
- conversaciones/transcripts/*.txt — business rules and pain evidence (WA0024, WA0028)
