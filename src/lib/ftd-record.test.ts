import assert from "node:assert/strict";
import { test } from "node:test";
import { accumulateFtd, ftdStorageKey, getWibDate, parseFtdRecord, validCount } from "./ftd-record";
const now = Date.parse("2026-11-07T16:59:59Z");
const row = (totalFtd: unknown) => [{ name: "Krisdian", totalFtd }];
const first = (n: number) => accumulateFtd(null, "A", row(n), now);
test("first observation 7 counts 7, including initial zero snapshot", () => {
  assert.equal(first(7).entries.Krisdian.ftdToday, 7);
  assert.equal(accumulateFtd(first(0), "A", row(7), now + 1).entries.Krisdian.ftdToday, 7);
});
test("monotonic increases", () => {
  assert.equal(accumulateFtd(first(7), "A", row(10), now + 1).entries.Krisdian.ftdToday, 10);
});
test("10 to 5 to 8 yields 13 and updates drop baseline", () => {
  const drop = accumulateFtd(first(10), "A", row(5), now + 1);
  assert.equal(drop.entries.Krisdian.ftdToday, 10);
  assert.equal(drop.entries.Krisdian.lastTotalFtd, 5);
  const rise = accumulateFtd(drop, "A", row(8), now + 2);
  assert.equal(rise.entries.Krisdian.ftdToday, 13);
  assert.equal(rise.entries.Krisdian.currentFtd, 8);
});
test("repeated sample does not increase", () => {
  assert.equal(accumulateFtd(first(7), "A", row(7), now + 1).entries.Krisdian.ftdToday, 7);
});
test("explicit WIB midnight starts new day without carrying absent couriers", () => {
  assert.equal(getWibDate(now), "2026-11-07");
  assert.equal(getWibDate(now + 1000), "2026-11-08");
  const archive = first(7);
  const next = accumulateFtd(archive, "A", [], now + 1000);
  assert.deepEqual(next.entries, {});
  assert.equal(archive.entries.Krisdian.ftdToday, 7);
  assert.equal(accumulateFtd(next, "A", row(3), now + 1001).entries.Krisdian.ftdToday, 3);
});
test("hub isolation and per-day keys", () => {
  assert.equal(accumulateFtd(first(7), "B", row(2), now).entries.Krisdian.ftdToday, 2);
  assert.notEqual(ftdStorageKey("A", "2026-11-07"), ftdStorageKey("B", "2026-11-07"));
  assert.notEqual(ftdStorageKey("A", "2026-11-07"), ftdStorageKey("A", "2026-11-08"));
});
test("missing courier preserves baseline", () => {
  const missing = accumulateFtd(first(7), "A", [], now + 1);
  assert.equal(missing.entries.Krisdian.lastTotalFtd, 7);
  assert.equal(accumulateFtd(missing, "A", row(8), now + 2).entries.Krisdian.ftdToday, 8);
});
test("invalid sample or incomplete cycle preserves whole record and baseline", () => {
  const base = first(7);
  for (const invalid of [-1, NaN, Infinity, "8", null, undefined]) {
    assert.equal(validCount(invalid), false);
    assert.equal(accumulateFtd(base, "A", row(invalid), now + 1), base);
  }
  assert.equal(accumulateFtd(base, "A", row(10), now + 1, true), base);
  assert.equal(accumulateFtd(base, "A", [...row(10), { name: "x" }], now + 1), base);
});
test("storage roundtrip verifies version, hub, date and values; legacy is not migrated", () => {
  const base = first(7), raw = JSON.stringify(base);
  assert.deepEqual(parseFtdRecord(raw, "A", base.dateWib), base);
  assert.equal(parseFtdRecord(raw, "B", base.dateWib), null);
  assert.equal(parseFtdRecord(raw, "A", "2026-11-08"), null);
  assert.equal(parseFtdRecord('{"dateWib":"2026-11-07","entries":{}}', "A", base.dateWib), null);
  assert.equal(parseFtdRecord("bad json", "A", base.dateWib), null);
  base.entries.Krisdian.lastTotalFtd = -1;
  assert.equal(parseFtdRecord(JSON.stringify(base), "A", base.dateWib), null);
});
