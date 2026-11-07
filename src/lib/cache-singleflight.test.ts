import { ScopedSingleflightCache } from "./cache-singleflight";
import assert from "node:assert/strict";
import { test } from "node:test";
import { NextResponse } from "next/server";
const stamp = "2026-11-07T01:00:00.000Z";
const ok = () => NextResponse.json({ success: true, summary: { fetched_at: stamp } });
test("fake clock TTL and payload timestamp", async () => {
  let now = 0, calls = 0;
  const cache = new ScopedSingleflightCache(64, () => now);
  const fetcher = async () => { calls++; return ok(); };
  assert.equal((await cache.getOrFetch("k", 60, fetcher)).data.fetchedAt, stamp);
  now = 59; assert.equal((await cache.getOrFetch("k", 60, fetcher)).source, "cache");
  now = 60; assert.equal((await cache.getOrFetch("k", 60, fetcher)).source, "fresh"); assert.equal(calls, 2);
});
test("concurrent single factory and cookie isolation", async () => {
  const cache = new ScopedSingleflightCache();
  let release!: (res: NextResponse) => void, calls = 0;
  const fetcher = () => { calls++; return new Promise<NextResponse>(r => { release = r; }); };
  const a = cache.getOrFetch("k", 1000, fetcher), b = cache.getOrFetch("k", 1000, fetcher);
  await Promise.resolve(); assert.equal(calls, 1);
  const res = ok(); res.headers.set("set-cookie", "private=leader"); res.headers.set("x-middleware-set-cookie", "internal=leader"); release(res);
  const [leader, follower] = await Promise.all([a, b]);
  assert.equal(leader.source, "fresh"); assert.equal(follower.source, "inflight");
  assert.equal(leader.leaderRes?.headers.get("set-cookie"), "private=leader"); assert.equal(follower.leaderRes, undefined);
  for (const item of [follower, await cache.getOrFetch("k", 1000, fetcher)]) {
    assert.equal(item.data.headers["set-cookie"], undefined); assert.equal(item.data.headers["x-middleware-set-cookie"], undefined);
  }
});
test("user hub day phase scopes", async () => {
  const cache = new ScopedSingleflightCache(); let calls = 0;
  const keys = [["u","h","d","pre08"],["v","h","d","pre08"],["u","j","d","pre08"],["u","h","e","pre08"],["u","h","d","08to12"],["u","h","d","post12"]];
  for (const key of keys) await cache.getOrFetch(JSON.stringify(key), 1000, async () => { calls++; return ok(); }); assert.equal(calls, keys.length);
});
test("bounded eviction", async () => {
  const cache = new ScopedSingleflightCache(2);
  for (const key of ["a","b","c"]) await cache.getOrFetch(key, 1000, async () => ok());
  assert.equal((await cache.getOrFetch("b", 1000, async () => ok())).source, "cache"); assert.equal((await cache.getOrFetch("a", 1000, async () => ok())).source, "fresh");
});
test("failure malformed and auth responses not cached", async () => {
  for (const factory of [() => new NextResponse("err", {status:500}), () => NextResponse.json({success:false}), () => new NextResponse("bad"), () => NextResponse.json({success:true,summary:{}}), () => NextResponse.json({success:true,auth_error:true,summary:{fetched_at:stamp}}), () => NextResponse.json({error:"Unauthorized"},{status:401})]) {
    const cache = new ScopedSingleflightCache(); let calls = 0;
    const fetcher = async () => { calls++; return factory(); };
    await cache.getOrFetch("k",1000,fetcher); await cache.getOrFetch("k",1000,fetcher); assert.equal(calls,2);
  }
});
test("concurrent failure cleanup and retry", async () => {
  const cache = new ScopedSingleflightCache(); const failing = () => { throw new Error("fail"); };
  const results = await Promise.allSettled([cache.getOrFetch("k",1000,failing),cache.getOrFetch("k",1000,failing)]);
  assert.ok(results.every(r => r.status === "rejected")); assert.equal((await cache.getOrFetch("k",1000,async () => ok())).source,"fresh");
});
