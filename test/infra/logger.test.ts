import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/infra/logger.js";

function capturing(): { lines: string[]; stream: Writable } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { lines, stream };
}

describe("redacting logger", () => {
  it("censors root-level secret fields and never emits their values", () => {
    const { lines, stream } = capturing();
    const log = createLogger({ level: "info", stream });
    log.info(
      {
        botToken: "REAL-BOT-TOKEN",
        encryptionKey: "REAL-KEY-HEX",
        refreshToken: "1//REAL",
      },
      "booting",
    );
    const output = lines.join("");
    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain("REAL-BOT-TOKEN");
    expect(output).not.toContain("REAL-KEY-HEX");
    expect(output).not.toContain("1//REAL");
  });

  it("censors nested secret fields one and two levels deep", () => {
    const { lines, stream } = capturing();
    const log = createLogger({ level: "info", stream });
    log.info(
      {
        gmail: { token: "NESTED-TOKEN" },
        ctx: { vault: { key: "DEEP-KEY" } },
      },
      "polling",
    );
    const output = lines.join("");
    expect(output).not.toContain("NESTED-TOKEN");
    expect(output).not.toContain("DEEP-KEY");
    expect(output).toContain("[REDACTED]");
  });

  it("keeps non-secret fields readable for diagnostics", () => {
    const { lines, stream } = capturing();
    const log = createLogger({ level: "info", stream });
    log.info({ orderId: "12345", status: "sent" }, "alert delivered");
    const output = lines.join("");
    expect(output).toContain("12345");
    expect(output).toContain("sent");
    expect(output).not.toContain("[REDACTED]");
  });

  it("respects the configured level threshold", () => {
    const { lines, stream } = capturing();
    const log = createLogger({ level: "warn", stream });
    log.debug({ event: "hidden" }, "should not appear");
    expect(lines).toHaveLength(0);
  });
});
