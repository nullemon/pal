# PALScans runbook

Short, ordered, copy-pasteable. Every step that changes data or config also writes an
`audit_log` row where the admin panel supports it; note the rest in the ops channel.

## Restore

Every compose command below wants `--env-file .env`, run from `/opt/palscans`. Without it
compose looks for `infra/.env`, finds nothing, and stops on a missing variable. Set
`alias dc='docker compose --env-file .env -f infra/docker-compose.yml'` and the commands read
as `dc …`.

### 0 · Before Postgres: the sealing key

**`CREDENTIALS_KEY` must be the same string it was when the dump was taken.** This is the step
that gets skipped, and skipping it produces the worst possible failure: a site that comes back
up looking perfectly healthy with everything switched off.

The credentials in the panel — R2 keys, SMTP, OAuth, Stripe, Turnstile, VAPID, the Discord
token — are stored in `app_credentials` sealed with AES-256-GCM under a key derived from
`CREDENTIALS_KEY` (or `SESSION_SECRET` if that is unset). A row that will not decrypt is
**dropped**, not reported: `readSealedCredentialsDetailed()` in `packages/db/src/credentials.ts`
returns it as absent, and every consumer then falls back to the environment — which on a
rebuilt host is empty. So with the wrong key:

- `/api/health` returns `{"status":"ok"}`. The uptime monitor stays green.
- HTML renders. **Silently off:** no mail is sent (so no verification and no password reset),
  OAuth sign-in fails, Stripe webhooks fail their signature check, web push and Discord
  announcements stop. Nothing logs a cause; each one simply reads as "not configured".
- **Loudly off:** two consumers deliberately fail closed on an *unreadable* row rather than
  treating it as absent, and these are the ones you will notice first — storage keeps the
  `s3` driver with no bucket or endpoint (`lib/config/snapshot.ts`) so images do not load and
  uploads error, and Turnstile rejects every submission (`lib/auth/turnstile.ts`) so sign-up
  and commenting stop working. Those two are the tell, not the problem.
- **Integrations still shows the reassuring green *Sealed with CREDENTIALS_KEY* banner** — it
  reports where the key came from, not whether it opens anything.

How to spot it in ten seconds: on **Admin → System → Integrations**, every field you know you
configured shows its source as **env** or **unset** rather than **panel**, while the rows are
still there in the database:

```sh
dc exec postgres psql -U pal -d palscans -tAc "select count(*) from app_credentials"
```

Non-zero count plus "unset" everywhere means the key is wrong. There is no re-key command;
the fix is to find the original key, or re-enter every credential by hand.

**Where the key lives.** In `/opt/palscans/.env` on the server, which is exactly the file a
dead server takes with it — so it must also exist somewhere else:

- your password manager, in the same entry as the R2 keys, labelled with the deployment it
  belongs to;
- and nowhere in this repository, any image, or any backup that a leaked dump would come with.
  (Keeping it *inside* the database backup would defeat the encryption it provides.)

Read it off a host that is still running with
`dc exec web printenv CREDENTIALS_KEY`, and do that **now**, before you need it.

Write it into `.env` on the new host before starting anything.

### 1 · Database

The nightly job (docs/18 §9) writes a **custom-format** dump — `pg_dump --format=custom` — to
the `palscans-backups` bucket under `pg/`. `pg_restore` cannot read a plain SQL dump; if
`pg_restore -l <file>` says *"input file appears to be a text format dump"*, you have the
wrong format and no amount of restore flags will help (`psql -f` reads that one instead).

```sh
cd /opt/palscans
rclone copyto r2-backups:palscans-backups/pg/palscans-YYYY-MM-DD.dump /tmp/restore.dump
# sanity: it is a real custom-format archive (run in the container — the host needs no
# postgres client tools)
dc exec -T postgres pg_restore -l < /tmp/restore.dump | head -3

dc stop web worker

# nothing may be connected to the database while it is dropped
dc exec -T postgres psql -U pal -d postgres -c \
  "select pg_terminate_backend(pid) from pg_stat_activity
     where datname = 'palscans' and pid <> pg_backend_pid()"

dc exec -T postgres \
  pg_restore -U pal -d postgres --clean --create --exit-on-error < /tmp/restore.dump

dc start worker web
```

`--clean --create` connects to the `postgres` maintenance database and has `pg_restore` drop
and recreate `palscans` itself. **Do not use `--clean --if-exists` against the live database**:
it drops objects one at a time, and one of those drops is illegal — `view_events` is
partitioned (`packages/db/drizzle/0003_view_events_partition.sql`), so
`ALTER TABLE ... view_events_default DROP CONSTRAINT ... view_events_default_pkey` fails with
`cannot drop inherited constraint`. The data still lands, but the command prints an error and
exits 1, which under `set -e` aborts your script and in front of a person at 3am reads as a
failed restore. The commands above exit 0 with no output.

If `DROP DATABASE` still reports *"is being accessed by other users"*, something reconnected:
re-run the terminate statement and the restore together, or `dc stop web worker` again first.

**Cautious variant** — restore beside the live database and swap, so you can count rows before
throwing anything away:

```sh
dc exec -T postgres psql -U pal -d postgres -c "create database palscans_new owner pal"
dc exec -T postgres pg_restore -U pal -d palscans_new --exit-on-error < /tmp/restore.dump
dc exec -T postgres psql -U pal -d palscans_new -tAc \
  "select (select count(*) from series), (select count(*) from chapters)"
# looks right? then swap (both renames need no connections to either database)
dc stop web worker
dc exec -T postgres psql -U pal -d postgres \
  -c "alter database palscans rename to palscans_old" \
  -c "alter database palscans_new rename to palscans"
dc start worker web
# once the site is confirmed good — it is a full second copy on the same disk:
dc exec -T postgres psql -U pal -d postgres -c "drop database palscans_old"
```

### 2 · Object storage

**R2 has no object versioning** — `GetBucketVersioning` and `PutBucketVersioning` are both on
Cloudflare's unimplemented list — so there is nothing to roll back to inside the bucket and a
deleted object is gone. The only object backup is the copy you make yourself, into the private
backups bucket from docs/18 §2:

```sh
# on a schedule (weekly is usually enough — the keys are content-addressed, so this is
# almost pure append and re-runs transfer nothing)
rclone sync r2:palscans/covers  r2-backups:palscans-backups/objects/covers
rclone sync r2:palscans/banners r2-backups:palscans-backups/objects/banners
rclone sync r2:palscans/pages   r2-backups:palscans-backups/objects/pages
rclone sync r2:palscans/avatars r2-backups:palscans-backups/objects/avatars

# to restore one prefix
rclone copy r2-backups:palscans-backups/objects/pages/<seriesId> r2:palscans/pages/<seriesId>
```

Use `sync`, not `copy`, only if you accept that a deletion propagates to the backup — with
`sync` a title you take down is also removed from the backup on the next run, which is what
you want after a DMCA notice and not what you want after a mistake. If unsure, use `copy`.

If nothing like this is scheduled, you have no object backup and the paragraph above is the
whole story. Images are content-addressed, so a restored file is byte-identical and the CDN
cache needs no purge.

### 3 · Verify

- `curl -s https://palscans.org/api/health` → `{"status":"ok","db":"up",…}`
- `/` loads; a recent chapter's pages render **from `cdn.palscans.org`** (if they do not, go
  back to step 0 — this is the sealing-key symptom)
- **Admin → System → Integrations**: every section you configured reads source **panel**, and
  its **Test** passes. Storage first.
- `/admin` dashboard shows the last publish; `dc logs worker` shows the scheduler ticking.

## Rotate secrets

Most credentials now live in **Admin → System → Integrations**, not the environment
(docs/19-credentials.md), so rotating them is a panel edit and needs no deploy.

1. **Storage keys**: create the new R2 key pair, paste it into Integrations → Storage, press
   **Test** to confirm it can write and read back, save, then delete the old key at
   Cloudflare. The worker picks the change up within **30 seconds**, or immediately on restart
   (`CREDENTIAL_TTL_MS`, `apps/worker/src/lib/config.ts`; the web app's memo in
   `apps/web/lib/config/store.ts` is the same 30s).
2. **OAuth, Stripe, Resend, Turnstile, Discord, VAPID**: rotate at the provider, paste into
   the matching panel section, save. For Stripe, re-verify the webhook signing secret with a
   test event afterwards.
3. `SESSION_SECRET`: set the new value, deploy. Every session is invalidated; announce it.
   **Check `CREDENTIALS_KEY` is set first.** If it is not, the sealing key is derived from
   `SESSION_SECRET`, and rotating it makes every stored credential unreadable — they fall
   back to the environment (usually meaning "not configured") and must be re-entered. The
   Integrations screen shows which key is in use.
4. `CREDENTIALS_KEY` itself: there is no re-key command. Rotating it means re-entering the
   credentials in the panel. Note them somewhere first, or rotate during a quiet window.
5. **Postgres password**: `ALTER USER pal PASSWORD '…'`, update `DATABASE_URL` for web and
   worker, restart both.

Secrets live in the deploy environment and in your password manager — never in the repo, the
image, or a database backup. `CREDENTIALS_KEY` is the one that must survive the server itself:
see **Restore → 0 · Before Postgres: the sealing key**.

## Take down a title

**First, write down both identifiers.** You need them and they are not interchangeable:
open the series in the panel and read them off the URL and the editor —
`/admin/series/1284` gives the **numeric id**, the Details tab gives the **slug**.
Cover and banner objects are keyed by *slug*; page objects are keyed by *numeric ids*.
Purging `/pages/<slug>/…` purges nothing at all, which is not what you want to discover in
the middle of a DMCA response.

1. **Admin → Series → the title → Visibility tab → Delete** (the red button with the bin
   icon, at the bottom of the tab). It soft-deletes: `DELETE /api/admin/series/:id` sets
   `deleted_at`, writes a `series.delete` audit row, and nothing is hard-deleted. The toast
   offers **Undo**, and a **Restore** link stays in the editor header afterwards.

   There is no *Unpublish* button. The **State** select on the same tab
   (draft / scheduled / published / unlisted / removed) controls publication and does **not**
   set `deleted_at` — it is for "hide while I work on it", not for a legal takedown, and it
   leaves the series in the normal admin list rather than the trash.

   Timing: the delete purges the `catalog` cache tag immediately, so listings, search and the
   reader stop resolving it on the next request. Anything that is only time-revalidated
   catches up within 5 minutes (`CATALOG_REVALIDATE`).

2. **If the notice demands the files gone, delete the objects.** A cache purge only empties
   Cloudflare's copy; the bytes stay in R2 and the next request re-caches them. Delete first,
   purge second:

   ```sh
   rclone delete r2:palscans/pages/<numeric id>/     # every page image, every chapter
   rclone delete r2:palscans/uploads/<numeric id>/   # the raw originals you uploaded
   rclone delete r2:palscans/covers/<slug>/
   rclone delete r2:palscans/banners/<slug>/
   ```

   `uploads/` is the one people forget. It holds the un-re-encoded originals of every page and
   is never cleaned up on its own.

3. **Purge the CDN.** Dashboard → Caching → Configuration → **Purge Cache** →
   *Custom Purge* → **Prefix**, one per line (purge by prefix is available on every plan, max
   100 prefixes per request, and the prefix is `host/path` — no scheme, no wildcard):

   ```
   cdn.palscans.org/pages/<numeric id>
   cdn.palscans.org/covers/<slug>
   cdn.palscans.org/banners/<slug>
   ```

   `uploads/` is not in that list on purpose: the WAF rule in docs/18 §2 blocks it at the
   edge, so it was never publicly cached. Step 2 is still what removes those files.

   Then check one URL you know was cached: it should answer 404 (deleted) or 403 (blocked by
   the WAF rule), not 200.

4. Record the request (DMCA form or email) in whatever you keep takedowns in. Step 1 already
   wrote a `series.delete` row to `audit_log` with your user id and the time — check it under
   **Admin → System → Audit log** and note the notice reference alongside it; that row is the
   timestamp you will quote back.
5. Reply to the sender with the time of removal.

Reinstating a series that was only deleted in step 1 is the **Restore** link in the editor
header — the header reads *Series moved to trash · Restore*. To find it again later, tick the
**Deleted** checkbox in the filter bar on Admin → Series. Slug history keeps the old URLs valid.
If you also ran step 2, the images are gone for good and the chapters have to be re-uploaded —
R2 has no versioning and no undelete.

## Roll back a deploy

**There is no registry and there are no pushed images.** `infra/docker-compose.yml` gives
`web` and `worker` a `build:` block and no `image:` key, CI (`.github/workflows/ci.yml`) lints,
tests and builds but publishes nothing, and there is no deploy script. `docker compose pull`
has nothing to pull. Rolling back means checking out the previous commit and rebuilding on the
server, which takes as long as a deploy does — a few minutes, not seconds.

```sh
cd /opt/palscans
git log --oneline -10                    # find the commit you were on
git checkout <previous sha>              # detached HEAD — that is fine and expected
dc up -d --build web worker
dc logs -f --tail=50 web                 # watch it come up
```

To go forward again afterwards: `git checkout main && git pull && dc up -d --build web worker`.
Do not `git pull` while detached; it will not do what you want at 3am.

To make the next rollback fast, **tag the image before you build over it**. Compose names its
built images `palscans-web` and `palscans-worker` (from `name: palscans` in the compose file)
and overwrites them on every `--build`, so the previous one is gone unless you kept a name for
it:

```sh
# before deploying
SHA=$(git rev-parse --short HEAD)
docker image tag palscans-web    "palscans-web:$SHA"
docker image tag palscans-worker "palscans-worker:$SHA"

# to roll back to it later, without rebuilding
docker image tag "palscans-web:$OLD_SHA"    palscans-web
docker image tag "palscans-worker:$OLD_SHA" palscans-worker
dc up -d web worker                      # no --build: compose reuses the tagged image
```

Keep the last two or three; `docker image prune` will take anything untagged.

**The database does not roll back with the app.** Migrations have no down step, and nothing
runs one. In practice an older app does start against a newer schema — the two migrations that
drop anything (`0003_view_events_partition.sql`, `9014_rating_counter_safety.sql`) recreate the
object inside the same file, so no column the previous release reads disappears. But that is a
property of the migrations written so far, not a guarantee. If a migration itself is the
problem, restore the pre-deploy dump (see **Restore** above) rather than writing a down
migration in a hurry — and take that dump *before* every deploy that includes a new file in
`packages/db/drizzle/`:

```sh
dc exec -T postgres pg_dump -U pal -d palscans --format=custom --compress=9 \
  > /var/backups/palscans/pre-deploy-$(date -u +%FT%H%M).dump
```

Verify: `/`, one series page, one chapter, `/admin` — then watch error rate for 10 minutes.
