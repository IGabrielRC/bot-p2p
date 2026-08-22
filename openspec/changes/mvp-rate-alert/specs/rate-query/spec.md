# Rate Query Specification

## Purpose

On-demand pricing for Kelly's counter operation: the live buyer-side USDT/VES Binance P2P rate with her margin prices compared side by side (`/tasa`), plus a separate full-chain client quotation command (`/calculo`). Greenfield capability — no prior spec exists.

## Requirements

### Requirement: Comparative Rate View

The `/tasa` command MUST reply with a single comparative view containing: the current market USDT/VES rate sourced from the buyer-side P2P book, and the client sale price for each configured margin tier (default tiers: 10%, 8%, 7%) displayed side by side.

#### Scenario: Happy path comparison

- GIVEN the rate source is reachable and returns valid data
- WHEN Kelly sends `/tasa`
- THEN one message shows the market rate plus the 10%, 8%, and 7% margin prices together

### Requirement: Buyer-Side Book Semantics

Rate lookups MUST resolve the buyer-side book — the prices buyers pay for USDT in VES (BAPI search contract: `tradeType=SELL`). Using the opposite book side is a defect even if results look plausible.

#### Scenario: Correct book side queried

- GIVEN any rate lookup executes against the BAPI search endpoint
- THEN the request targets the buyer-side book (`tradeType=SELL`)
- AND the displayed market rate reflects what buyers pay, not seller ads

### Requirement: In-Place Refresh

The rate view MUST include an inline-keyboard refresh control. Pressing it MUST acknowledge the callback instantly, fetch fresh data, and EDIT the existing message in place — never send a new message.

#### Scenario: Refresh updates same message

- GIVEN a rate card is displayed
- WHEN Kelly presses refresh
- THEN she gets an instant callback acknowledgment
- AND that same message updates in place with newly fetched data; no second message appears

#### Scenario: Rapid repeated presses

- GIVEN Kelly presses refresh or re-sends `/tasa` several times quickly
- THEN the bot responds gracefully without error spam
- AND upstream requests are spaced with randomized delays so traffic stays pattern-free

### Requirement: Quotation Command

`/calculo <amount>` MUST apply the full pricing chain independently of `/tasa`: (1) €3 flat fee ONLY when transfer ≤ €300 AND corridor is Spain→Venezuela; (2) EUR→USDT conversion margin (~13–14%); (3) selected/configured margin over the Binance buyer-side rate. The reply MUST show a step-by-step breakdown ending in the final bolívar amount.

#### Scenario: Fee boundary at exactly €300

- GIVEN corridor Spain→Venezuela
- WHEN Kelly runs `/calculo 300`
- THEN the €3 fee IS included in the quote breakdown

#### Scenario: Above the fee threshold

- GIVEN corridor Spain→Venezuela
- WHEN Kelly runs `/calculo 300.01`
- THEN no fee line appears in the breakdown

#### Scenario: Fee-ineligible corridor

- GIVEN a corridor other than Spain→Venezuela and amount ≤ €300
- WHEN `/calculo <amount>` runs
- THEN the €3 fee is NOT applied

#### Scenario: Invalid input

- WHEN Kelly sends `/calculo` without a valid positive numeric amount
- THEN the bot replies with friendly professional-Spanish usage guidance (e.g., "Escribe el monto en euros, por ejemplo: /calculo 250") and performs no calculation

### Requirement: Rate Failure Without Fallback

If the rate source fails, times out, or returns unusable data, the system MUST NOT fall back to another source in MVP. It MUST reply (or edit) with a clear professional-Spanish error (e.g., "Tasa no disponible, operador avisado") AND immediately alert the developer.

#### Scenario: Endpoint timeout

- GIVEN the rate endpoint does not respond within the configured timeout
- WHEN a rate lookup is attempted
- THEN the user sees the Spanish unavailability message and NO stale or invented rate
- AND the developer receives an alert identifying the failing source

## Notes

- Quoted strings are UI-copy examples (neutral professional Spanish), not copy contracts.
- Margin tiers and default margin are owned by `/config` (see bot-access-config).
