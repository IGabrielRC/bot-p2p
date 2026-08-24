# Kelly's P2P seller assistant for Telegram

This bot helps Kelly, a Venezuelan P2P seller operating from Spain, price EUR-to-Bs transactions faster and avoid missing buyer payments while selling USDT on Binance P2P. The MVP puts a live rate, quotation math, and payment alerts in a familiar Telegram chat with inline-keyboard buttons, reducing the repeated manual checks at her counter.

## Quick path

Run the validation spike locally:

```bash
npm install --prefix demo
copy demo\.env.example demo\.env
```

Open `demo/.env` and set the two values below. Use a real bot token locally, but never commit the file.

```dotenv
BOT_TOKEN=your-telegram-bot-token
ALLOWED_CHAT_ID=your-telegram-chat-id
```

Start the bot:

```bash
npm start --prefix demo
```

In Telegram, open the bot and test:

1. `/tasa` — show the current USDT/VES reference rate and margin buttons.
2. `/calculo 300` — show the quotation breakdown, including the €3 fee boundary.
3. `/calculo 400` — confirm the quote without the €3 fee.

If you do not know your chat ID yet, leave `ALLOWED_CHAT_ID` empty for the first run, send the bot a message, copy the ID printed in the console, then restart it with the ID configured. See the full [demo run guide and video script](demo/README.md).

## Details

| Topic | Current decision |
|---|---|
| Product scope | Phase 1: on-demand rate and quotation flow (A), plus payment-received alerts (C). Phase 2 order posting is deliberately deferred until Kelly trusts the bot. Crypto release remains manual. |
| Stack | Node.js 22 runtime with [grammY](https://grammy.dev/) for Telegram. The spike lives in `demo/` and is explicitly not production code. |
| Rate source | Primary: Binance P2P BAPI v2 `friendly/c2c/adv/search`, queried for USDT/VES with the buyer-side reference (`tradeType=SELL`) and averaged across live ads. Fallback: `usdt.com.ve` when Binance is unavailable. If both fail, the bot shows an error rather than inventing a rate. |
| Pricing tiers | **$50/month** Essential (rate and quotes); **$70/month** With Alerts (adds payment notifications); **~$99/month** Pro (adds user-commanded order posting). See the [pricing ladder](docs/pricing-tiers.md). |
| Deployment | Hetzner VPS through EasyPanel. The health server listens on `PORT` (default `3000`) and responds at `/health`. EasyPanel Build Path: `/demo`; Dockerfile: `demo/Dockerfile`. |
| Environment | `BOT_TOKEN` — Telegram BotFather token. `ALLOWED_CHAT_ID` — comma-separated authorized Telegram chat IDs. `PORT` — optional health-server port; defaults to `3000`. Start from [`demo/.env.example`](demo/.env.example). |

### Business rules in the spike

- Default margin: 10%; alternative buttons: 8% and 7%.
- The €3 flat fee applies only to Spain-to-Venezuela transfers of up to €300.
- The quote also models Kelly's EUR-to-USDT conversion margin.
- User-facing bot copy is neutral professional Spanish; internal documentation and code remain in English.

## Checklist

- [ ] Create a test bot with [@BotFather](https://t.me/BotFather).
- [ ] Copy `demo/.env.example` to `demo/.env` and add local credentials.
- [ ] Set `ALLOWED_CHAT_ID` before sharing or deploying the bot.
- [ ] Verify `/tasa`, `/calculo 300`, and `/calculo 400` in Telegram.
- [ ] Check `http://localhost:3000/health` while the process is running.
- [ ] Do not add Binance session credentials to the Phase 1 demo.

## Next step

Use the [demo guide](demo/README.md) to record the five-step validation video for Kelly. After adoption, continue with the MVP rate-and-alert implementation; pitch automated order posting only as the separate Phase 2 step.
