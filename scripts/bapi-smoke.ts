/**
 * Unauthenticated BAPI P2P smoke probe (task 1.7 - GATE for task 4.3).
 *
 * Runs both pinned search legs against the live public endpoint and records
 * REAL response shapes as offline test fixtures:
 *
 *   node scripts/bapi-smoke.ts
 *     -> test/fixtures/bapi/usdt-eur-buy.json   (fiat=EUR, tradeType=BUY)
 *     -> test/fixtures/bapi/usdt-ves-sell.json  (fiat=VES, tradeType=SELL)
 *
 * Honesty rules:
 * - Fixtures are written ONLY when both legs return a usable payload
 *   (HTTP 200, body code "000000", non-empty ad list). A blocked or empty
 *   response exits non-zero and touches nothing - the gate stays open.
 * - Never hand-edit these fixtures to fake success; task 4.3 depends on the
 *   recorded shape being real.
 *
 * Requires Node >= 22 (runs via native TypeScript type stripping).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BAPI_P2P_SEARCH_URL,
  USDT_EUR_CONVERSION_LEG,
  USDT_VES_BUYER_SIDE_LEG,
  type P2pSearchRequest,
} from "../src/adapters/binance/legs.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(SCRIPT_DIR, "..", "test", "fixtures", "bapi");
const TIMEOUT_MS = 15_000;
const MAX_ADS_KEPT = 5;

interface ProbeOutcome {
  legName: string;
  fixturePath: string;
  request: P2pSearchRequest;
  httpStatus?: number;
  bodyCode?: string;
  adCount?: number;
  ok: boolean;
  reason?: string;
}

interface BapiSearchAd {
  adv: Record<string, unknown>;
  advertiser: Record<string, unknown>;
}

interface BapiSearchBody {
  code?: string | number;
  message?: string;
  data?: unknown;
}

function browserishHeaders(): Record<string, string> {
  const traceId = randomUUID().replaceAll("-", "");
  return {
    "content-type": "application/json",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    clienttype: "web",
    lang: "en",
    "x-trace-id": traceId,
    "x-ui-request-trace": traceId,
  };
}

function extractAds(body: BapiSearchBody): BapiSearchAd[] {
  if (!Array.isArray(body.data)) return [];
  return body.data.filter(
    (entry): entry is BapiSearchAd =>
      typeof entry === "object" &&
      entry !== null &&
      "adv" in entry &&
      "advertiser" in entry,
  );
}

async function probeLeg(legName: string, request: P2pSearchRequest, fixturePath: string): Promise<ProbeOutcome> {
  const outcome: ProbeOutcome = { legName, fixturePath, request, ok: false };
  try {
    const response = await fetch(BAPI_P2P_SEARCH_URL, {
      method: "POST",
      headers: browserishHeaders(),
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    outcome.httpStatus = response.status;
    const rawText = await response.text();

    if (response.status !== 200) {
      outcome.reason =
        `HTTP ${response.status} with ${rawText.length} body bytes ` +
        `(empty-body 202-style responses are Binance's silent WAF drop for flagged clients/IPs)`;
      return outcome;
    }

    let body: BapiSearchBody;
    try {
      body = JSON.parse(rawText) as BapiSearchBody;
    } catch {
      outcome.reason = `HTTP 200 but body is not JSON (${rawText.length} bytes)`;
      return outcome;
    }
    outcome.bodyCode = String(body.code);
    const ads = extractAds(body);
    outcome.adCount = ads.length;

    if (String(body.code) !== "000000") {
      outcome.reason = `body code "${body.code}" ("${body.message ?? "no message"}")`;
      return outcome;
    }
    if (ads.length === 0) {
      outcome.reason = 'code "000000" but zero ads returned';
      return outcome;
    }

    const fixture = {
      meta: {
        description: `Recorded LIVE response shape for the ${legName} P2P search leg. Recorded by scripts/bapi-smoke.ts - do not hand-edit.`,
        url: BAPI_P2P_SEARCH_URL,
        request,
        httpStatus: response.status,
        recordedAt: new Date().toISOString(),
        totalAdsReported: ads.length,
        adsKept: Math.min(MAX_ADS_KEPT, ads.length),
      },
      data: ads.slice(0, MAX_ADS_KEPT),
    };
    writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
    outcome.ok = true;
    return outcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outcome.reason = `request failed: ${message}`;
    return outcome;
  }
}

async function main(): Promise<number> {
  console.log(`BAPI smoke probe -> ${BAPI_P2P_SEARCH_URL}`);
  mkdirSync(FIXTURES_DIR, { recursive: true });

  const outcomes = [
    await probeLeg(
      "USDT/EUR BUY",
      USDT_EUR_CONVERSION_LEG,
      join(FIXTURES_DIR, "usdt-eur-buy.json"),
    ),
    await probeLeg(
      "USDT/VES SELL",
      USDT_VES_BUYER_SIDE_LEG,
      join(FIXTURES_DIR, "usdt-ves-sell.json"),
    ),
  ];

  let allUsable = true;
  for (const o of outcomes) {
    if (o.ok) {
      console.log(`[OK]   ${o.legName}: ${o.adCount} ads -> ${o.fixturePath}`);
    } else {
      allUsable = false;
      console.log(`[FAIL] ${o.legName}: ${o.reason} (http=${o.httpStatus ?? "n/a"})`);
    }
  }

  if (!allUsable) {
    console.log("");
    console.log("GATE NOT CLEARED: no fixtures were written.");
    console.log("Task 4.3 (/calculo handler) remains gated on this probe.");
    console.log("Re-run from an unblocked network (e.g. the production VPS or a");
    console.log("residential EU IP), then commit the two generated fixtures.");
    return 1;
  }

  console.log("");
  console.log("GATE CLEARED: both real response shapes recorded. Note the usability");
  console.log("verdict (fields present, prices plausible) in openspec change notes.");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`probe crashed: ${error instanceof Error ? error.stack : error}`);
    process.exit(1);
  },
);
