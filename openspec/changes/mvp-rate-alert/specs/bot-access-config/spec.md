# Bot Access & Configuration Specification

## Purpose

Access control, first-use onboarding, self-service configuration, cross-cutting inline UX contract, and fail-loud operational alerting. This is the platform layer every other capability passes through.

## Requirements

### Requirement: Strict ID Allowlist

Bot access MUST be restricted to a strict Telegram-ID allowlist (MVP: Kelly only). Requests from non-allowlisted IDs MUST NOT execute commands, trigger backend actions, or reveal bot capabilities or configuration.

#### Scenario: Unauthorized user rejected

- GIVEN a Telegram ID not on the allowlist
- WHEN that user sends any command or presses any inline button
- THEN no command logic executes and no capability information is disclosed
- AND the rejected interaction is recorded in the audit trail

#### Scenario: Authorized owner served

- GIVEN Kelly's Telegram ID is on the allowlist
- WHEN she sends any supported command
- THEN the bot executes it normally

### Requirement: Guided Onboarding

On first interaction with an allowlisted user, the bot MUST present a guided welcome flow: plain-language explanation of what the bot does, with inline-keyboard buttons to explore each capability. No technical jargon.

#### Scenario: First contact

- GIVEN Kelly is allowlisted but has never interacted with the bot
- WHEN she opens the chat or sends any command
- THEN she receives the welcome message with plain-language inline buttons covering rates, quotations, alerts, and settings

### Requirement: Self-Service Configuration

The `/config` command MUST open an inline-button interface where Kelly changes her own preferences without server-side edits: default margin tier and related preferences. Changes MUST persist per client (zero hardcoded client data) and take effect on subsequent operations.

#### Scenario: Change default margin

- GIVEN Kelly opens `/config`
- WHEN she selects a different default margin (e.g., 8%)
- THEN the choice persists and subsequent quotations/rate views use it as default

### Requirement: Inline Interaction Contract

Every client-facing interaction offering an action MUST use Telegram inline keyboard buttons. Every callback MUST be acknowledged instantly, before processing completes. Whenever previously delivered content becomes outdated, the bot MUST edit its own message rather than sending a new one. Error and guidance copy MUST be friendly, neutral professional Spanish.

#### Scenario: Slow work behind a button

- GIVEN pressing a button triggers work that takes noticeable time
- WHEN the callback arrives
- THEN it is acknowledged immediately and the outcome arrives via message edit or follow-up — never silence

### Requirement: Fail-Loud Developer Alerting

Endpoint failures, auth/token expiry, and repeated parse anomalies MUST generate an immediate developer alert through a channel distinct from the client chat. The client-facing side always degrades to a friendly Spanish availability notice — silent breakage is unacceptable.

#### Scenario: Token expiry

- GIVEN the Gmail token expires or is revoked
- WHEN polling fails authentication
- THEN the developer is alerted immediately
- AND Kelly sees a calm Spanish notice (e.g., "Servicio temporalmente no disponible, ya estoy en ello"), not a stack trace

### Requirement: Secrets & Audit Hygiene

Secrets (tokens, API keys) MUST be encrypted at rest, never plaintext in code, storage, or logs. The system MUST keep an audit trail of authenticated actions (who / what / when).

#### Scenario: Log inspection

- GIVEN any log line produced during normal or failing operation
- THEN it contains no readable secret material
- AND privileged actions (config changes, access grants) appear in the audit trail with actor and timestamp

## Notes

- Quoted strings are UI-copy examples (neutral professional Spanish), not copy contracts.
