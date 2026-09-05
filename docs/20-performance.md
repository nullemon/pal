# Performance — the pre-launch baseline

What one PALScans origin actually serves per second, measured rather than estimated, so that
after launch there is something to compare against.

Everything here comes from `apps/web/scripts/loadtest.mjs`. It is committed and repeatable:

```sh
pnpm --filter @palscans/web build
pnpm --filter @palscans/web exec node scripts/loadtest.mjs --sweep              # what you ship
pnpm --filter @palscans/web exec node scripts/loadtest.mjs --sweep --workers 1  # one process
```

The script starts the server the deployment starts — `scripts/serve.mjs`, one `next start` per
core — on port 3205, finds a real series and chapter by
reading the links off the home page, warms each path, then runs a fixed number of concurrent
readers against it for a fixed window. **It refuses to measure `next dev`** — the dev server
compiles on demand and does not build React for production, so its numbers would be a lie
that outlives the afternoon somebody produced them.

Page **images are not in the test**, because they are not in the request path: they come from
`cdn.palscans.org` straight out of R2 and never touch this server (docs/18 §1). What follows
is the whole of what the origin does.

---

## The machine these numbers came from

| | |
| --- | --- |
| CPU | 4 × Intel Xeon @ 2.10 GHz (4 vCPU) |
| Memory | 16 GB |
| OS / runtime | Linux 6.18, Node v22.22.2, Next.js 16.3.4 (Turbopack build) |
| Web | **one** `next start` process, `NODE_ENV=production`, `TRUSTED_PROXY=xff`. That was the deployment when these were taken; it is now one per core, and the section *One process per core* below re-measures both on the same box |
| Postgres | 16.13, on the same box, over loopback (`127.0.0.1:5433`) |
| Valkey/Redis | on the same box, `REDIS_URL` set — so sessions, rate limits and the view dedupe are the production shape |
| Catalogue | the seed database: 137 series, 4 968 chapters, 54 837 chapter pages. The series under test has **306 published chapters** |
| Date | 2026-09-05 |

**Caveat, stated up front:** this is a shared build machine, not a dedicated server. Load
average was **2.4 before and 6.2 after** the run on a 4-core box — some of that is the test
itself, some is other work on the same host. So treat the wall-clock latencies below as
**pessimistic**, and trust the *CPU-per-request* figures further down more: those are measured
from the server process's own `utime + stime` and barely move with contention. The script now
records load average alongside every result for exactly this reason.

A Hetzner CPX31 (the box docs/18 §0 recommends) is a comparable 4 vCPU, so the shape of these
numbers should carry; the absolute values will be a little better on an idle machine.

---

## Baseline · 8 concurrent readers, 20 s per path

| path | requests | req/s | p50 ms | p95 ms | p99 ms | max ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `GET /` | 928 | **46.3** | 170.1 | 200.2 | 216.9 | 391.8 |
| `GET /series/<slug>` | 552 | **27.4** | 288.5 | 350.1 | 404.7 | 457.8 |
| `GET /series/<slug>/chapter-1` | 668 | **33.3** | 231.3 | 298.5 | 504.6 | 584.3 |
| `POST /api/views` | 12 856 | **642.7** | 11.2 | 19.5 | 26.3 | 169.6 |

Every request answered 200 (202 for the beacon); nothing errored, nothing timed out.

The beacon's outcomes over that window were `duplicate` 9 984, `rate_limited` 2 646,
`recorded` 226 — the test rotates through 256 reader addresses, so the first request from each
is a real view and the rest exercise the per-viewer dedupe and the 40/minute per-address
budget. All three are cheap; the accepted path is the one that costs a Redis `SET NX PX` and a
row in the next batched INSERT.

## Where it stops scaling · the reader at rising concurrency

Same request, same server, concurrency 1 → 32:

| concurrency | req/s | p50 ms | p95 ms | p99 ms |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 30.8 | 30.7 | 44.7 | 68.6 |
| 2 | 33.0 | 58.0 | 77.3 | 124.3 |
| 4 | 25.0 | 146.4 | 276.8 | 388.4 |
| 8 | 33.9 | 226.0 | 316.9 | 453.4 |
| 16 | 36.8 | 420.7 | 523.8 | 697.6 |
| 32 | 39.2 | 771.2 | 1088.8 | 1262.1 |

**Throughput is flat from one concurrent reader to thirty-two while latency rises in exact
proportion.** That is the signature of a single queue with one server behind it: at concurrency
1 the box is already doing all it can, and every extra reader only waits.

## Why: one core, ~30 ms of CPU per page

Measured directly from `/proc/<next-server>/stat` during a 15 s run at concurrency 8:

| path | req/s | server CPU per request | cores busy |
| --- | ---: | ---: | ---: |
| `GET /` | 39.7 | **27.0 ms** | 1.07 |
| `GET /series/<slug>` | 30.8 | **36.2 ms** | 1.11 |
| `GET /series/<slug>/chapter-1` | 33.6 | **31.8 ms** | 1.07 |

`next start` is **one Node process**, and React server rendering is synchronous work on its
event loop. So the ceiling is `1000 / cpu_ms` ≈ **28–37 pages per second, per process**, and
three of the four cores are idle as far as this application is concerned. Throughput not
moving between concurrency 1 and 32 is that fact seen from outside.

Postgres is *not* the limit at this size, but it is the next thing in line. During the same
reader run the database committed **3 893 transactions for 551 renders — about 7 queries per
page — and returned ~392 rows per render**. Most of those rows are one query: the reader loads
the series' **entire** chapter list for the chapter-select dropdown (`readerChapterList` →
`chapterList`), which for this 306-chapter series is 306 rows on every single request.

---

## One process per core · the fix, measured

The finding above has one fix and it is not subtle: run `next start` once per core. `pnpm start`
and the `web` container now do — `apps/web/scripts/serve.mjs`, `next start` behind Node's
`cluster` module, `WEB_CONCURRENCY` workers sharing one listening socket. One container, one
port, one PID to signal, `reverse_proxy web:3000` unchanged.

Measured **2026-09-05** on the machine above, same build, same seeded catalogue, same Postgres
and Redis, one run immediately after the other:

```sh
node scripts/loadtest.mjs --port 3212 --workers 1 --concurrency 8 --duration 12 --warmup 10 --sweep
node scripts/loadtest.mjs --port 3212 --workers 4 --concurrency 8 --duration 12 --warmup 10 --sweep
```

### The four request paths, 8 concurrent

| path | 1 process | 4 processes | gain | p50 1 → 4 |
| --- | ---: | ---: | ---: | --- |
| `GET /` | 39.0 req/s | **109.6 req/s** | 2.8× | 200.8 → **65.0** ms |
| `GET /series/<slug>` | 23.2 | **63.1** | 2.7× | 347.2 → **115.3** ms |
| `GET /series/<slug>/chapter-1` | 35.1 | **90.4** | 2.6× | 224.6 → **80.4** ms |
| `POST /api/views` | 659.8 | **1 645.3** | 2.5× | 11.3 → **4.0** ms |

Every request answered 200 (202 for the beacon) in both runs. Load average was 5.6 before the
one-process run and 4.8 before the four-process one — see the caveat below.

### The reader at rising concurrency — the flat line, unflattened

| concurrency | 1 process req/s | 4 processes req/s | 1 process p50 | 4 processes p50 |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 29.0 | 30.7 | 33.1 ms | 32.2 ms |
| 2 | 30.1 | 60.9 | 64.0 | 32.3 |
| 4 | 31.0 | 97.7 | 125.1 | 36.9 |
| 8 | 35.4 | 68.6 | 224.1 | 97.4 |
| 16 | 34.5 | 92.0 | 450.3 | 160.3 |
| 32 | 36.7 | **99.3** | 851.6 | **317.6** |

That is the shape the section above described, and its opposite. One process is flat at 29–37
req/s from one reader to thirty-two while p50 climbs 26×. Four processes climb to ~100 req/s
and p50 at thirty-two concurrent readers is **317 ms instead of 852 ms** — the box now
*absorbs* concurrency instead of queueing it. Concurrency 1 is unchanged and always will be:
the cluster distributes *connections*, and one reader is one connection on one worker.

### Where the CPU went

The same comparison with the server's own `utime + stime` read from `/proc`, reader path,
concurrency 16, 20 s:

| web | req/s | server CPU / request | cores busy |
| --- | ---: | ---: | ---: |
| 1 process | 28.8 | 34.7 ms | **1.00** |
| 4 processes | 69.5 | 39.0 ms | **2.71** |

One process pins one core, exactly as the baseline said. Four use 2.7 — not 4.

### Why it is 2.5–3×, not 4×

Worth being precise, because "one per core" invites the expectation of 4× and the honest number
is lower:

- **The load generator is on the same four cores.** A closed-loop client reading ~100 KB
  responses to completion is not free; at these rates it is most of a core. In a real
  deployment it is somebody else's browser. This alone accounts for much of the gap.
- **One Postgres, on the same box, now doing four times the work.** The reader is ~7 queries
  and ~392 rows per render (above), and the chapter-list query is most of that. At ~100
  renders/second that is ~700 queries and ~39 000 rows a second out of one server that is also
  competing for the same four cores. The next thing to fix is still the chapter list.
- **One Redis, on the same box**, for the dedupe claim and the rate-limit counter.
- **The box is shared.** Three other build sessions were running on this host throughout;
  load average never dropped below ~4 on a 4-core machine. Both runs were taken minutes apart
  under the same background, which is what makes the *ratio* meaningful even though the
  absolute numbers are pessimistic. On a dedicated CPX31 they should be better.

### A pool is per process, and Postgres notices

`postgres.js` opens `DATABASE_POOL_MAX` (default **10**) connections **per process**. Four web
processes therefore want 40, the worker another 10 — and during one of these runs Postgres
answered `FATAL: sorry, too many clients already` 95 times while the four workers warmed up
against a server that already had other clients on it. Nothing failed in the measured window,
but the failure mode is worth knowing: it does not appear at boot, it appears on a random
request during the first spike.

The shipped compose Postgres allows 100 connections, which is comfortable at 4 cores and tight
at 8 — `WEB_CONCURRENCY` follows the core count, so a bigger box asks for proportionally more.
`apps/web/scripts/preflight.mjs` does the arithmetic and says so before you boot.

### A correction to the sweep above

The sweep rows in *Where it stops scaling* were taken with one keep-alive pool sized from
`--concurrency` (8), so the 16 and 32 rows were really 8 connections with the extra readers
queued inside the client's agent. `loadtest.mjs` now builds a pool per measurement, sized to
that measurement's concurrency. It does not change that section's conclusion — the flat line is
already flat at concurrency 1 → 8, where sockets were never the constraint — but it does mean
the old 16/32 rows understated both configurations, and the tables above are the ones to quote.

---

## What this means for launch

**A single origin process serves roughly 30 reader pages a second, or ~1 800 a minute. Four —
one per core, which is what ships — serve ~90–110.**

Put a release day against that. A chapter drop that brings 10 000 readers over ten minutes,
each opening about three pages, is 30 000 renders in 600 s — **50 renders/second sustained**.
One process does not carry that; it would sit at ~30/s with a growing queue, and p95 would go
from 300 ms to seconds. Four carry it with room to spare, and did: 90–110/s measured, p95
under 420 ms at 32 concurrent readers.

So, in order of how much they buy you:

1. ~~**Run one web process per core.**~~ **Done** — `apps/web/scripts/serve.mjs`,
   `WEB_CONCURRENCY`, measured in the section above: ~30 → ~90–110 reader pages a second on
   this box, p50 at 32 concurrent readers 852 → 318 ms.

   It is `node:cluster` inside the one container rather than four compose replicas, and that
   choice is worth recording. Replicas would need `deploy.replicas`, dropping the published
   `127.0.0.1:3000:3000` port (a fixed host port cannot be shared by four containers), Caddy
   resolving several upstreams, `docker compose exec web` growing an `--index`, and four
   health checks where there was one. Cluster changes none of that: the primary owns the
   socket and hands connections to the workers, so everything above the container — the
   Caddyfile, the health check, the exec commands, the runbook — is untouched, and one
   Ctrl-C or `docker stop` still takes it all down.

   Nothing in the app prevented it, but three things are *per process* and are now per
   process N times: the view buffer (harmless — the dedupe claim is in Redis and
   `view_events`' primary key is the final word), the 30 s settings/credentials memo and the
   60 s proxy snapshot (a panel save reaches the other workers within that window, not
   instantly), and the database pool (see above). The Redis-less fallbacks for rate limiting
   and view dedupe are also per process, which turns "REDIS_URL is optional locally" into
   "REDIS_URL is required here": N processes mean N × every limit.
2. **Then look at the reader's chapter list.** This is now the top item. At four processes the
   database sees ~700 queries and ~39 000 rows a second for the reader path, most of it the
   chapter-list query, and it grows with the number of chapters a series has — the most
   popular series is by definition the longest one. It does not need a schema change: the
   dropdown only needs id, number, title and lock state, and that list changes when a chapter
   publishes, not per request.
3. **Do not reach for edge caching of HTML.** These pages are `ƒ` (server-rendered per
   request) in the build output for a reason — they carry the viewer's resume position,
   bookmark state and premium entitlements. Caching them at Cloudflare would serve one
   reader's session to another. If origin CPU ever becomes the binding constraint again, the
   answer is to split the personalised parts out of the cached shell, deliberately, not to add
   a cache rule.

**`POST /api/views` is not a launch risk.** 640/s with a p99 of 26 ms, on the same box, while
it was also serving pages. The design in docs/02 — Redis dedupe, in-process buffer, one
multi-row INSERT every two seconds — is doing what it was written to do.

---

## What this does not measure

Worth knowing before quoting the numbers:

- **Signed-in readers.** Everything above is anonymous. A session adds a cookie verification
  and the entitlement lookup per request.
- **Cold start.** The first request after a deploy pays for lazy module loading; the script
  warms each path first, deliberately, because a launch spike hits a warm server.
- **Cloudflare in front.** Real traffic arrives over TLS through the proxy, which adds latency
  the reader feels but no work for the origin.
- **Ad tags.** They render as opaque markup server-side and cost the reader's browser, not this
  box.
- **The worker.** Image encoding is the CPU-heavy half of the platform (docs/18 §0) and it was
  idle throughout. On a release day the worker and the web app compete for the same four
  cores — and now the web app is *four* processes that will each take a whole core if readers
  give them the chance. That is the trade: the origin absorbs a spike, and while it is doing
  so a chapter takes longer to encode. If a release day ever shows the worker starving, lower
  `WEB_CONCURRENCY` to `cores - 1` rather than adding cores to guess.

## Front-end budgets · docs/06's table, measured

`pnpm --filter @palscans/web perf:budget` measures three routes on emulated mid-tier mobile
(Pixel-class viewport, 4× CPU throttle) against a production build. Measured on the machine
above:

| Route | gzipped JS | docs/06 target | over by | CLS (≤0.02) | LCP (≤2.0s) |
|---|---:|---:|---:|---:|---:|
| `/` | 281.9 KB | 110 KB | +171.9 KB | 0.000 | 1.1 s |
| `/series/[slug]` | 282.8 KB | 110 KB | +172.8 KB | 0.005 | 0.55 s |
| reader | 286.4 KB | 60 KB | +226.4 KB | 0.005 | 0.35 s |

**CLS and LCP pass comfortably.** The reader's CLS is 0.005 against a 0.02 budget, which is
the number docs/06 cared most about ("the reader must be ~0"), and LCP has more than five
times the headroom the budget allows.

**The JS budgets do not pass, and are missed by 2.6× on the home page and 4.8× on the
reader.** Nearly all of it is one shared client runtime: thirteen files, of which two account
for over half the bytes, loaded identically on all three routes. The per-route figures barely
differ, which is the tell — this is not the reader shipping too much reader code, it is every
route paying for the same baseline. One of the large chunks contains `zod`, which suggests a
schema module reachable from a client component; that is the first thing to pull on.

### Why CI gates a ceiling rather than the target

The check enforces a **ceiling** of 300 KB — today's number plus headroom — and prints the
docs/06 target beside it with the distance still owed. Gating on the target itself would
paint CI red on its first run for a gap nobody can close in one change, and docs/06 already
names that failure mode: *"A budget nobody enforces is a wish."* A budget that is red from
day one is switched off within a week, which is the same wish with extra steps.

So the ceiling stops the bundle growing while the target stays visible on every run. **Lower
the ceiling whenever a change earns it.** When it reaches the docs/06 numbers, delete it and
gate on the target.

LCP is reported rather than gated, because it moves with CPU contention on a shared runner.
`PERF_STRICT=1` gates it, and should be set on a dedicated one.

## Re-running it

```sh
pnpm --filter @palscans/web build
pnpm --filter @palscans/web exec node scripts/loadtest.mjs \
  --concurrency 8 --duration 20 --sweep
```

Useful flags: `--workers N` (web processes to start; default is the core count, `1` is the
baseline above), `--port` (default 3205), `--url` to measure a server you started yourself,
`--series <slug>` to pin the title, `--view-ips N` for how many distinct reader addresses the
beacon phase uses, and `--json`.

One side effect worth knowing: the beacon phase writes real `view_events` rows — one per
distinct address, so `--view-ips 256` leaves at most 256 rows behind. They are subject to the
usual 90-day partition retention and roll into the daily stats like any other view.
