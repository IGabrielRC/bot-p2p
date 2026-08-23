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

// Business rules (source of truth: client's own voice notes WA0024/WA0028 +
// owner correction 2026-08-23). Kelly quotes clients at 1 EUR ≈ 1 USDT parity:
// the ~13-14% EUR->USDT conversion edge is HER internal arbitrage when
// restocking, NEVER part of the client-facing quote.
const FEE_EUR = 3;
const FEE_THRESHOLD = 300; // inclusive
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
// v2 endpoint (p2p.binance.com) verified live 2026-08-23; the legacy
// bapi.binance.com v1 path is WAF-blocked from some egress networks.
const BAPI_URL = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";
const VES_LEG = { page: 1, rows: 20, asset: "USDT", fiat: "VES", tradeType: "SELL", payTypes: [], publisherType: null };
// Restock side: tradeType=BUY returns SELL ads (what sellers ask) — her cost to replenish.
const VES_BUY_LEG = { page: 1, rows: 5, asset: "USDT", fiat: "VES", tradeType: "BUY", payTypes: [], publisherType: null };

function browserishHeaders() {
  return {
    "content-type": "application/json",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    clienttype: "web",
    lang: "en",
  };
}

async function bapiFetchAds(leg) {
  const res = await fetch(BAPI_URL, {
    method: "POST",
    headers: browserishHeaders(),
    body: JSON.stringify(leg),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`BAPI HTTP ${res.status} (${leg.fiat}/${leg.tradeType})`);
  const body = await res.json();
  if (String(body.code) !== "000000") throw new Error(`BAPI code ${body.code} (${body.message ?? "?"})`);
  return Array.isArray(body.data) ? body.data : [];
}

async function bapiBestPrice(leg, side) {
  const ads = await bapiFetchAds(leg);
  const prices = ads
    .map((ad) => Number(ad?.adv?.price))
    .filter((p) => Number.isFinite(p) && p > 0);
  if (prices.length === 0) throw new Error(`BAPI ${leg.fiat}: no parsable adv.price in ${ads.length} ads`);
  // tradeType=SELL returns BUY ads → best offer FOR HER selling is the MAX price paid.
  // tradeType=BUY  returns SELL ads → best price to restock is the MIN ask.
  return side === "max" ? Math.max(...prices) : Math.min(...prices);
}

// Kelly's buyer filter (WA0152/WA0168): pays fast, no drama, proven history.
const BUYER_MAX_PAY_MINUTES = 15;
const BUYER_MIN_FINISH_RATE = 90; // percent of completed orders
const BUYER_MIN_ORDERS = 10;
const DRAMA_WORDS = /c[eé]dula|rif\b|factura|verificaci[oó]n completa|llamada/i;

function finishRatePct(advertiser) {
  const raw = Number(advertiser?.monthFinishRate);
  if (!Number.isFinite(raw)) return null;
  return raw <= 1 ? raw * 100 : raw; // tolerate 0-1 fraction or 0-100 scale
}

async function bestBuyers() {
  const ads = await bapiFetchAds(VES_LEG);
  const buyers = ads
    .map((ad) => ({
      price: Number(ad?.adv?.price),
      payMin: Number(ad?.adv?.payTimeLimit),
      remarks: String(ad?.adv?.remarks ?? ""),
      nick: String(ad?.advertiser?.nickName ?? "comprador"),
      finish: finishRatePct(ad?.advertiser),
      orders: Number(ad?.advertiser?.monthOrderCount),
    }))
    .filter((b) => Number.isFinite(b.price) && b.price > 0)
    .sort((a, b) => b.price - a.price);

  const strict = buyers.filter(
    (b) =>
      Number.isFinite(b.payMin) && b.payMin <= BUYER_MAX_PAY_MINUTES &&
      b.finish !== null && b.finish >= BUYER_MIN_FINISH_RATE &&
      Number.isFinite(b.orders) && b.orders >= BUYER_MIN_ORDERS,
  );
  const list = strict.length > 0 ? strict : buyers.slice(0, 3);
  return { strictHit: strict.length > 0, list: list.slice(0, 3), total: buyers.length };
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
  // buy_rate ≈ what buyers pay (her sale reference); sell_rate ≈ sellers' asks (restock).
  const usdtVes = d.best?.buy_rate ?? d.binance?.buy_rate ?? d.bybit?.buy_rate;
  const restock = d.best?.sell_rate ?? d.binance?.sell_rate ?? d.bybit?.sell_rate;
  if (!Number.isFinite(usdtVes) || !Number.isFinite(restock)) {
    console.log("[rates] fallback candidates:", JSON.stringify(payload)?.slice(0, 400));
    throw new Error("usdt.com.ve: expected rate paths missing from payload");
  }
  return { usdtVes, usdtVesRestock: restock };
}

// ------------------------------------------------------ rate orchestrator ---
async function getRates() {
  try {
    const [usdtVes, usdtVesRestock] = await Promise.all([
      bapiBestPrice(VES_LEG, "max"),
      bapiBestPrice(VES_BUY_LEG, "min"),
    ]);
    const rates = { source: "bapi", usdtVes, usdtVesRestock };
    console.log(`[rates] served by BAPI: sale=${usdtVes} restock=${usdtVesRestock}`);
    return rates;
  } catch (bapiError) {
    console.error("[rates] BAPI failed, trying fallback:", bapiError.message);
  }
  const rates = { source: "alternative", ...(await fallbackRates()) };
  console.log(`[rates] served by alternative source: sale=${rates.usdtVes} restock=${rates.usdtVesRestock}`);
  return rates;
}

function footer(rates) {
  return rates.source === "alternative" ? "\n\n<i>(fuente alternativa — solo prueba)</i>" : "";
}

// ------------------------------------------------------------ text views ----
function tasaKeyboard() {
  return new InlineKeyboard().text("🔄 Actualizar", "tasa:refresh").text("🏆 Compradores", "tasa:buyers");
}

function buildTasaText(rates) {
  // Kelly's daily question (WA0024): ONE number — what buyers pay her today — plus plans.
  const lines = [
    `💱 <b>Hoy te pagan</b> <b>${fmtBs(round2HalfUp(rates.usdtVes))}</b> <i>por USDT</i>`,
    "",
    "<b>Tu precio según plan:</b>",
    ...MARGIN_TIERS.map(
      (tier) => `• Plan ${tier}% → <b>${fmtBs(round2HalfUp(rates.usdtVes * (1 - tier / 100)))}</b>`,
    ),
  ];
  return lines.join("\n") + footer(rates);
}

function calculoUsage() {
  return [
    "🧮 <b>Cómo calcular</b>",
    "Toca <b>🧮 Calcular</b> y te pregunto el monto, o escribe: <code>/calculo 300</code>",
    "Puedes indicar cualquier plan: <code>/calculo 300 8</code> o incluso <code>/calculo 250 5,5</code>.",
  ].join("\n");
}

function buildCalculoText(amountEur, rates, marginPct) {
  const steps = [];
  let net = amountEur;
  if (amountEur <= FEE_THRESHOLD) {
    net = amountEur - FEE_EUR;
    steps.push(`1️⃣ Comisión: −${fmtEur(FEE_EUR)} (aplica a montos de hasta ${fmtEur(FEE_THRESHOLD)})`);
  }
  steps.push(`2️⃣ Neto a convertir: ${fmtEur(net)} <i>(≈ ${net.toFixed(2)} USDT)</i>`);

  const market = rates.usdtVes;
  const priceVes = market * (1 - marginPct / 100);
  steps.push(`3️⃣ Plan ${marginPct}% sobre tasa de mercado (${fmtBs(round2HalfUp(market))}): ${fmtBs(round2HalfUp(priceVes))} por USDT`);

  const finalBs = round2HalfUp(net * priceVes); // single rounding point, HALF_UP
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

// Conversational /calculo flow: after tapping 🧮 Calcular we wait for a bare number.
const PENDING_AMOUNT = new Map(); // chatId -> true while awaiting the amount
const PENDING_PCT = new Map();    // chatId -> amount (EUR) while awaiting a custom margin %

function planKeyboard(amount) {
  return new InlineKeyboard()
    .text("Plan 10%", `calculo:plan:10:${amount}`)
    .text("8%", `calculo:plan:8:${amount}`)
    .text("7%", `calculo:plan:7:${amount}`)
    .text("✏️ Otro %", `calculo:custom:${amount}`);
}

async function doCalculo(ctx, amount, marginPct) {
  try {
    const rates = await getRates();
    const text = buildCalculoText(amount, rates, marginPct);
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: planKeyboard(amount) });
  } catch (error) {
    console.error("[calculo] failed:", error);
    await ctx.reply("Lo siento, hubo un problema al calcular. Intenta nuevamente en unos minutos.");
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
// Keyword matching (not emoji equality) — Telegram may alter emoji bytes.
bot.on("message:text", async (ctx, next) => {
  const t = ctx.message.text.trim();
  const chatId = ctx.chat?.id;

  // A pending custom-margin answer: a bare percentage like "5" or "10,1".
  if (PENDING_PCT.get(chatId) != null) {
    const amount = PENDING_PCT.get(chatId);
    const n = parseAmount(t);
    if (n !== null && n > 0 && n < 100) {
      PENDING_PCT.delete(chatId);
      await doCalculo(ctx, amount, n);
      return;
    }
    if (!t.startsWith("/")) {
      await ctx.reply("Escribí solo el porcentaje, por ejemplo: 5,5");
      return;
    }
    PENDING_PCT.delete(chatId); // a command cancels the pending question
  }

  // A pending amount answer: bare number like "300" or "250,50".
  if (PENDING_AMOUNT.get(chatId)) {
    const n = parseAmount(t);
    if (n !== null && n > 0 && n < 1000000) {
      PENDING_AMOUNT.delete(chatId);
      await doCalculo(ctx, n, DEFAULT_MARGIN_PCT);
      return;
    }
    if (!t.startsWith("/")) {
      await ctx.reply("Escribí solo el monto en euros, por ejemplo: 300");
      return;
    }
    PENDING_AMOUNT.delete(chatId); // a command cancels the pending question
  }

  if (/tasa/i.test(t) && !t.startsWith("/")) return sendTasa(ctx);
  if (/calcu/i.test(t) && !t.startsWith("/")) {
    PENDING_PCT.delete(chatId);
    PENDING_AMOUNT.set(chatId, true);
    await ctx.reply("🧮 ¿Cuántos euros va a enviar tu cliente? Escribime solo el monto.\n\n<i>Ejemplo: 300</i>", { parse_mode: "HTML" });
    return;
  }
  if (/ayuda|help/i.test(t) && !t.startsWith("/")) {
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
    "En las tarjetas de tasa: 🔄 refresca sin mensajes nuevos y 🏆 Compradores filtra los que pagan rápido y tienen historial limpio.",
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
  const marginPct = parts[1] != null ? parseAmount(parts[1]) : DEFAULT_MARGIN_PCT;
  if (marginPct === null || marginPct <= 0 || marginPct >= 100) {
    await ctx.reply(calculoUsage(), { parse_mode: "HTML" });
    return;
  }
  await doCalculo(ctx, amount, marginPct);
});

bot.callbackQuery("tasa:refresh", async (ctx) => {
  try {
    const rates = await getRates();
    await ctx.editMessageText(buildTasaText(rates), { reply_markup: tasaKeyboard(), parse_mode: "HTML" });
    await ctx.answerCallbackQuery("✅ Tasa actualizada"); // visible toast feedback
  } catch (error) {
    // Editing identical text is expected while cached rates have not moved yet.
    if (error instanceof GrammyError && /message is not modified/i.test(error.description ?? error.message)) {
      await ctx.answerCallbackQuery("La tasa sigue igual — está al día ✅");
      return;
    }
    console.error("[refresh] failed:", error);
    await ctx.answerCallbackQuery("❌ No pude actualizar, intenta de nuevo").catch(() => {});
  }
});

// 🏆 Buyer shortlist filtered by Kelly's own standards (fast pay, proven history).
bot.callbackQuery("tasa:buyers", async (ctx) => {
  await ctx.answerCallbackQuery("Buscando compradores…");
  try {
    const { strictHit, list, total } = await bestBuyers();
    if (list.length === 0) {
      await ctx.reply("No pude leer anuncios de compradores en este momento. Intenta más tarde.");
      return;
    }
    const rows = list.map((b, i) => {
      const drama = DRAMA_WORDS.test(b.remarks) ? " ⚠️ pide requisitos" : "";
      const finish = b.finish !== null ? `· ${Math.round(b.finish)}% ✅` : "";
      const orders = Number.isFinite(b.orders) ? ` (${b.orders} órdenes)` : "";
      const pay = Number.isFinite(b.payMin) ? `· paga en ≤${b.payMin} min` : "";
      return `${i + 1}. <b>${b.nick}</b> — ${fmtBs(round2HalfUp(b.price))} ${pay} ${finish}${orders}${drama}`;
    });
    const head = strictHit
      ? `<b>🏆 Compradores que cumplen TU filtro</b> <i>(pago ≤15 min · ≥90% completión)</i>\n\n`
      : `<b>🏆 Top compradores por precio</b> <i>(nadie cumplió el filtro estricto ahora mismo)</i>\n\n`;
    await ctx.reply(head + rows.join("\n") + `\n\n<i>${total} anuncios analizados · fuente: Binance P2P</i>`, { parse_mode: "HTML" });
  } catch (error) {
    console.error("[buyers] failed:", error);
    await ctx.reply("No pude consultar los compradores en este momento. Intenta más tarde.").catch(() => {});
  }
});

// Plan switcher on calculation cards: tap → same quote recomputed with that margin.
bot.callbackQuery(/^calculo:plan:(\d+):(\d+(?:[.,]\d+)?)$/, async (ctx) => {
  const [, pctStr, amountStr] = ctx.match;
  const marginPct = Number(pctStr);
  const amount = parseAmount(amountStr);
  if (![10, 8, 7].includes(marginPct) || amount === null || amount <= 0) {
    await ctx.answerCallbackQuery("Plan no válido");
    return;
  }
  try {
    const rates = await getRates();
    const text = buildCalculoText(amount, rates, marginPct);
    if (text === null) {
      await ctx.answerCallbackQuery("❌ Sin tasa EUR→USDT ahora mismo");
      return;
    }
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: planKeyboard(amount) });
    await ctx.answerCallbackQuery(`Recalculado con plan ${marginPct}%`);
  } catch (error) {
    if (error instanceof GrammyError && /message is not modified/i.test(error.description ?? error.message)) {
      await ctx.answerCallbackQuery("Ya está calculado con ese plan");
      return;
    }
    console.error("[plan] failed:", error);
    await ctx.answerCallbackQuery("❌ No pude recalcular").catch(() => {});
  }
});

// ✏️ Otro %: ask for a custom margin percentage conversationally.
bot.callbackQuery(/^calculo:custom:(\d+(?:[.,]\d+)?)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const amount = parseAmount(ctx.match[1]);
  if (amount === null || amount <= 0) {
    await ctx.answerCallbackQuery("Monto no válido");
    return;
  }
  PENDING_AMOUNT.delete(ctx.chat?.id);
  PENDING_PCT.set(ctx.chat?.id, amount);
  await ctx.reply(`✏️ ¿Qué porcentaje querés aplicar para ${fmtEur(amount)}? Escribime solo el número.\n\n<i>Ejemplo: 5,5</i>`, { parse_mode: "HTML" });
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
