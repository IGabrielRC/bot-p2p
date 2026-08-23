# Probe Notes: mvp-rate-alert

Working log for outbound-probe tasks. Append-only; each entry records what was
attempted, what happened, and the resulting gate state. No fabricated data.

## Task 1.7 — BAPI USDT/EUR BUY smoke probe (GATE for task 4.3)

- **Date attempted**: 2026-08-22
- **Environment**: development workstation, Windows, residential ISP egress,
  Node v24.17.0 (`scripts/bapi-smoke.ts`).
- **Endpoint**: `POST https://bapi.binance.com/bapi/c2c/v1/friendly/p2p/adv/search`

### Attempts

| # | Request variant | Result |
|---|---|---|
| 1 | Plain JSON POST | HTTP **202**, empty body |
| 2 | + browser User-Agent + `clienttype: web` | HTTP **202**, empty body |
| 3 | + `x-trace-id` / `x-ui-request-trace` UUIDs + `lang` | HTTP **202**, empty body |
| 4 | Alternate hosts: `p2p.binance.com` (404 "Can not found routing"), `gapi.binance.com` (**202** empty) | unusable |

### Verdict — GATE NOT CLEARED

The empty-body `HTTP 202` pattern on every variant is Binance's silent edge/WAF
drop of this client/IP combination, not a request-shape problem. From this
machine the live response shape could NOT be observed.

Consequences:

- **No fixtures were written** (`test/fixtures/bapi/usdt-eur-buy.json`,
  `test/fixtures/bapi/usdt-ves-sell.json` do not exist). Fabricating them is
  forbidden — task 4.3 must be built against a REAL recorded shape.
- **Task 4.3 (`/calculo` handler) remains gated** until this probe succeeds.
- Usability of the USDT/EUR BUY leg (design Open Question) remains UNKNOWN.
- The pinned request contracts themselves are committed and unit-pinned
  (`src/adapters/binance/legs.ts`, `test/adapters/binance/payload.test.ts`),
  so when fixtures arrive, slice 3's client work starts from a frozen contract.

### Re-run instructions (unblock path)

1. Run from an egress Binance serves normally — most likely the production VPS
   (design D5, EU location) or any residential EU IP.
   Command: `node scripts/bapi-smoke.ts`
2. Success criteria handled by the script itself: both legs HTTP 200 with body
   code `"000000"` and non-empty ad lists → writes BOTH fixtures automatically;
   anything else exits non-zero without writing files.
3. Commit the two generated fixtures together with a usability verdict here
   (fields present, prices plausible, EUR ads exist at all), then clear the
   gate by checking task 1.7.

## Task 1.8 — Timebox A: SAPI C2C enumeration + authenticated read-only probe

- **Date attempted**: 2026-08-22 (within the 60-minute timebox)
- **Outcome: blocked-with-instructions. Notes-only per task definition.**

### Part 1 — Endpoint enumeration: BLOCKED (environment)

- `https://developers.binance.com/docs/c2c/rest-api` renders via client-side
  JS; fetch returns no usable content. This mirrors the exact failure already
  recorded in design.md (D4): "search provider down; JS-rendered".
- Web search fallback also unavailable during this window (provider 403).
- No endpoint list could be verified from official documentation today. Any
  endpoint name written here from memory would be UNVERIFIED — none is
  recorded as fact.

### Part 2 — Authenticated read-only smoke probe: BLOCKED (no credentials)

No personal Binance API key exists for this project yet; nobody provided one.
Instructions for whoever runs this later:

1. Create a key at binance.com → Profile → API Management with **read-only**
   permissions (enable reading; leave withdrawals/trading disabled).
2. Store the key/secret OUTSIDE the repo (env vars only; they are secrets and
   belong behind the same hygiene rules as `ENCRYPTION_KEY` — never logged).
3. Against the documented C2C history endpoint (verify the exact path in the
   docs once reachable), issue a signed GET (HMAC-SHA256 over the query string)
   and confirm a read-only order-history response comes back.
4. Record the outcome here. Promotion C1→C2 is decided ONLY by the M3 pilot
   criterion (live order-state change <60 s across ≥3 real transactions),
   never by this timebox — D4 keeps C1 (Gmail poller) as baseline either way.

### Standing conclusion

C1 Gmail baseline is unaffected and remains the shipping design. Timebox A
stays open as a background task for M1/M3 setup days when documentation access
and an API key are both available.
