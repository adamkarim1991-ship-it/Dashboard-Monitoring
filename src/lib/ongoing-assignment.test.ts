import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCurrentAssignments, loadCurrentAssignmentsWithRetry, mergeCurrentCounts, singleFlight, pruneTimedCache } from "./ongoing-assignment";
const row = (awb: string, name: unknown, status = "out_for_delivery", hub_id = 1) => ({ awb_number: awb, assigned_drivers: name, status, hub_id });
const page = (shipments: unknown[], total_records = shipments.length, n = 1, per_page = 100) => ({ data: { shipments, total_records, page: n, per_page } });
test("A to B reassignment credits only current B, preserving other metrics", async () => {
  const assignment = await loadCurrentAssignments(async () => page([row("x", " b ")]), "1");
  const merged = mergeCurrentCounts([{ name: "A", picked: 1 }, { name: "B", picked: 0 }], assignment, name => ({ name, picked: 0 }));
  assert.equal(merged[0].ongoing, 0);
  assert.equal(merged[1].ongoing, 1);
  assert.equal(merged[0].picked, 1);
});
test("recipient absent from productivity included with zero other metrics", async () => {
  const assignment = await loadCurrentAssignments(async () => page([row("x", "B")]), "1");
  assert.deepEqual(mergeCurrentCounts([{ name: "A", picked: 1 }], assignment, name => ({ name, picked: 0 })), [{ name: "A", picked: 1, ongoing: 0 }, { name: "B", picked: 0, ongoing: 1 }]);
});
test("dedup AWB across pages, exclude delivered and other hubs", async () => {
  const rows = [row("x", "B"), row("y", "B", "delivered"), row("x", "B"), row("z", "C", "picked", 2)];
  const assignment = await loadCurrentAssignments(async n => page(rows.slice((n-1)*2, n*2), 4, n, 2), "1");
  assert.deepEqual([...assignment.counts], [["b", { name: "B", count: 1 }]]);
});
test("later page failures and truncation cannot succeed", async () => {
  await assert.rejects(loadCurrentAssignments(async n => { if (n === 2) throw new Error("upstream"); return page([row("x", "B")], 2, n, 1); }, "1"), /upstream/);
  await assert.rejects(loadCurrentAssignments(async () => page([row("x", "B")], 2, 1, 1), "1", 1), /limit/);
  await assert.rejects(loadCurrentAssignments(async n => page(n === 1 ? [row("x", "B")] : [], 2, n, 1), "1"), /missing/);
});
test("multi-owner array/string is ambiguous, never double counted", async () => {
  const assignment = await loadCurrentAssignments(async () => page([row("x", ["A", "B"]), row("y", "A,B"), row("z", "")]), "1");
  assert.equal(assignment.counts.size, 0);
  assert.equal(assignment.ambiguous, 2);
  assert.equal(assignment.unassigned, 1);
});
test("schema drift, string total, and moving assignment fail closed", async () => {
  await assert.rejects(loadCurrentAssignments(async () => ({ data: { shipments: [] } }), "1"), /contract/);
  await assert.rejects(loadCurrentAssignments(async () => ({ data: { shipments: [], total_records: "0", page: 1, per_page: 100 } }), "1"), /contract/);
  await assert.rejects(loadCurrentAssignments(async n => page([row("x", n === 1 ? "A" : "B")], 2, n, 1), "1"), /changed/);
});
test("120-page capacity beyond 4000 rows, at most 3 concurrent requests", async () => {
  let active = 0, maxActive = 0, calls = 0;
  const assignment = await loadCurrentAssignments(async n => {
    active++; calls++; maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return page(Array.from({ length: 100 }, (_, i) => row(String((n-1)*100+i), "B")), 12000, n);
  }, "1");
  assert.equal(assignment.counts.get("b")?.count, 12000);
  assert.equal(calls, 120);
  assert.equal(maxActive, 3);
});
test("over-cap rejects after first page without extra upstream work", async () => {
  let calls=0;
  await assert.rejects(loadCurrentAssignments(async n => { calls++; return page(Array.from({length:100}, (_, i)=>row(String(i), "B")), 12001, n); }, "1"), /121 pages required/);
  assert.equal(calls, 1);
});
test("single-flight shares payloads by scope and cleans failures for retry", async () => {
  const pending = new Map<string, Promise<{status:number}>>();
  let calls=0;
  const load=async()=>{calls++; await new Promise(resolve=>setTimeout(resolve,1)); return {status:200};};
  const results=await Promise.all([singleFlight(pending, "user1-hub1-day", load), singleFlight(pending, "user1-hub1-day", load), singleFlight(pending, "user2-hub1-day", load)]);
  assert.equal(calls,2);
  assert.deepEqual(results,[{status:200},{status:200},{status:200}]);
  assert.equal(pending.size,0);
  await assert.rejects(singleFlight(pending,"error",async()=>{throw new Error("fail");}),/fail/);
  assert.equal(pending.size,0);
  assert.deepEqual(await singleFlight(pending,"error",load),{status:200});
});
test("process cache prunes expired user/day entries and caps at 64", () => {
  const cache = new Map<string, { timestamp: number }>();
  cache.set("expired-user-day", { timestamp: 0 });
  for (let i = 0; i < 65; i++) cache.set(`user-day-${i}`, { timestamp: 30000 + i });
  pruneTimedCache(cache, 30000, 30000, 64);
  assert.equal(cache.size, 64);
  assert.equal(cache.has("expired-user-day"), false);
  assert.equal(cache.has("user-day-0"), false);
  assert.equal(cache.has("user-day-64"), true);
  pruneTimedCache(cache, 60064, 30000, 64);
  assert.equal(cache.size, 0);
});
test("actual UI incomplete guard blocks FTD updates for upstream and invalid samples", () => {
  const source = readFileSync("src/components/occ/ongoing-courier-tab.tsx", "utf8");
  const expression = source.split("const incomplete = ")[1].split(";")[0];
  const guard = new Function("d", "safeCouriers", `return (${expression});`);
  assert.equal(guard({ meta: { complete: false }, couriers: [1] }, [1]), true);
  assert.equal(guard({ meta: { cycle_errors: ["failed"] }, couriers: [1] }, [1]), true);
  assert.equal(guard({ meta: { complete: true }, couriers: [1, 2] }, [1]), true);
  assert.equal(guard({ meta: { complete: true, cycle_errors: [] }, couriers: [1] }, [1]), false);
  assert.ok(source.includes("if (!incomplete) {"));
});
test("moving total retries from page one once; only second stable snapshot counts", async () => {
  let attempts = 0;
  const requested: number[] = [];
  const signal = new AbortController().signal;
  const assignment = await loadCurrentAssignmentsWithRetry(async n => {
    requested.push(n);
    if (n === 1) attempts++;
    if (attempts === 1) return page([row("old", "A")], n === 1 ? 2 : 3, n, 1);
    return page([row(String(n), n === 1 ? "B" : "C")], 2, n, 1);
  }, "1", signal);
  assert.equal(assignment.snapshotAttempts, 2);
  assert.deepEqual(requested, [1, 2, 1, 2]);
  assert.equal(assignment.counts.has("a"), false);
  assert.equal(assignment.counts.get("b")?.count, 1);
  assert.equal(assignment.counts.get("c")?.count, 1);
});
test("moving ownership retries once without retaining earlier owners", async () => {
  let attempts = 0;
  const assignment = await loadCurrentAssignmentsWithRetry(async n => {
    if (n === 1) attempts++;
    return page([row("x", attempts === 1 && n === 1 ? "A" : "B")], 2, n, 1);
  }, "1", new AbortController().signal);
  assert.equal(assignment.snapshotAttempts, 2);
  assert.equal(assignment.counts.has("a"), false);
  assert.equal(assignment.counts.get("b")?.count, 1);
});
test("both moving snapshots fail closed; no third snapshot", async () => {
  let attempts = 0, calls = 0;
  await assert.rejects(loadCurrentAssignmentsWithRetry(async n => {
    calls++;
    if (n === 1) attempts++;
    return page([row("x", "B")], n === 1 ? 2 : 3, n, 1);
  }, "1", new AbortController().signal), /total changed/);
  assert.equal(attempts, 2);
  assert.equal(calls, 4);
});
test("schema, HTTP, page-size drift and truncation errors are not snapshot-retried", async () => {
  const responses = [
    async () => { throw new Error("HTTP 503"); },
    async () => ({ data: { shipments: [] } }),
    async (n: number) => page([row("x", "B")], 2, n, n === 1 ? 1 : 2),
    async (n: number) => page(n === 1 ? [row("x", "B")] : [], 2, n, 1)
  ];
  for (const response of responses) {
    let starts = 0;
    await assert.rejects(loadCurrentAssignmentsWithRetry(async n => {
      if (n === 1) starts++;
      return response(n);
    }, "1", new AbortController().signal));
    assert.equal(starts, 1);
  }
});
test("retry retains original deadline and never starts after it expires", async () => {
  const controller = new AbortController();
  let starts = 0;
  await assert.rejects(loadCurrentAssignmentsWithRetry(async n => {
    if (n === 1) starts++;
    else controller.abort(new Error("original deadline expired"));
    return page([row("x", "A")], n === 1 ? 2 : 3, n, 1);
  }, "1", controller.signal), /original deadline expired/);
  assert.equal(starts, 1);
});