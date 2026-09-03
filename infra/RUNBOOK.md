# PALScans runbook

Short, ordered, copy-pasteable. Every step that changes data or config also writes an
`audit_log` row where the admin panel supports it; note the rest in the ops channel.

## Restore

**Database** (nightly `pg_dump` in R2 under `backups/pg/`, plus WAL when configured):

```sh
docker compose -f infra/docker-compose.yml stop web worker
docker compose -f infra/docker-compose.yml exec -T postgres \
  pg_restore -U pal -d palscans --clean --if-exists < backups/palscans-YYYY-MM-DD.dump
docker compose -f infra/docker-compose.yml start worker web
```

**Object storage**: R2 keeps versioning on `covers/` and `pages/`; restore a prefix with
`rclone copy r2:palscans-backup/<prefix> r2:palscans/<prefix>`. Images are content-addressed,
so a restored file is byte-identical and the CDN cache needs no purge.

Verify: `/` loads, a recent chapter's pages render, `/admin` dashboard shows the last publish.

## Rotate secrets

Most credentials now live in **Admin → System → Integrations**, not the environment
(docs/19-credentials.md), so rotating them is a panel edit and needs no deploy.

1. **Storage keys**: create the new R2 key pair, paste it into Integrations → Storage, press
   **Test** to confirm it can write and read back, save, then delete the old key at
   Cloudflare. The worker picks the change up within 5 minutes, or immediately on restart.
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

Secrets live only in the deploy environment (never in the repo or the image).

## Take down a title

1. Admin → Series → the title → **Unpublish** (sets `deleted_at`; nothing is hard-deleted).
   Chapters, pages, feeds and sitemaps stop referencing it within one ISR window (≤ 5 min).
2. Purge the CDN for `/covers/<series>/*` and `/pages/<series>/*` if the notice requires
   removal of the files, not only the pages.
3. Record the request (DMCA form or email) on the series record and in `audit_log`.
4. Reply to the sender with the time of removal.

Reinstating is the same button; slug history keeps the old URLs valid.

## Roll back a deploy

Images are tagged by git SHA.

```sh
export TAG=<previous sha>
docker compose -f infra/docker-compose.yml pull web worker   # or build with the old tag
docker compose -f infra/docker-compose.yml up -d web worker
```

Database migrations are additive (new columns, new tables, no drops), so an older app runs
against a newer schema. If a migration must be undone, restore from the pre-deploy dump
taken by the deploy script rather than writing a down migration in a hurry.

Verify: `/`, one series page, one chapter, `/admin` — then watch error rate for 10 minutes.
