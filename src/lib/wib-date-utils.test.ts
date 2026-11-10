import test from "node:test";
import assert from "node:assert";
import { getWibRangeEpoch, parseWibDateToUnixRange } from "./wib-date-utils.js";

test("WIB Date Utils Range Logic", async (t) => {
  await t.test("Nov 4 to 10 range (inclusive) WIB boundaries", () => {
    const range = getWibRangeEpoch("20261104", "20261110");
    assert.notStrictEqual(range, null);
    
    // User verified values for 2026 (browser verified):
    // 2026-11-04 00:00:00 WIB = 1793725200
    // 2026-11-10 23:59:59 WIB = 1794329999
    assert.strictEqual(range?.from, 1793725200);
    assert.strictEqual(range?.to, 1794329999);
  });

  await t.test("Nov 10 only (one day range)", () => {
    const range = getWibRangeEpoch("20261110", "20261110");
    assert.notStrictEqual(range, null);
    // 2026-11-10 00:00:00 WIB = 1794243600
    assert.strictEqual(range?.from, 1794243600);
    assert.strictEqual(range?.to, 1794329999);
  });

  await t.test("Leap year and invalid dates", () => {
    assert.notStrictEqual(parseWibDateToUnixRange("20240229"), null);
    assert.strictEqual(parseWibDateToUnixRange("20240230"), null);
    assert.strictEqual(parseWibDateToUnixRange("20261301"), null);
    assert.strictEqual(parseWibDateToUnixRange("20261131"), null);
  });

  await t.test("Format and range validation", () => {
    assert.strictEqual(parseWibDateToUnixRange("abc"), null);
    assert.strictEqual(getWibRangeEpoch("20261110", "20261104"), null);
  });
});
