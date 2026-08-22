import { describe, expect, it } from "vitest";

describe("runtime platform contract", () => {
  it("runs on Node.js >= 22 as required by the stack decision (D1)", () => {
    const major = Number(process.versions.node.split(".")[0]);
    expect(major).toBeGreaterThanOrEqual(22);
  });
});
