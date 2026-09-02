# 09 — Migrating off the existing Madara site

You already run a Madara theme. The plan is **not** to throw it away and **not** to build on
top of it. It stays live and earning while the new platform is built beside it, and a
repeatable importer moves the data across.

## Why not build on Madara

| | Madara / WordPress | Bespoke |
|---|---|---|
| Chapter page storage | `wp_postmeta` — an EAV key-value table. 500 chapters × 35 pages ≈ 17.5k rows for **one** series; a 3,000-series catalog reaches eight figures in a table WordPress joins on nearly every query | Two purpose-built tables with composite primary keys and covering indexes |
| Reader performance | PHP renders each view; needs Varnish or LiteSpeed cache in front and still degrades under a new-chapter spike | Static/ISR HTML from the edge; the origin is untouched during a spike |
| Attack surface | Theme + a dozen plugins, each an update treadmill. Nulled builds in this niche are a well-known malware vector | Your dependencies, audited in CI |
| Customising the reader | Fighting theme templates and hooks; every update risks the overrides | It is your component |
| Subscriptions | WooCommerce Subscriptions plus glue plugins | Stripe Billing directly, two tiers, one webhook |
| Differentiation | Instantly recognisable as a Madara site | Yours |

Asura ran Madara, publicly migrated off it, and rebuilt bespoke. That is the most relevant
data point available, and it came from someone with your exact catalog shape.

**The honest counter-argument:** Madara works *today* and the rebuild is roughly 10–14 weeks.
That is precisely why the old site keeps running until cutover.

## Discover the actual schema first

Madara's storage has changed materially across versions — older installs keep chapters in
serialised postmeta, newer ones use custom tables, and image storage can be the WP media
library or a folder under `wp-content/uploads`. **Do not write the importer against
assumptions.** Run discovery against your own database and pin the mapping to what you find:

```sql
-- 1. Which custom tables does the theme own?
SELECT table_name, table_rows
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name LIKE '%manga%'
ORDER BY table_rows DESC;

-- 2. Confirm the series post type and its volume
SELECT post_type, post_status, COUNT(*)
FROM wp_posts GROUP BY post_type, post_status ORDER BY 3 DESC;

-- 3. Which meta keys carry the series fields, and how big is the table?
SELECT meta_key, COUNT(*) AS n
FROM wp_postmeta
WHERE post_id IN (SELECT ID FROM wp_posts WHERE post_type = 'wp-manga')
GROUP BY meta_key ORDER BY n DESC LIMIT 60;

-- 4. Taxonomies in use
SELECT taxonomy, COUNT(*) FROM wp_term_taxonomy GROUP BY taxonomy;

-- 5. Sample one chapter's storage end to end, then read the raw value
SELECT * FROM wp_postmeta
WHERE post_id = <a known series id> AND meta_key LIKE '%chapter%' LIMIT 5;
```

Then check where the bytes live:

```bash
du -sh wp-content/uploads/*
find wp-content/uploads -type d -name '*manga*' | head
```

Write the findings into `infra/migration/SOURCE-SCHEMA.md` before writing any code. That
document is the importer's specification.

## Mapping

Once discovery confirms the shapes, the mapping is mechanical:

| Madara / WordPress | New schema |
|---|---|
| `wp_posts` rows of the series post type | `series` (`post_name` → `slug`, `post_title` → `title`, `post_content` → `synopsis`, `post_date_gmt` → `created_at`) |
| series meta: status, type, alternative titles, adult flag, views | `series.status`, `series.type`, `series_titles[]`, `series.age_rating`, `series.view_count` |
| genre / tag taxonomies | `genres` + `series_genres` |
| author / artist taxonomies | `people` + `series_people` with `credit` |
| chapter records (custom table or postmeta) | `chapters` — parse the display name into `numeric` `number` + `title` |
| chapter image list (attachment ids or file paths) | `chapter_pages`, one row per page, `idx` from the stored order |
| WP users | `users` — carry `user_email`, `user_registered`; **do not** carry `user_pass` |
| user bookmarks / reading lists | `bookmarks` |
| ratings | `ratings`, plus recomputed `rating_sum` / `rating_count` |
| `wp_comments` on series posts | `comments` — convert stored HTML to the structured JSON body |

### Two mappings that need care

**Chapter numbers.** Madara stores a display string (`"Chapter 154"`, `"Ch.12.5"`,
`"Chapter 7 - The End"`). Parse with a strict regex into `number numeric(10,3)` plus a
`title` remainder, and **write every unparsed row to a review CSV** rather than guessing.
Expect 1–3% to need a human. Getting this wrong silently reorders a reader's chapter list,
which is the one bug your audience will not forgive.

**Passwords.** WordPress uses phpass (or bcrypt on very recent versions); the new stack uses
Argon2id. Do not attempt to convert hashes. Import the accounts with `password_hash = NULL`
and email every user a one-time set-password link at cutover, with Google sign-in offered as
the faster path. Announce it a week ahead. Losing a fraction of dormant accounts is the
correct trade against carrying a legacy hash format forever.

## Images

Do **not** re-download images through the public site — you will rate-limit yourself.

1. `rsync` the uploads directory to the machine running the importer.
2. Feed files straight into the `chapter.process` worker (`03-image-pipeline.md`), which
   re-encodes to AVIF + WebP at four widths, strips metadata, and records intrinsic
   dimensions.
3. A 3,000-series catalog is on the order of 3–5 million images. On a 4-core box at roughly
   8 images/second that is ~5 days of wall clock. Start it in week 3 and let it run; it is
   idempotent and resumable, so it can be interrupted freely.
4. Content-addressed keys mean re-running the importer never duplicates storage.

Expect the re-encode to **shrink** total storage 35–50% versus the original JPEG/PNG set.

## Cutover

The importer is written in **week 2**, not at the end, and is run repeatedly against live
data throughout the build. By cutover it has run twenty times and the last run is boring.

```
T-14d  Full import into staging. Spot-check 100 random series against the live site.
T-7d   Announce the migration and the password reset. Freeze new features.
T-3d   Import again. Verify counts: series, chapters, pages, users, bookmarks, comments.
T-1d   Final delta import. Lower DNS TTL to 60s.
T-0    Put Madara in read-only (maintenance plugin). Final delta import. Flip DNS.
       Keep the old stack running on old.site.com for 30 days, unindexed.
T+0    301 every legacy URL to its new equivalent. This is not optional.
T+7d   Verify Search Console coverage and index status; watch 404 reports daily.
T+30d  Decommission the old stack once traffic and rankings are stable.
```

### URL preservation

Your organic traffic is in the existing URLs. Build a `redirects` table mapping every legacy
path to its new one and serve 301s from middleware — not a regex guess, a row per URL
generated by the importer from the source data.

```
/manga/<slug>/                     → /series/<slug>
/manga/<slug>/chapter-<n>/         → /series/<slug>/<n>
/manga-genre/<slug>/               → /genres/<slug>
/?s=<query>                        → /search?q=<query>
```

Keep the sitemap pointed at the new URLs from day one and resubmit it at T+0. Losing
rankings during a migration is almost always a redirect failure, and it is entirely
preventable.

## Rollback

Until T+7, rollback is a DNS flip back to the old stack, which is still running and still
has its data. That is the reason the old site is not decommissioned on cutover day.
