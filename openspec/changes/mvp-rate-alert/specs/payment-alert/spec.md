# Payment Alert Specification

## Purpose

Near-real-time Telegram notification to Kelly when a buyer marks a P2P order as paid, detected by read-only polling of her Gmail for Binance notification emails (baseline path C1). Alerts are informative only — she verifies payment at the counter before releasing, as she does today.

## Requirements

### Requirement: Polling Latency Target

The system MUST poll the connected mailbox in read-only mode such that a paid-notification email produces a Telegram alert within 60 seconds of arrival under normal operation.

#### Scenario: Timely delivery

- GIVEN Kelly's Gmail is connected via read-only OAuth
- WHEN Binance delivers a "buyer marked as paid" email
- THEN Kelly receives the corresponding Telegram alert within 60 seconds

### Requirement: Alert Content

Each alert MUST present: the paid amount, the payment reference, and the order number rendered as a tap-to-copy monospace element. Alerts MUST be informative only: they MUST NOT contain external links to Binance or attempt deep-links.

#### Scenario: Complete parsed alert

- GIVEN a paid-email parses successfully (amount + reference + order id extracted)
- WHEN the alert is delivered
- THEN it shows amount, reference, and the monospace tap-to-copy order number
- AND the message contains no clickable link into Binance

### Requirement: Parse Failure Safety

If an email from the Binance sender cannot be parsed or has unexpected structure, the system MUST NOT deliver a partial or fabricated alert. It MUST record the event safely and SHOULD notify the developer for diagnosis instead of silently dropping it.

#### Scenario: Malformed email body

- GIVEN an email from the monitored sender lacks expected fields
- WHEN the parser processes it
- THEN no user-facing alert is sent
- AND the anomaly is recorded and surfaced to the developer

### Requirement: At-Least-Once Delivery

(Previously: "Exactly-One Delivery" — claimed a strictly-once guarantee that crash recovery cannot honor.)

The system MUST NOT silently drop a detected paid-order alert; it MAY redeliver only after crash/restart recovery; steady-state duplicates MUST NOT occur. Polling cycles MAY observe the same email repeatedly, and the system MUST deliver at least one alert per distinct paid-order event. Persistent delivery failure MUST escalate to the developer instead of stalling indefinitely or dropping the event.

#### Scenario: Duplicate poll cycle in steady state

- GIVEN an alert was already delivered and recorded for order X
- WHEN later polls encounter order X's email again
- THEN no second alert is produced

#### Scenario: Crash-recovery redelivery

- GIVEN the process crashed after sending the alert for order Y but before recording it as sent
- WHEN the recovery sweep replays order Y after restart
- THEN order Y MAY be alerted again — an accepted at-least-once duplicate — and is then recorded as sent
- AND order Y is never silently lost

#### Scenario: Persistent delivery failure escalates

- GIVEN sending the alert for order Z keeps failing across retry attempts
- WHEN exponential-backoff retries exhaust their cap
- THEN the developer receives an escalation alert rather than the event being dropped or stalled

### Requirement: Access & Credential Containment

Alerts MUST only be delivered to allowlisted chats (see bot-access-config). Mailbox access MUST remain read-only OAuth scope; credentials MUST be stored encrypted and never logged or persisted in plaintext.

#### Scenario: Credential hygiene check

- GIVEN the Gmail OAuth token is stored by the system
- THEN it is encrypted at rest and absent from logs and code
- AND the granted scope is read-only (no send/delete permissions)
