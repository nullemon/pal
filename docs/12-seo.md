# 12 — SEO

Organic search is the growth channel for a site like this: series pages and genre pages
are the landing surfaces, and a new title's first hundred readers usually arrive from a
search for its name. SEO is therefore built into the rendering layer and exposed as admin
settings, not sprinkled in by a plugin afterwards.

Every setting below is editable in **Admin → System → SEO** without a deploy.

## 1. URL design

```
/                                   home
/series/<slug>                      series page          (canonical landing surface)
/series/<slug>/chapter-<n>          chapter reader       (n = numeric chapter, 12.5 allowed)
/genres/<slug>                      genre landing page   (indexable, with its own copy)
/browse?type=manhwa&status=ongoing  filtered catalog     (canonical → /browse; params noindex)
/rankings                           weekly / monthly / all-time
/announcements/<slug>
/u/<username>                       public profile       (noindex by default)
/search?q=                          noindex
```

Rules: lowercase, hyphenated, ASCII slugs generated from the title with a collision suffix
(`-2`) rather than an id; no trailing slashes (301 the variant); one canonical host
(`https://palscans.org`, `www` 301s to it). **Slugs never break links**: renaming a series
writes the old slug to `slug_history`, and the router 301s old → new forever.

## 2. Per-page metadata

Rendered server-side on every page — never injected by client JavaScript, which is how
"the title is right in the browser but wrong in Google" happens.

| Page | `<title>` template (default) | Description template (default) |
|---|---|---|
| Home | `{site} — Read Manhwa, Manga and Manhua Online` | `Read the latest manhwa, manga and manhua chapters on {site}, updated daily. Free, fast, mobile-friendly.` |
| Series | `{title} — Read Online Free · {site}` | `Read {title} {type} online. {chapter_count} chapters, latest {latest_chapter}. {synopsis:160}` |
| Chapter | `{title} Chapter {chapter} · {site}` | `Read {title} Chapter {chapter} online free at {site}. {next_prev_hint}` |
| Genre | `{genre} Manhwa & Manga — Read Online · {site}` | `Browse {count} {genre} series on {site}. {intro:160}` |
| Rankings | `Top Manhwa & Manga This Week · {site}` | … |
| Announcement | `{title} · {site}` | `{excerpt:160}` |

Variables: `{site}`, `{title}`, `{type}`, `{chapter}`, `{chapter_count}`, `{latest_chapter}`,
`{genres}`, `{author}`, `{year}`, `{synopsis:N}` (truncated at a word boundary), `{genre}`,
`{count}`, `{intro:N}`. Templates are editable per page type in admin; every series, genre
and announcement can also override its own title and description outright.

Also on every page: `<link rel="canonical">`, Open Graph (`og:title`, `og:description`,
`og:image` at 1200×630, `og:type`), Twitter card (`summary_large_image`), `robots` meta
derived from the visibility rules below, `theme-color`, and on chapter pages
`<link rel="prev">` / `<link rel="next">`. Cover images have `alt="{title} cover"`; reader
pages have `alt="{title} Chapter {chapter} page {n}"`.

## 3. Rich SEO text

Thin pages don't rank. Three places carry real, unique copy:

- **Genre landing pages** — an admin-written intro (rich text, ~150–400 words) rendered
  above the grid, plus an optional FAQ block rendered as `FAQPage` JSON-LD. This is the
  single highest-value SEO surface on the site and it is empty on most competitors.
- **Series pages** — the synopsis, alternative titles (they are what people search for),
  author/artist, genres, and an optional **"About {title}"** rich-text block below the
  chapter list where staff can write a paragraph on the story, adaptation, or release
  schedule. A per-series *focus keyword* field lights up a checklist in the editor (in
  title? in description? in H1? in the first 100 words?).
- **Chapter pages** — auto-generated but unique: `H1 = {title} Chapter {chapter}`, a
  breadcrumb, the chapter title if any, "Previous / Next" links with anchor text, and a
  one-line generated summary ("Chapter 301 of Return of the Frost Monarch, released
  {date}"). Whether chapter pages are indexed at all is a toggle (see §6).

Rich text is stored as structured JSON and rendered to semantic HTML — headings, lists,
links — never as raw HTML pasted into a textarea.

## 4. Structured data (JSON-LD)

Emitted server-side as one `<script type="application/ld+json">` per page, from typed
builders so the shape cannot drift:

| Page | Types |
|---|---|
| Every page | `Organization` (name, logo, `sameAs` → Discord, X, Instagram, Reddit, YouTube, Facebook) · `WebSite` with `SearchAction` (`/search?q={search_term_string}`) |
| Series | `BreadcrumbList` · `ComicSeries` (name, alternateName[], author, illustrator, genre[], numberOfEpisodes, datePublished, image, `aggregateRating` with `ratingValue` rounded to one decimal and **`ratingCount` = real rating count**, not bookmarks) |
| Chapter | `BreadcrumbList` · `ComicIssue` (issueNumber, name, isPartOf → the series, datePublished, image = first page) |
| Genre / Rankings | `BreadcrumbList` · `ItemList` of the top entries (position, url, name) · `FAQPage` when a FAQ block exists |
| Announcement | `Article` (headline, datePublished, dateModified, author, image) |

Every builder is unit-tested against Google's Rich Results schema, and the admin SEO page
has a "Validate" button that renders any URL's JSON-LD and runs the same checks.

## 5. Sitemaps

A sitemap index at `/sitemap.xml` pointing at gzipped child sitemaps, each capped at
50,000 URLs / 50 MB per the protocol:

```
/sitemap.xml                        index
/sitemaps/pages.xml.gz              home, browse, rankings, genres index, static pages
/sitemaps/series-<n>.xml.gz         all published series, lastmod = last_chapter_at
/sitemaps/chapters-<n>.xml.gz       published chapters, newest first (omitted when chapter indexing is off)
/sitemaps/genres.xml.gz
/sitemaps/announcements.xml.gz
/sitemaps/images.xml.gz             cover images with <image:title>, for image search
```

- Generated by a worker job, not on request: rebuilt fully nightly, and **incrementally on
  every publish** (the changed series and chapter sitemaps only), so a new chapter is in
  the sitemap within a minute.
- `lastmod` comes from real timestamps; `changefreq`/`priority` are omitted (ignored by
  Google, noise for everyone else).
- After each incremental build the worker submits the changed URLs via **IndexNow**
  (Bing, Yandex, and the other participating engines) using the key stored in settings.
  Google no longer accepts pings; it reads `lastmod` from the sitemap and the Search
  Console API can request indexing for a handful of priority URLs.
- `robots.txt` (editable in admin) lists the sitemap index URL.

### Admin controls

| Setting | Effect |
|---|---|
| **Sitemap enabled** | off → `/sitemap.xml` returns 404 and the `robots.txt` line is dropped |
| **Custom sitemap URL** | when set, `robots.txt` and `<link rel="sitemap">` point at this URL instead of the built-in one — for a sitemap hosted elsewhere or served from the CDN |
| Sections included | checkboxes: series · chapters · genres · announcements · images · pages |
| Include unlisted series | default off |
| Chapters per sitemap file | default 20,000 |
| **Regenerate now** | button; shows the last build time, URL count per file, and any errors |
| IndexNow key | stored, and the key file is served at `/<key>.txt` automatically |

## 6. Feeds

RSS 2.0 and Atom, both server-rendered, both cacheable for 5 minutes:

```
/feed                               latest chapters, site-wide (50 items)
/feed/series                        new series
/series/<slug>/feed                 that series' chapters
/genres/<slug>/feed
/announcements/feed
```

Items carry the chapter title, series, cover as an enclosure, and `pubDate` from
`published_at`. Premium-locked chapters appear when they become free, not at early access.

### Admin controls

| Setting | Effect |
|---|---|
| **Feeds enabled** | off → all feed routes 404, `<link rel="alternate">` dropped, footer RSS link hidden |
| **Custom feed URL** | when set, every `<link rel="alternate" type="application/rss+xml">`, the footer RSS icon and the Discord bot's source point at this URL (for a feed proxied through an analytics or delivery service) while the built-in feed keeps serving at its own path |
| Items per feed | default 50 |
| Include early-access chapters | default off |

## 7. Visibility and indexing rules

| Setting | Default | Notes |
|---|---|---|
| **Site indexable** | on | off → `X-Robots-Tag: noindex` on every response; staging is always off |
| **Index chapter pages** | on | off → chapter pages get `noindex,follow` and leave the sitemap; series pages carry all the link equity. Some operators prefer this on large catalogs |
| Index profiles | off | |
| Index browse with filters | off | `/browse?…` canonicalises to `/browse` |
| Per-series `noindex` | off | for takedown-adjacent or unlisted titles |
| Per-series canonical override | — | when a title is mirrored from a primary URL |

## 8. Global settings (Admin → System → SEO)

**Identity:** site name · title separator (`·` / `—` / `|`) · default description · default
OG image (1200×630) · Organization logo · X handle · `sameAs` links (Discord, X, Instagram,
Reddit, YouTube, Facebook).

**Templates:** the per-page-type title and description templates from §2, with a live
preview against a real series.

**Verification:** Google Search Console, Bing Webmaster, Yandex and Pinterest verification
meta tags (values only; the tags are rendered site-wide).

**Sitemap** and **Feeds** panels as in §5 and §6.

**Redirects:** a table of `from → to` (301 by default, 302 optional), with CSV import for
the legacy-site migration and hit counts per rule so dead rules can be pruned.

**robots.txt:** an editor with the generated default pre-filled, plus a "Disallow AI
crawlers" preset (GPTBot, CCBot, ClaudeBot, Bytespider …) the operator can toggle.

**Tools:** validate a URL's JSON-LD; preview how a series page renders as a Google result,
an X card and a Discord embed; a broken-internal-links report from the nightly crawl.

## 9. Data model additions

```sql
CREATE TABLE seo_settings (            -- singleton key/value, cached in Redis, admin-edited
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by bigint REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE series ADD COLUMN seo_title        text,
                   ADD COLUMN seo_description  text,
                   ADD COLUMN seo_text         jsonb,        -- the "About {title}" block
                   ADD COLUMN focus_keyword    text,
                   ADD COLUMN noindex          boolean NOT NULL DEFAULT false,
                   ADD COLUMN canonical_url    text,
                   ADD COLUMN og_image_key     text;

ALTER TABLE genres ADD COLUMN seo_title        text,
                   ADD COLUMN seo_description  text,
                   ADD COLUMN intro            jsonb,        -- rich text above the grid
                   ADD COLUMN faq              jsonb;        -- [{q, a}] → FAQPage

CREATE TABLE slug_history (
  entity_type text   NOT NULL,          -- 'series' | 'genre' | 'announcement'
  old_slug    citext NOT NULL,
  entity_id   bigint NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, old_slug)
);

CREATE TABLE redirects (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_path  text UNIQUE NOT NULL,
  to_path    text NOT NULL,
  status     smallint NOT NULL DEFAULT 301,
  hits       bigint NOT NULL DEFAULT 0,
  created_by bigint REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sitemap_builds (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        text NOT NULL,            -- 'full' | 'incremental'
  url_count   integer NOT NULL,
  files       jsonb NOT NULL,           -- [{name, urls, bytes}]
  error       text,
  started_at  timestamptz NOT NULL,
  finished_at timestamptz
);
```

## 10. Rendering rules the code enforces

- One `<h1>` per page, and it contains the primary keyword (the series title, the genre).
- All primary content is in the server-rendered HTML — chapter lists, synopsis, genre copy.
  Nothing that matters for ranking waits on client JavaScript.
- The LCP image (hero cover, series cover) is **not** lazy-loaded and is preloaded.
- Internal linking is structural: breadcrumbs on every page, genre chips on every series
  page, recommended series on every series page, prev/next on every chapter, and the footer
  map. Orphan pages do not exist.
- Pagination uses real `?page=N` URLs with `rel` links; infinite scroll is layered on top.
- Core Web Vitals budgets from `06-frontend-and-reader.md` are enforced in CI — they are
  a ranking factor and, more importantly, the reason people come back.
- Removed series return **410 Gone**, not 404, so engines drop them quickly; series moved
  elsewhere return 301.

## 11. Monitoring

- Search Console API pulled nightly: impressions, clicks, coverage errors, and the list
  of URLs Google reports as "crawled, not indexed" — shown on the admin SEO page.
- Sitemap build log with per-file counts and the last IndexNow response.
- A weekly crawl of the site's own sitemap that reports broken links, missing
  descriptions, duplicate titles and pages exceeding the JS budget.
