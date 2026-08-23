// Throwaway validation spike - /tasa demo bot for Kelly.
// Plain JS ESM, no DB, no build step. Do NOT evolve this into production code.
import "dotenv/config";
import { Bot, GrammyError, InlineKeyboard } from "grammy";

// ---------------------------------------------------------------- config ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID?.trim();

if (!BOT_TOKEN) {
  console.error("Falta BOT_TOKEN (ver demo/.env).");
  process.exit(1);
}
// Discovery mode: token set but no allowlist yet -> log every sender id so the
// owner can copy his own into ALLOWED_CHAT_ID. Nobody gets a reply in this mode.
const DISCOVERY_MODE = !ALLOWED_CHAT_ID;

// Business rules (source of truth: openspec/changes/mvp-rate-alert/design.md D2).
const FEE_EUR = 3;
const FEE_THRESHOLD = 300; // inclusive
const CONV_MARGIN = 0.135; // EUR->USDT conversion margin, default 13.5%
const MARGIN_TIERS = [10, 8, 7];
const DEFAULT_MARGIN_PCT = 10;

// ----------------------------------------------------------- math helpers ---
// Half-up to 2 dp without decimal.js; tolerance absorbs float noise (e.g. 2.675*100).
function round2HalfUp(x) {
  const scaled = x * 100;
  const floored = Math.floor(scaled);
  return ((scaled - floored >= 0.499999999) ? floored + 1 : floored) / 100;
}

function fmtBs(x) {
  const [i, d] = x.toFixed(2).split(".");
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${d} Bs`;
}

function fmtEur(x) {
  return `${x.toFixed(2).replace(".", ",")} €`;
}

function parseAmount(raw) {
  const m = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(raw);
  if (!m) return null;
  return Number(`${m[1]}.${m[2] ?? "0"}`);
}

// ------------------------------------------------------- BAPI (primary) -----
// Pinned request shapes, copied verbatim from src/adapters/binance/legs.ts.
const BAPI_URL = "https://bapi.binance.com/bapi/c2c/v1/friendly/p2p/adv/search";
const VES_LEG = { page: 1, rows: 5, asset: "USDT", fiat: "VES", tradeType: "SELL", payTypes: [], publisherType: null };
const EUR_LEG = { page: 1, rows: 5, asset: "USDT", fiat: "EUR", tradeType: "BUY", payTypes: [], publisherType: null };

function browserishHeaders() {
  return {
    "content-type": "application/json",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    clienttype: "web",
    lang: "en",
  };
}

async function bapiBestPrice(leg) {
  const res = await fetch(BAPI_URL, {
    method: "POST",
    headers: browserishHeaders(),
    body: JSON.stringify(leg),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`BAPI HTTP ${res.status} (${leg.fiat}/${leg.tradeType})`);
  const body = await res.json();
  if (String(body.code) !== "000000") throw new Error(`BAPI code ${body.code} (${body.message ?? "?"})`);
  const ads = Array.isArray(body.data) ? body.data : [];
  const prices = ads
    .map((ad) => Number(ad?.adv?.price))
    .filter((p) => Number.isFinite(p) && p > 0);
  if (prices.length === 0) throw new Error(`BAPI ${leg.fiat}: no parsable adv.price in ${ads.length} ads`);
  // Buyer-side book: best price a buyer can get is the lowest ask.
  return Math.min(...prices);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "bot-p2p-demo-spike" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`);
  return res.json();
}

// --------------------------------------------- usdt.com.ve (fallback) -------
async function fallbackRates() {
  const payload = await fetchJson("https://www.usdt.com.ve/api/v1/rates/current");

  // Explicit paths verified against live payload (2026-08-23): data.best mirrors
  // the top exchange feed (binance). Generic scan kept only as last resort.
  const d = payload?.data ?? {};
  const ves = d.best?.buy_rate ?? d.binance?.buy_rate ?? d.bybit?.buy_rate;
  if (!Number.isFinite(ves)) {
    console.log("[rates] fallback candidates:", JSON.stringify(payload)?.slice(0, 400));
    throw new Error("usdt.com.ve: expected rate paths missing from payload");
  }

  // EUR leg: free FX reference (no key). USDT≈USD assumption, acceptable for a
  // validation spike; production chain derives it from BAPI USDT/EUR instead.
  let usdtPerEur = null;
  try {
    const fx = await fetchJson("https://open.er-api.com/v6/latest/EUR");
    const usdPerEur = fx?.rates?.USD;
    if (Number.isFinite(usdPerEur)) usdtPerEur = usdPerEur;
  } catch (e) {
    console.error("[rates] EUR fx source failed:", e.message);
  }
  return { usdtVes: ves, usdtPerEur };
}

// ------------------------------------------------------ rate orchestrator ---
async function getRates() {
  try {
    const [usdtVes, eurPrice] = await Promise.all([bapiBestPrice(VES_LEG), bapiBestPrice(EUR_LEG)]);
    const rates = { source: "bapi", usdtVes, usdtPerEur: 1 / eurPrice };
    console.log(`[rates] served by BAPI: usdtVes=${usdtVes} usdtPerEur=${rates.usdtPerEur}`);
    return rates;
  } catch (bapiError) {
    console.error("[rates] BAPI failed, trying fallback:", bapiError.message);
  }
  const rates = { source: "alternative", ...(await fallbackRates()) };
  console.log(`[rates] served by alternative source: usdtVes=${rates.usdtVes} usdtPerEur=${rates.usdtPerEur}`);
  return rates;
}

function footer(rates) {
  return rates.source === "alternative" ? "\n\n<i>(fuente alternativa — solo prueba)</i>" : "";
}

// ------------------------------------------------------------ text views ----
function tasaKeyboard() {
  return new InlineKeyboard().text("🔄 Actualizar", "tasa:refresh");
}

function buildTasaText(rates) {
  const lines = [
    `💱 <b>Tasa de referencia USDT/VES</b> (mercado): <b>${fmtBs(round2HalfUp(rates.usdtVes))}</b>`,
    "",
    "<b>Precio por USDT según plan:</b>",
    ...MARGIN_TIERS.map(
      (tier) => `• Plan ${tier}% → <b>${fmtBs(round2HalfUp(rates.usdtVes * (1 - tier / 100)))}</b>`,
    ),
  ];
  return lines.join("\n") + footer(rates);
}

function calculoUsage() {
  return [
    "🧮 <b>Cómo calcular</b>",
    "Escribe: <code>/calculo monto</code> — por ejemplo: <code>/calculo 300</code>",
    "Opcionalmente puedes indicar el plan: <code>/calculo 300 8</code> (planes: 10, 8 o 7).",
  ].join("\n");
}

function buildCalculoText(amountEur, rates, marginPct) {
  const steps = [];
  let net = amountEur;
  if (amountEur <= FEE_THRESHOLD) {
    net = amountEur - FEE_EUR;
    steps.push(`1️⃣ Comisión: −${fmtEur(FEE_EUR)} (aplica a montos de hasta ${fmtEur(FEE_THRESHOLD)})`);
  }
  steps.push(`2️⃣ Neto a convertir: ${fmtEur(net)}`);

  if (rates.usdtPerEur == null || !Number.isFinite(rates.usdtPerEur)) {
    return null; // caller decides the message; never invent a conversion rate
  }
  const usdtEq = net * rates.usdtPerEur * (1 - CONV_MARGIN);
  steps.push(`3️⃣ Conversión EUR→USDT (margen conversión ${(CONV_MARGIN * 100).toFixed(1)}%): ≈ ${usdtEq.toFixed(4)} USDT`);

  const market = rates.usdtVes;
  const priceVes = market * (1 - marginPct / 100);
  steps.push(`4️⃣ Margen ${marginPct}% sobre tasa de mercado (${fmtBs(round2HalfUp(market))}): ${fmtBs(round2HalfUp(priceVes))} por USDT`);

  const finalBs = round2HalfUp(usdtEq * priceVes); // single rounding point, HALF_UP
  steps.push(`✅ Total estimado: <b>${fmtBs(finalBs)}</b>`);
  return `<b>Cálculo para ${fmtEur(amountEur)}</b>\n\n${steps.join("\n")}${footer(rates)}`;
}

// -------------------------------------------------------------- bot setup ---
const bot = new Bot(BOT_TOKEN);

// Register commands so Telegram's ☰ menu button lists them.
bot.api.setMyCommands([
  { command: "start", description: "🏠 Menú principal" },
  { command: "tasa", description: "💱 Tasa del mercado y precios por plan" },
  { command: "calculo", description: "🧮 Calcular cuántos Bs recibe un cliente" },
]).catch((e) => console.error("[setup] setMyCommands failed:", e.message));

// Persistent bottom keyboard: Kelly never has to type a command.
const MAIN_KEYBOARD = {
  keyboard: [["💱 Tasa", "🧮 Calcular"], ["❓ Ayuda"]],
  resize_keyboard: true,
};

// Allowlist guard: checks from.id (never chat.id), silently ignores everyone else.
bot.use(async (ctx, next) => {
  const uid = ctx.from?.id != null ? String(ctx.from.id) : "";
  if (DISCOVERY_MODE) {
    if (uid) console.log(`[discovery] tu chat id es: ${uid} — copialo en ALLOWED_CHAT_ID (demo/.env) y reinicia`);
    return;
  }
  if (uid !== ALLOWED_CHAT_ID) {
    if (uid) console.log(`[guard] ignored user ${uid}${ctx.from?.username ? ` @${ctx.from.username}` : ""}`);
    return;
  }
  return next();
});

async function sendTasa(ctx) {
  try {
    const rates = await getRates();
    await ctx.reply(buildTasaText(rates), { reply_markup: tasaKeyboard(), parse_mode: "HTML" });
  } catch (error) {
    console.error("[tasa] rate fetch failed:", error);
    await ctx.reply("Lo siento, no pude obtener la tasa en este momento. Intenta nuevamente en unos minutos.");
  }
}

bot.command("start", async (ctx) => {
  await ctx.reply(
    [
      "Hola 👋 Soy tu asistente de tasas P2P.",
      "Te muestro la tasa actual del mercado y calculo cuántos bolívares recibirá tu cliente.",
      "",
      "Usá los botones de abajo 👇 — nunca tenés que escribir comandos.",
    ].join("\n"),
    { reply_markup: MAIN_KEYBOARD },
  );
});

// Big-button routing: reply-keyboard buttons arrive as plain text messages.
bot.on("message:text", async (ctx, next) => {
  const t = ctx.message.text.trim();
  if (t === "💱 Tasa") return sendTasa(ctx);
  if (t === "🧮 Calcular") {
    await ctx.reply(calculoUsage(), { parse_mode: "HTML" });
    return;
  }
  if (t === "❓ Ayuda") {
    await ctx.reply(ayudaHtml(), { parse_mode: "HTML" });
    return;
  }
  return next(); // commands like /tasa fall through to their handlers
});

function ayudaHtml() {
  return [
    "❓ <b>Ayuda</b>",
    "<b>💱 Tasa</b> — tasa de referencia del mercado con precios por plan.",
    "<b>🧮 Calcular</b> — te guío para calcular una operación. Ejemplo: <code>/calculo 300</code>.",
    "En las tarjetas de tasa, el botón 🔄 Actualizar refresca los valores sin enviar mensajes nuevos.",
  ].join("\n");
}

bot.command("tasa", async (ctx) => sendTasa(ctx));

bot.command("calculo", async (ctx) => {
  const parts = (ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
  const amount = parts.length >= 1 ? parseAmount(parts[0]) : null;
  if (amount === null || amount <= 0) {
    await ctx.reply(calculoUsage(), { parse_mode: "HTML" });
    return;
  }
  const marginPct = parts[1] != null ? Number(parts[1]) : DEFAULT_MARGIN_PCT;
  if (![10, 8, 7].includes(marginPct)) {
    await ctx.reply(calculoUsage(), { parse_mode: "HTML" });
    return;
  }
  try {
    const rates = await getRates();
    const text = buildCalculoText(amount, rates, marginPct);
    if (text === null) {
      await ctx.reply("No pude obtener la tasa de conversión EUR→USDT en este momento. Prueba más tarde o consulta /tasa.");
      return;
    }
    await ctx.reply(text, { parse_mode: "HTML" });
  } catch (error) {
    console.error("[calculo] failed:", error);
    await ctx.reply("Lo siento, hubo un problema al calcular. Intenta nuevamente en unos minutos.");
  }
});

bot.callbackQuery("tasa:refresh", async (ctx) => {
  await ctx.answerCallbackQuery(); // immediate ack: removes the loading animation
  try {
    const rates = await getRates();
    await ctx.editMessageText(buildTasaText(rates), { reply_markup: tasaKeyboard(), parse_mode: "HTML" });
  } catch (error) {
    // Editing with identical text is expected when rates have not moved yet.
    if (error instanceof GrammyError && /message is not modified/i.test(error.description ?? error.message)) return;
    console.error("[refresh] failed:", error);
    await ctx.reply("No pude actualizar la tasa en este momento. La tarjeta anterior sigue visible.").catch(() => {});
  }
});

bot.catch((err) => {
  console.error(`[bot] error handling update ${err.ctx?.update?.update_id}:`, err.error);
  err.ctx?.reply?.("Ocurrió un error inesperado. Por favor, intenta de nuevo.").catch(() => {});
});

bot.start();
console.log(DISCOVERY_MODE
  ? "[bot] long polling started — MODO DESCUBRIMIENTO: mandale un mensaje al bot desde Telegram y copiá tu chat id en ALLOWED_CHAT_ID"
  : `[bot] long polling started (allowlist: ${ALLOWED_CHAT_ID})`);

process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());
