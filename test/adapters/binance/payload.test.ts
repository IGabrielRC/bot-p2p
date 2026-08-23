import { describe, expect, it } from "vitest";
import {
  BAPI_P2P_SEARCH_URL,
  USDT_EUR_CONVERSION_LEG,
  USDT_VES_BUYER_SIDE_LEG,
} from "../../../src/adapters/binance/legs.js";

/**
 * Design-mandated RED-test candidates for task 2.2 (review F9 / D2): each leg
 * asserts its own book side in a SEPARATE test - no shared generic assertion -
 * so a swapped tradeType can never slip through one aggregated check.
 *
 * These pin the contract now; slice 3 keeps them green by sending exactly
 * these objects through the real client.
 */
describe("BAPI search request legs", () => {
  it("pins the public P2P search endpoint", () => {
    expect(BAPI_P2P_SEARCH_URL).toBe(
      "https://bapi.binance.com/bapi/c2c/v1/friendly/p2p/adv/search",
    );
  });

  it("VES leg targets the buyer-side USDT/VES book: tradeType=SELL", () => {
    expect(USDT_VES_BUYER_SIDE_LEG.fiat).toBe("VES");
    expect(USDT_VES_BUYER_SIDE_LEG.asset).toBe("USDT");
    expect(USDT_VES_BUYER_SIDE_LEG.tradeType).toBe("SELL");
  });

  it("EUR conversion leg separately pins the EUR buy side: tradeType=BUY", () => {
    expect(USDT_EUR_CONVERSION_LEG.fiat).toBe("EUR");
    expect(USDT_EUR_CONVERSION_LEG.asset).toBe("USDT");
    expect(USDT_EUR_CONVERSION_LEG.tradeType).toBe("BUY");
  });

  it("never lets the two legs share a payload object", () => {
    expect(USDT_VES_BUYER_SIDE_LEG).not.toBe(USDT_EUR_CONVERSION_LEG);
    expect(USDT_VES_BUYER_SIDE_LEG).not.toEqual(
      expect.objectContaining({ fiat: "EUR" }),
    );
    expect(USDT_EUR_CONVERSION_LEG).not.toEqual(
      expect.objectContaining({ tradeType: "SELL" }),
    );
  });
});
