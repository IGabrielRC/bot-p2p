# Project Brief — Binance P2P Seller Assistant Bot (Telegram)

> **Purpose of this document:** complete, self-contained context to start development in a fresh repository/session. Generated during an idea-organization/feasibility session on 2026-08-21. The single success criterion of this product: **solve the end client's operational pain — nothing else.**

---

## 1. Summary

A Telegram bot that assists a Venezuelan crypto seller (owner of a **casa de cambio**) in her daily operation of selling USDT for bolívares (Bs) on **Binance P2P**:

- **Phase 1 (MVP):** on-demand exchange-rate queries + automatic Telegram alerts when a buyer marks an order as paid.
- **Phase 2:** post/update her P2P sell ad automatically from a command (`/vender 300`), using Binance's native **floating price** (market rate + margin %).
- **Phase 3 (optional, deferred):** release-crypto-by-command after she verifies the bank deposit manually. Explicitly NOT recommended until months of proven operation, if ever.

All interaction happens through **Telegram** (single channel decision — see §7).

## 2. Client & Business Context

> ✏️ **Corrected against the client's own voice notes** (`conversaciones/transcripts/`, recorded 2026-08-16).

- **End client:** Kelly ("Cambios Doli" / "Drolicambio"). Venezuelan, but she **operates from Spain**: clients send EUR from Spain and she pays bolívares into Venezuelan bank accounts.
- **Business model:** EUR-in (Spain) → Bs-out (Venezuela), priced off the Binance P2P rate plus her own margins. Binance P2P serves both as pricing reference and as the EUR→USDT conversion layer.
- **Revenue model — 3 redundant channels (from WA0028):**
  1. Flat **€3 fee**, only when: transfer ≤ €300 AND Spain→Venezuela.
  2. Margin over Binance sell rate: **10% default, 8% or 7% depending on market**.
  3. ~**13–14% margin** converting EUR→USDT.
  She cannot lose money on a transaction unless all three fail simultaneously.
- **Operation profile (WA0024):** days 1–20 of month ≈ 8–10 transactions/day (peak days Mon/Wed/Sat); days 20–1 slow (her clients are paid monthly). No fixed min/max ticket size.
- **Sell-focused:** buying side is rare; the product only needs the SELL side.
- **Explicitly out of the client's ask:** Instagram automation for her lingerie shop — agreed she solves it with IG native auto-messages (WA0152/WA0168).
- **Direct developer/stakeholder:** the user of this brief (product owner), who serves the client.

## 3. Problem Statement — The Pains to Solve

| # | Pain | Solution module |
|---|------|-----------------|
| 1 | She checks the P2P rate constantly all day before deciding how much to sell | **Module A** — rate on demand via Telegram |
| 2 | Posting/updating the sell order manually every time is tedious and repeated many times a day | **Module B** — `/vender <amount>` posts/updates the ad automatically |
| 3 | Finding out late that a buyer already paid slows down the whole counter operation | **Module C** — instant Telegram alert when buyer marks payment sent |

> 🎙️ **Voice-note evidence (2026-08-16):** pains #1 and #2 are explicitly confirmed in Kelly's own words — pain #2 is her strongest ("montar la orden ladillosa… con el P2P resuelto ya me quito todo el peso de encima", WA0152). Pain #3 was never voiced; it stays in MVP by product decision (cheap, zero-risk, high value).

**North star:** every design decision must reduce HER friction at the counter. No features beyond that.

## 4. Scope & Phases

### Phase 1 — MVP (no Binance credentials required) — **CONFIRMED SCOPE 2026-08-22**
- **A. Rate on demand:** user asks (`/tasa`), bot replies with current Binance P2P sell-side rate for USDT/VES (+ suggested sale price given her configured margin).
- **UX requirement (product decision):** all chat interactions use **Telegram inline keyboard buttons** so the bot is intuitive for a non-technical user. Example flow for `/tasa`: rate shown → buttons to pick margin (10 / 8 / 7 %) → bot replies with final client prices (+ €3 fee rule applied).
- **C. Payment-received alert:** when a buyer marks an order as paid, she gets a Telegram message (amount, reference, order info). *(Note: this pain was never voiced in the 6 voice notes — kept in MVP by product decision as low-risk high-value.)*
  - Recommended detection path **without touching her Binance account**: parse Binance transactional emails (buyer-paid notifications) via **Gmail OAuth read-only access** (official, revocable Google permission). Alternative (later): polling Binance order status with a session token.
- Infrastructure proof: bot hosting, per-client config storage, error alerting to the developer.
- **Delivery strategy:** demo A + C live to the client FIRST; pitch Phase 2 only after she is using and trusting the bot. Her strongest voiced pain is P2P order posting (WA0152/WA0168), which makes Phase 2 an easy sell once trust exists.

### Phase 2 — Auto-posting the sell ad (requires client's explicit consent)
- Command `/vender <amount>` → bot creates/updates her P2P sell ad with:
  - amount/limits derived from `<amount>`
  - her configured receiving bank account(s)
  - **native floating pricing** (market rate + margin %) so the price self-adjusts all day — kills pain #1 with zero gray zone
- **Requires:** her Binance session token (encrypted storage), acting ONLY on her explicit commands (never autonomous).
- **Blocked on:** client accepting session/token handover (see §10).

### Phase 3 — Release by command (optional, last)
- After she verifies the fiat arrived in her bank, a command would release the crypto, behind double confirmation.
- **Default recommendation: keep release MANUAL in the Binance app indefinitely.** Automating it means handling her 2FA and creates the highest-stakes failure mode (releasing USDT without having received Bs).

## 5. Feasibility & Risk Register (verified during exploration)

| Module | Feasible? | Risk | Notes |
|--------|-----------|------|-------|
| A. Rate | ✅ 100% | 🟢 Near zero | Public P2P market-data endpoints (same ones the Binance web frontend uses); no credentials involved |
| C. Payment alert | ✅ Yes | 🟢 Low | Gmail OAuth route needs no Binance session; official & revocable |
| B. Auto-post ad | ✅ Yes (commercially proven — see Silver5 AI) | 🟡 Medium | Uses undocumented internal Binance endpoints authenticated with HER session → ToS gray zone; token expiry (needs refresh flow); mitigate with spaced calls, stable IP, human-commanded actions only |
| D. Release by command | ⚠️ Technically yes | 🔴 High | Highest-stakes action; keep manual by default |

### Hard limits (non-negotiable realities)
1. **Binance has NO official public API for P2P.** All authenticated P2P automation runs on undocumented internal endpoints — true even for commercial vendors.
2. **Zero ban-risk cannot be guaranteed** in Phases 2–3; risk is minimized (low call frequency, IP stability, only user-commanded actions, instant revocation).
3. **No autonomous release ever.** The fiat-verification step stays human.
4. **This is a maintained product, not build-and-forget.** Internal endpoints can change without notice; the system MUST detect failures and alert the developer immediately (silent breakage is unacceptable). Commercial precedent: silver5ai.com sells this exact automation as a subscription precisely because it requires continuous maintenance.

### Security requirements (from day 1)
- Session tokens stored **encrypted**; designed for N clients (multi-tenant-ready vault), never plaintext, never in code.
- Instant revocation story: changing her Binance password kills all active sessions including ours — communicate this to the client to build trust.
- Bot responds ONLY to authorized Telegram user IDs (per-client allowlist).
- Audit log of every authenticated action (who/what/when).

## 6. Architecture Guidelines

Multi-tenant SaaS is the long-term goal → build **multi-tenant-READY** now, without building multi-tenant FEATURES:

1. **Zero hardcoded client data.** Per-client configuration lives in storage (Telegram chat ID, bank accounts, margin %, session tokens, language). New client = new config row, zero code changes.
2. **Clean layered separation:** `Telegram transport ↔ business logic ↔ Binance adapter`. Transport is swappable (WhatsApp/web later if ever needed).
3. **Binance adapter isolates all gray-zone knowledge** (internal endpoints, auth, retry/rate policies) in ONE module.
4. **Per-client rate limiting, randomized** — multiple tenants must never form detectable traffic patterns against Binance.
5. **Fail loudly:** any endpoint failure / auth expiry sends an immediate developer alert AND a friendly client-facing message ("temporarily unavailable, the operator was notified").

Suggested minimal stack shape (team may adjust):
- Runtime with first-class async + Telegram SDK maturity (Node.js/TypeScript or Python).
- SQLite/Postgres for config + audit log; OS keyring or AES-GCM envelope encryption for secrets.
- Long-lived process (VPS) or serverless functions + scheduler for polling jobs.

## 7. Channel Decision

**Telegram only.** Rationale: official free Bot API, instant setup, no approvals. WhatsApp was evaluated and rejected (Meta Business API bureaucracy, dedicated number, per-conversation costs, unofficial-API ban risk).

Bot user-facing copy (commands, alerts, errors) must be in **neutral professional Spanish** — the end client is Venezuelan. Internal code/comments/docs in English.

## 8. Business Model Constraints

- Sold as a **monthly retainer/subscription** — justified by the inherent maintenance burden of unofficial endpoints (fragility = part of the subscription's value proposition).
- Roadmap: single-client MVP → **multi-tenant SaaS (20–30 casas de cambio / P2P sellers)** reusing the same core.

## 9. Out of Scope (explicit)

- ❌ Centralized chat inbox / team support features (client never asked; rejected).
- ❌ Buying-side automation (operation is sell-focused).
- ❌ Autonomous release of crypto without human verification.
- ❌ WhatsApp channel (for now).
- ❌ Fully autonomous ad repositioning/price-chasing bots (only user-commanded actions in Phase 2).

## 10. Open Decisions Pending

| Decision | Owner | Status |
|----------|-------|--------|
| Client consents to providing Binance session token (unblocks Phase 2) | End client | **Pending** — pitch: encrypted storage + revocable anytime via password change |
| Exact banks/payment methods to configure for receiving Bs | End client | Pending |
| Margin % over market rate for suggested/floating price | End client | Pending |
| Hosting choice (cheap VPS vs serverless) | Developer | Pending |

## 11. Suggested Next Steps (fresh development session)

1. Create the new project repository/folder; copy this brief into it (e.g., `docs/PROJECT_BRIEF.md`) as seed context.
2. Initialize the project with the preferred stack; set up Telegram bot via @BotFather (dev/test bot first).
3. Implement Module A against Binance's public P2P market-data endpoint (rate for USDT/VES sell side) — fastest visible win.
4. Implement Module C via Gmail OAuth (read-only, label/filter on Binance notification emails) → forward parsed alerts to Telegram.
5. Add fail-loud monitoring + per-client config storage before adding any authenticated Binance call.
6. Phase 2 starts only after the client signs off on the token-handling explanation.

---

*Reference competitor studied during exploration: https://silver5ai.com — commercial SaaS proving full-cycle Binance P2P automation is viable at scale (positioning bot, order management, notifications, bank integration incl. Venezuela).*
