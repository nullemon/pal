# 09 — Migrating off the existing WordPress site

You already run a legacy theme. The plan is **not** to throw it away and **not** to build on
top of it. It stays live and earning while the new platform is built beside it, and a
repeatable importer moves the data across.

## Why not build on the legacy theme

| | WordPress (legacy) | Bespoke |
|---|---|---|
| Chapter page storage | `wp_postmeta` — an EAV key-value table. 500 chapters × 35 pages ≈ 17.5k rows for **one** series; a 3,000-series catalog reaches eight figures in a table WordPress joins on nearly every query | Two purpose-built tables with composite primary keys and covering indexes |
| Reader performance | PHP renders each view; needs Varnish or LiteSpeed cache in front and still degrades under a new-chapter spike | Static/ISR HTML from the edge; the origin is untouched during a spike |
| Attack surface | Theme + a dozen plugins, each an update treadmill. Nulled builds in this niche are a well-known malware vector | Your dependencies, audited in CI |
| Customising the reader | Fighting theme templates and hooks; every update risks the overrides | It is your component |
| Subscriptions | WooCommerce Subscriptions plus glue plugins | Stripe Billing directly, two tiers, one webhook |
| Differentiation | Instantly recognisable as a template-theme site | Yours |

Asura ran the same class of WordPress theme, publicly migrated off it, and rebuilt bespoke. That is the most relevant
data point available, and it came from someone with your exact catalog shape.

**The honest counter-argument:** the old site works *today* and the rebuild is roughly 10–14 weeks.
That is precisely why the old site keeps running until cutover.

## Confirmed against your own theme package

The `Sample Data.zip` you uploaded contains the legacy theme's demo WordPress export, and
`Installation Files.zip` pins the version: **version 1.7.4.1** of the legacy theme with its core plugin at the same version.
That is recent enough that chapters live in the plugin's **custom database tables**, not in
postmeta — which is good news for the importer and confirmed by their absence from the
export. Series, taxonomies, and series metadata are all in the standard WordPress tables.

Confirmed from the export:

| What | Where |
|---|---|
| Series | `wp_posts` with `post_type = 'wp-manga'` |
| Bookmarks | `wp_posts` with `post_type = 'manga-bookmark'`, payload in `_bookmark_data` / `_bookmark_time` |
| Genres | taxonomy `wp-manga-genre` |
| Authors / artists | taxonomies `wp-manga-author`, `wp-manga-artist` |
| Tags | taxonomy `wp-manga-tag` |
| Release year | taxonomy `wp-manga-release` |
| Type (manga/manhwa/manhua) | meta `_wp_manga_type` |
| Status | meta `_wp_manga_status` |
| Alternative titles | meta `_wp_manga_alternative` |
| Stable id across renames | meta `manga_unique_id` |
| View counters | meta `_wp_manga_views`, `_wp_manga_day_views`, `_wp_manga_week_views`, `_wp_manga_month_views`, `_wp_manga_year_views` |
| Ratings | meta `_manga_reviews`, `_manga_avarage_reviews` (the misspelling is theirs — match it exactly) |
| Badges | meta `manga_title_badges` |
| Cover | meta `_thumbnail_id` → `wp_posts` attachment → `_wp_attached_file` |

`manga_unique_id` is the key to import against: it survives slug and title changes, so
re-running the importer updates the right row instead of creating duplicates.

## Confirm the chapter tables on your live database

Chapters are the one thing the demo export does not carry, so read them from your own
install before writing that half of the importer:

```sql
-- Which custom tables does the plugin own, and how big are they?
SELECT table_name, table_rows
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name LIKE '%manga%'
ORDER BY table_rows DESC;

-- Then dump the shape of each one it names
SHOW CREATE TABLE wp_manga_chapters;

-- And sample a real chapter end to end
SELECT * FROM wp_manga_chapters LIMIT 5;
```

Then find where the bytes live — the theme can store pages in the media library or in its own
uploads folder:

```bash
du -sh wp-content/uploads/* | sort -h | tail
find wp-content/uploads -type d -iname '*manga*' | head
```

Write the results into `infra/migration/SOURCE-SCHEMA.md`. That file is the importer's
specification, and the mapping below is already pinned for everything except chapters.

## Mapping

Once discovery confirms the shapes, the mapping is mechanical:

| WordPress (legacy) | New schema |
|---|---|
| `wp_posts` where `post_type='wp-manga'` | `series` (`post_name`→`slug`, `post_title`→`title`, `post_content`→`synopsis`, `post_date_gmt`→`created_at`) |
| `_wp_manga_status`, `_wp_manga_type`, `_wp_manga_alternative`, `_wp_manga_views` | `series.status`, `series.type`, `series_titles[]`, `series.view_count` |
| `wp-manga-genre`, `wp-manga-tag` | `genres` + `series_genres` (`kind` distinguishes them) |
| `wp-manga-author`, `wp-manga-artist` | `people` + `series_people` with `credit` |
| `wp_manga_chapters` (custom table, v1.7.x) | `chapters` — parse the display name into `numeric` `number` + `title` |
| chapter image list (attachment ids or file paths) | `chapter_pages`, one row per page, `idx` from the stored order |
| WP users | `users` — carry `user_email`, `user_registered`; **do not** carry `user_pass` |
| `post_type='manga-bookmark'` + `_bookmark_data` | `bookmarks` |
| `_manga_reviews` / `_manga_avarage_reviews` | `ratings`, plus recomputed `rating_sum` / `rating_count` |
| `wp_comments` on `wp-manga` posts | `comments` — convert stored HTML to the structured JSON body |

### Two mappings that need care

**Chapter numbers.** The theme stores a display string (`"Chapter 154"`, `"Ch.12.5"`,
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
T-0    Put the old site in read-only (maintenance plugin). Final delta import. Flip DNS.
       Keep the old stack running on old.palscans.org for 30 days, unindexed.
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
/manga/<slug>/chapter-<n>/         → /series/<slug>/chapter-<n>
/manga-genre/<slug>/               → /genres/<slug>
/?s=<query>                        → /search?q=<query>
```

(The reader route is `chapter-<n>`; a 301 into a 404 is worse than the shorthand.)
Keep the sitemap pointed at the new URLs from day one and resubmit it at T+0. Losing
rankings during a migration is almost always a redirect failure, and it is entirely
preventable.

## Rollback

Until T+7, rollback is a DNS flip back to the old stack, which is still running and still
has its data. That is the reason the old site is not decommissioned on cutover day.
