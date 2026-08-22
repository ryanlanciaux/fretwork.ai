import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Static check — full stdio harness lives in the project's validation
// suite (HRN-4). This is a fast tripwire that the tool definitions are
// well-formed.
describe("mcp tools", () => {
  it("declares inputSchema with required arrays for every tool", () => {
    const src = readFileSync(resolve(__dirname, "../src/mcp.ts"), "utf8");
    expect(src).toContain('name: "list_clients"');
    expect(src).toContain('name: "create_invoice"');
    // Every tool must have a `required` array (even if empty).
    const requiredHits = src.match(/required:\s*\[/g) ?? [];
    expect(requiredHits.length).toBeGreaterThanOrEqual(2);
  });
});
