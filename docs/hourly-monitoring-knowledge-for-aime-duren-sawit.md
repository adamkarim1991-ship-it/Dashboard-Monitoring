# Hourly Monitoring Knowledge Pack for Aime Duren Sawit

## Goal
Build an Hourly Monitoring dashboard that behaves the same way as the GTL / GoTo Logistik dashboard for Jatinegara and Duren Sawit, especially for **actual post-cutoff percentages**.

This knowledge pack explains the **business logic, data sources, formulas, cutoff behavior, implementation files, known pitfalls, and exact fix direction**.

---

## 1. Product intent
The Hourly Monitoring page is not a generic chart page. It is an **operations dashboard** for a hub that must show:

- actual operational volume
- actual delivery progress
- actual failure and pending state
- actual morning-cutoff metrics
- actual COD / urgent / aging-derived operational metrics

The most important rule:

> **A successful build or HTTP 200 is not proof that the metric is correct.**
> The page is only correct if the percentages still match operational truth when the user opens the dashboard **after 08:00 WIB or after 12:00 WIB**.

---

## 2. Main pages and components

### Hub pages
- `src/app/hourly/duren-sawit/page.tsx`
- similar hourly pages use `DashboardView`

### Main UI component
- `src/components/dashboard/dashboard-view.tsx`

This is the real hourly page used for hub-specific monitoring like Duren Sawit / Jatinegara.

### Supporting alternate hourly UI
- `src/components/occ/hourly-tab.tsx`

This contains similar percentage cards and subdistrict logic, so if you want true parity, keep both components aligned.

### Main backend summary endpoint
- `src/app/api/hms/summary/route.ts`

This is the core source for top cards such as:
- Success Delivered
- Fresh Success
- SD < 12 PM
- Clean Floor
- Pending 48H
- COD FD %
- Urgent Delivery %

### Subdistrict backend
- `src/app/api/hms/subdistrict/route.ts`

This is important because it already contains a more shipment-level / inbound-level approach for some morning calculations.

---

## 3. Data sources and what each one is used for

## 3.1 HMS OPC / one-service summary
Used for fast aggregate cards:
- today volume
- just arrived
- backlog
- delivered
- ongoing
- failed to deliver
- pending at hub
- COD slice
- urgent slice

In `summary/route.ts`, these come from one-service APIs and compact field parsing.

This source is fast, but dangerous for morning-cutoff percentages because the values keep moving through the day.

## 3.2 HMS inbound task search
Endpoint pattern:
- `/api/hms/v1/ui/task/search`

Used to identify **which AWBs belong to the morning cohort**.
This is the source of truth for:
- which shipments were already in operational scope before 08:00
- which shipments are **fresh C1** (received between 00:00 and 08:00 WIB)
- which shipments are backlog in the morning cohort

## 3.3 HMS shipments endpoint
Endpoint pattern:
- `/tms/api/lms/v1/shipments`

Used to get **current per-AWB status** and timestamps like:
- delivery time
- out-for-delivery time
- delivery attempts
- current status code

This is required to turn a morning cohort into actual live operational classification.

---

## 4. Critical business definitions

## 4.1 Fresh C1
Fresh C1 = shipments whose first inbound falls between:
- `00:00 WIB`
- `08:00 WIB`

This is **not** the same as live `just_arrived` after noon.
If you use live `just_arrived` after 12 PM as denominator, the percentage will drift and become wrong.

## 4.2 Morning operational cohort for Clean Floor
Morning Clean Floor cohort = all operational inbound shipments counted from:
- HMS operational anchor start (`previous day 17:00 WIB`)
- until `08:00 WIB`

This cohort is effectively:
- Fresh C1
- plus backlog already present in the morning

This denominator must represent the true morning cohort, not whatever live OPC volume happens to be when the dashboard is first opened.

## 4.3 SD < 12 PM
Definition:
- numerator = Fresh C1 shipments delivered before 12:00 WIB on the same day
- denominator = Fresh C1 total

Formula:

```text
SD < 12 PM = delivered_before_12 / fresh_c1 * 100
```

## 4.4 Clean Floor (morning cohort)
Definition:
- denominator = total morning operational cohort captured up to 08:00 WIB
- numerator = processed shipments from that same cohort, where processed means:
  - delivered
  - out for delivery / delivering
  - failed to deliver
  - other terminal / handled states such as ready_to_return, cancelled, wbc, returning-to-hub family

Formula:

```text
Clean Floor = (delivered + delivering + ftd + others) / morning_cohort_total * 100
```

Important:
- pending-like statuses are **not processed**
- pending-like statuses stay outside the numerator

---

## 5. The actual bug that happened after 12 PM
The historical bug was:

1. the page used lock/frozen summary logic
2. if the dashboard was first opened **after the cutoff time**, the system could freeze or observe the wrong live values
3. this made percentages depend on **when the user first opened the page**, not on the true morning cohort

So the bug was not simply “wrong math syntax”.
It was:

> **wrong data cohort selection at cutoff time**

Typical symptoms:
- Jatinegara and Duren Sawit percentages look wrong only when the dashboard is opened late
- SD < 12 PM can be based on a live summary denominator instead of actual Fresh C1 cohort
- Clean Floor can reflect late live totals instead of true morning scope

---

## 6. Correct design principle
Never rely only on live aggregate OPC fields for morning-cutoff metrics.

For morning-cutoff metrics, do this instead:

1. build the cohort from inbound task data
2. fetch shipments for those AWBs
3. classify each shipment by current status
4. derive percentage from the exact cohort

This makes the dashboard correct even if the first page load happens after 12:00 WIB.

---

## 7. Implemented fix direction
The fix is in:
- `src/app/api/hms/summary/route.ts`

### New idea
Instead of trusting only lock snapshots, recompute the morning cutoff metrics from shipment-level data:

- build inbound AWB map for the morning operational window
- derive two cohorts from one scan:
  - operational morning cohort (for Clean Floor)
  - fresh C1 cohort (for SD < 12 PM)
- fetch live shipment rows for those AWBs
- classify each AWB
- compute exact percentages
- keep the old lock only as fallback

### Added logic
Key additions include:
- morning cohort helper logic
- shipment status normalization
- shipment classification into:
  - delivered
  - delivering
  - failed
  - other
  - pending
- exact recomputation after 08:00 WIB

### Why this fix is better
Because it is based on:
- inbound timestamps for cohort membership
- shipment timestamps / status for actual outcome

not on:
- whichever live OPC totals were seen first

---

## 8. Important status classification rules
The implementation needs a normalized classifier.

### Delivered
Treat these as delivered:
- `delivered`
- `pod_confirmed`
- `success_delivery`
- any row with `destination_details.delivery_time`

### Delivering
Treat these as delivering:
- `ofd`
- `out_for_delivery`
- `ongoing_delivery`
- `on_delivery`
- `delivering`
- `in_driver`
- any row with `destination_details.out_for_delivery_time`

### Failed
Treat these as failed:
- `ftd`
- `failed_to_deliver`
- `failed_delivery`
- fallback: delivery attempts > 0 when no stronger final state is present

### Other processed states
Treat these as processed-other:
- `ready_to_return`
- `rtr`
- `cancelled`
- `canceled`
- `wbc`
- `return_to_hub`
- `returned_to_hub`

### Pending-like states
Treat these as not yet processed:
- `arrived_at_hub`
- `still_in_hub`
- `pending_at_hub`
- `bagged`
- `driver_allocated`
- `assigned_to_driver`
- `waiting_confirmation`
- `received`

If the status is unknown and there is no stronger evidence, default to pending rather than inflating the numerator.

---

## 9. Exact morning cutoff windows

## 9.1 Fresh C1 window
```text
00:00 WIB -> 08:00 WIB
```

## 9.2 SD < 12 PM delivery window
```text
same-day delivered time >= 00:00 WIB and < 12:00 WIB
```

## 9.3 Clean Floor operational cohort window
```text
previous day 17:00 WIB -> current day 08:00 WIB
```

This follows the HMS operational anchor.

---

## 10. Why lock-only logic is not enough
The repository contains lock logic in:
- `src/lib/metric-lock.ts`

Locks are useful, but by themselves they are not sufficient for “actual” morning metrics if:
- the lock was never created exactly at the real cutoff
- the user opens the page late
- the dashboard depends on observed live values instead of reconstructed cohort truth

So the correct hierarchy is:

1. exact inbound + shipment reconstruction
2. remembered good value / cache fallback
3. old lock fallback only if exact reconstruction fails

---

## 11. UI-specific correction
There was also a percentage aggregation mistake in the subdistrict total row.

Bad approach:
- average each subdistrict `sd_before_12` percentage

Correct approach:
- sum `fresh_before_12`
- sum `fresh_c1`
- compute one weighted ratio

Correct formula:

```text
subdistrict_total_sd_before_12 = total_fresh_before_12 / total_fresh_c1 * 100
```

This needs to be correct in both:
- `src/components/dashboard/dashboard-view.tsx`
- `src/components/occ/hourly-tab.tsx`

Otherwise the table total can disagree with the headline metric.

---

## 12. Files that matter most

### Core backend
- `src/app/api/hms/summary/route.ts`
- `src/app/api/hms/subdistrict/route.ts`
- `src/lib/metric-lock.ts`
- `src/lib/operating-day.ts`

### Core frontend
- `src/components/dashboard/dashboard-view.tsx`
- `src/components/occ/hourly-tab.tsx`
- `src/app/hourly/duren-sawit/page.tsx`

### Related but secondary
- `src/app/api/hms/coverage/route.ts`
- `src/lib/clean-floor.ts`
- `src/app/api/cron/snapshot-clean-floor/route.ts`

---

## 13. Exact implementation expectations for parity
If Aime Duren Sawit wants to rebuild the same dashboard, the implementation should preserve all of the following:

### Authentication / access
- backend-only credential use
- no secrets in frontend
- no secrets in git
- no secrets in chat or docs

### Data integrity
- no destructive migration
- preserve Neon and existing history
- preserve first-write snapshot semantics where already used
- do not silently replace official cohort math with simplified math

### Dashboard behavior
- the page must still work when opened late
- post-cutoff metrics must remain actual
- cache is okay, but cache must not change metric truth

### Operational philosophy
- actual data > faster fake summary
- measured correctness > “looks plausible”

---

## 14. Pseudocode for the exact fix

```ts
summary = fetchFastOpcSummary()

if (currentWibHour >= 8) {
  morningInbound = fetchInboundTasks(previousDay17, today08)
  inboundByAwb = map earliest received_at per awb

  shipments = fetchShipments(allMorningAwbs)
  bestShipmentByAwb = collapseRowsByPriority(shipments)

  operational = classify(allMorningAwbs)
  freshC1 = classify(awbs with inboundAt between today00 and today08)

  cleanFloor = (operational.delivered + operational.ongoing + operational.ftd + operational.others)
               / operational.total

  sdBefore12 = freshC1.deliveredBefore12 / freshC1.total

  use reconstructed values as primary truth
} else {
  use existing live / lock path
}
```

---

## 15. Validation checklist
Aime Duren Sawit should not stop at build success. Validate these:

## 15.1 Late-open validation
Open dashboard after 12 PM and verify:
- SD < 12 PM still matches shipment reality
- Clean Floor still matches the true morning cohort
- Jatinegara and Duren Sawit both behave correctly

## 15.2 Cross-check with subdistrict totals
Verify:
- top SD < 12 PM is consistent with weighted subdistrict totals
- not simple average of district percentages

## 15.3 Shipment-level spot checks
Pick sample AWBs and confirm:
- inbound time places AWB in correct cohort
- delivered before noon counted correctly
- pending-like statuses are excluded from processed numerator
- ready_to_return / cancelled / wbc go to “others” not pending

## 15.4 Build validation
At minimum:
- project build passes
- no TypeScript errors
- no broken route imports

---

## 16. Common mistakes to avoid
Do **not** do these:

1. **Do not** use live `just_arrived` after noon as Fresh C1 denominator.
2. **Do not** average subdistrict percentages to get total SD < 12 PM.
3. **Do not** assume a successful fetch means the metric is correct.
4. **Do not** expose tokens, cookies, env values, or secret URLs.
5. **Do not** overwrite historical logic without understanding the operational-day anchor.
6. **Do not** treat first page open time as the source of truth.
7. **Do not** count pending-like states as processed in Clean Floor.

---

## 17. What “same persis” really means
To make the same hourly dashboard, Aime Duren Sawit must copy not only the UI cards, but also:

- operating day semantics
- morning cohort reconstruction logic
- inbound task cohort building
- shipment status classification
- weighted percentage aggregation
- safe fallback strategy
- backend-only secrets discipline

If only the UI is copied, the dashboard will look similar but become wrong after cutoff times.

---

## 18. Short handoff summary
If you need a short instruction to send to another Aime:

> Build Hourly Monitoring with `DashboardView` + `/api/hms/summary` as the main path, but do not trust live OPC aggregate values for morning-cutoff percentages. Reconstruct the morning cohort from HMS inbound task search, then fetch shipment rows for those AWBs, classify the current status per AWB, and compute Clean Floor and SD < 12 PM from that exact cohort. For subdistrict total SD < 12 PM, use weighted ratio (`sum fresh_before_12 / sum fresh_c1`) instead of averaging district percentages.

---

## 19. Current fix files in this branch
The concrete fixes for the post-noon percentage issue are in:
- `src/app/api/hms/summary/route.ts`
- `src/components/dashboard/dashboard-view.tsx`
- `src/components/occ/hourly-tab.tsx`

If you want full parity, study these files together.
