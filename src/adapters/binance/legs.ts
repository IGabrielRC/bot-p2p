/**
 * Binance P2P search request contracts (design D2, rate-query "Buyer-Side
 * Book Semantics"). This module is the SINGLE home of the outbound request
 * shapes; the smoke probe (scripts/bapi-smoke.ts) records fixtures with them
 * and the future bapiClient (task 2.2) sends them verbatim.
 *
 * Book-side semantics - getting these backwards is a defect even if numbers
 * look plausible:
 * - USDT/VES leg pins tradeType=SELL: the buyer-side book, i.e. the prices
 *   BUYERS pay for Kelly's USDT in VES.
 * - USDT/EUR leg pins tradeType=BUY: Kelly converts received EUR into USDT,
 *   i.e. SHE buys USDT with EUR.
 */

export const BAPI_P2P_SEARCH_URL =
  "https://bapi.binance.com/bapi/c2c/v1/friendly/p2p/adv/search";

export type TradeType = "BUY" | "SELL";

/** POST body shape expected by the friendly P2P adv/search endpoint. */
export interface P2pSearchRequest {
  page: number;
  rows: number;
  asset: "USDT";
  fiat: string;
  tradeType: TradeType;
  payTypes: string[];
  /** The public endpoint expects an explicit null here (no publisher filter). */
  publisherType: null;
}

/** Buyer-side USDT/VES book used by /tasa margins (tradeType=SELL). */
export const USDT_VES_BUYER_SIDE_LEG: P2pSearchRequest = Object.freeze({
  page: 1,
  rows: 5,
  asset: "USDT",
  fiat: "VES",
  tradeType: "SELL",
  payTypes: [],
  publisherType: null,
});

/** EUR->USDT conversion leg used by /calculo (tradeType=BUY). */
export const USDT_EUR_CONVERSION_LEG: P2pSearchRequest = Object.freeze({
  page: 1,
  rows: 5,
  asset: "USDT",
  fiat: "EUR",
  tradeType: "BUY",
  payTypes: [],
  publisherType: null,
});
