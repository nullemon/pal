# 03 — Image pipeline

This is the part that decides whether the site feels fast and whether it is affordable.
Everything else is CRUD.

## Storage layout

Content-addressed, so every object is immutable and can be cached forever:

```
covers/<series-slug>/<sha256[0:12]>.{avif,webp}            widths 200,400,800
banners/<series-slug>/<sha256[0:12]>.{avif,webp}           widths 800,1600,2400
pages/<series-id>/<chapter-id>/<idx:04d>-<sha[0:12]>.{avif,webp}   widths 480,720,1080,1440
avatars/<user-id>/<sha256[0:12]>.webp                      widths 64,160
```

Full key form: `pages/1284/59310/0007-9f2c1ab4de07.720.avif`.

Because the hash is in the key, a re-upload of a corrected page produces a *new* key and
the old CDN entry simply stops being referenced — no purge required, no stale image served.
Asura uses the same trick with a 6-character hash; 12 characters is a better collision
margin once you are past a few million objects.

Headers: `Cache-Control: public, max-age=31536000, immutable` on everything under these
prefixes. Set it once as an R2 bucket-level rule.

## Upload flow

```
1. Admin selects a folder, drags a CBZ/ZIP, or pastes image URLs.
2. Browser sorts filenames with a natural-order comparator (page2 < page10) and shows a
   reorderable grid immediately, from local object URLs — no server round trip to preview.
3. Browser POSTs a manifest: [{filename, bytes, sha256}] to /api/admin/chapters/:id/upload-intent
4. Server validates (magic-byte sniff on the declared type, per-file and per-chapter size
   caps, page count cap) and returns one presigned R2 PUT URL per file, valid 15 minutes.
5. Browser PUTs files directly to R2, 4 at a time, with per-file progress and retry.
   Nothing passes through the application server.
6. Browser POSTs /api/admin/chapters/:id/commit with the ordered key list.
7. Server enqueues chapter.process and sets chapters.state = 'processing'.
```

For CBZ/ZIP, unzip in the browser (`fflate` streams it) rather than server-side — it keeps
a 400 MB archive off your server entirely and gives instant thumbnails.

## Worker: `chapter.process`

Per page, in a bounded concurrency pool (`p-limit`, ~4 on a 4-core box):

1. Fetch the original from R2 into a buffer.
2. `sharp(buf).rotate()` — apply EXIF orientation, then strip all metadata. This also
   removes GPS and camera data that uploaded scans routinely carry.
3. Read intrinsic `width`/`height`. **Store them.** They are what makes the reader
   layout-shift-free.
4. Reject anything absurd: > 12000 px on a side, > 40 MP, or a decode failure.
5. Generate widths — but only *downscale*. Never upscale a 700 px page to 1440.
   - `avif` quality 55, `effort` 4 — roughly 30–45% smaller than WebP at equal quality
   - `webp` quality 78 — the fallback, still needed for older Safari and some Android WebViews
6. Compute a 4×3 BlurHash for the placeholder.
7. Write all variants to R2 under the content-addressed key.
8. Insert `chapter_pages` rows with `variants` JSONB describing what exists.

Then set `chapters.page_count`, flip state to `ready` (or `scheduled` if `published_at` is
in the future), and touch `series.last_chapter_at`.

Failure handling: three retries with exponential backoff; on final failure the chapter goes
to `failed` with the per-page error recorded, and the admin sees exactly which pages broke
with a "retry failed pages only" button. A half-processed chapter must never become
visible — the state machine is the guard.

### Long-strip splitting

Webtoon sources sometimes arrive as one 30,000 px tall image. Browsers on low-end Android
fail to decode those. If `height > 10000`, slice into ≤ 5000 px segments with a 0 px
overlap and emit them as consecutive pages. Do this at ingest, never at read time.

## Serving

```html
<img
  src="https://cdn.palscans.org/pages/1284/59310/0007-9f2c1ab4de07.720.webp"
  srcset="…480.webp 480w, …720.webp 720w, …1080.webp 1080w, …1440.webp 1440w"
  sizes="(max-width: 768px) 100vw, 800px"
  width="800" height="1200"
  loading="lazy" decoding="async" fetchpriority="low">
```

wrapped in `<picture>` with an AVIF `<source>` first. The `width`/`height` attributes come
from the database, so every page reserves its exact box before a byte of image arrives —
scroll position never jumps as images land. This is the single biggest perceived-quality
difference between a good reader and a bad one.

Eagerness: the first 3 pages get `loading="eager" fetchpriority="high"`; page 1 additionally
gets a `<link rel="preload">` in the document head. Everything else is lazy with a
generous `rootMargin` so images are already decoding when they enter view.

## Paid content

Free pages: plain immutable CDN URLs. Cacheable, shareable, cheap.

Premium or early-access pages: the page URLs are **not in the HTML** for a non-entitled
user. An entitled user's page fetches signed URLs from `/api/chapters/:id/pages`, which
checks `entitlement(user, chapter)` server-side and returns URLs signed for a reading session
(`SIGNED_URL_TTL_SEC`, 2h) — long enough that lazy-loaded pages later in a chapter still resolve.

This costs you edge caching on paid pages — accept it. The alternative (ship real URLs and
hide them with CSS, which several sites in this space do) is not a paywall; it is a blur
filter over a public URL.

## Hotlink and scraping defence

- Cloudflare hotlink protection plus a `Referer` allowlist on the image hostname.
- Rate-limit `/api/chapters/:id/pages` per session and per IP.
- Randomise the page index prefix per chapter (a per-chapter salt in the hash) so a scraper
  cannot enumerate `0001…0040` without first reading the manifest.
- Cloudflare Bot Fight Mode on `/read/*`.

None of this stops a determined scraper. It stops the casual ones, which is the realistic
goal.

## Cost sanity check

40 pages at 1080 px AVIF ≈ 120 KB each ≈ **4.8 MB per chapter read**, roughly 40% less than
a WebP-only pipeline at the same visual quality. Ten million chapter reads a month is
~48 TB of egress — $0 on R2, ~$4,300/month on standard cloud egress pricing.
