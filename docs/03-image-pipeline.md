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

uploads/<series-id>/<chapter-id>/<idx:04d>-<sha[0:12]>.<ext>       originals, private
uploads/art/<series-id>/<sha256[0:12]>.<ext>                       cover/banner originals
```

**Originals are kept.** Nothing in the pipeline deletes anything under `uploads/`, and the
keys stay in `chapters.processing.sources` for the life of the chapter. That is not an
accident of the implementation: it is what makes a page repairable — a re-encode at a new
quality, a corrected long-strip split, or a changed watermark — without asking the uploader
for the files again. Keep it that way, and do not put a lifecycle rule on that prefix. A
chapter whose originals *have* gone (an imported one that never had them, or a bucket
someone tidied) can still be read, but it can never be re-processed; the admin panel labels
those chapters **No originals** rather than pretending otherwise.

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

### Watermark

Every emitted variant carries the site's attribution, burned into the pixels between the
resize and the encode. This is the cheapest discovery channel a scanlation site has: pages
get saved and reposted, and a mark in the image travels with them where a CSS overlay
vanishes the moment someone right-click-saves.

It is composited **per output width**, not once at full size and then downscaled, so the
480px variant carries a crisp mark of the same relative size as the 1440px one. Geometry is
a fraction of the width (`watermarkGeometry` in `@palscans/core/watermark`): font size at
2.4% of the width by default, inset 2%, a band pinned with a sharp gravity rather than a
page-sized layer, and a white body inside a dark halo at 34% so one setting stays legible
over both a black gutter and a white speech bubble.

The operator owns all of it in **Appearance → Watermark**: on/off, the text, which corner,
size, inset and opacity, with a live preview rendered from the same code on a real page.

The settings are folded into the content address. Two different marks can therefore never
share an object key, so a changed watermark simply re-processes to fresh keys and the old
objects stop being referenced — the same property a re-uploaded page already had, and the
reason nothing needs purging.

### Re-applying the mark

Because the mark is in the pixels, **saving the watermark changes nothing that already
exists.** Every processed chapter keeps the images it was built with — in the reader, in the
CBZ download and in the offline cache, all of which read the same `chapter_pages` rows.
Turning the watermark on for the first time would otherwise mark new uploads and leave the
whole back catalogue bare, with nothing to say so.

`watermark.reapply` (`apps/worker/src/jobs/watermark-reapply.ts`) closes that gap. It walks
chapters in ascending id, rebuilds each one's pages from its uploaded originals under the
mark configured now, writes the new content-addressed objects and re-points `chapter_pages`
in one transaction. State, publish time and premium flags are never touched: it changes
pixels, not publishing.

**It cannot mark an image twice, structurally.** Its only input is
`chapters.processing.sources`, checked for the `uploads/` prefix before a byte is read; it
never opens a `pages/` object, so there is no path by which an already-marked image reaches
the compositor. A chapter with no recorded sources, or whose sources are no longer in the
bucket, is *reported* — never guessed at, never partially rewritten. Nothing is written to
the database until every page of the chapter has been encoded and stored, and the row swap
re-checks that the chapter has not moved underneath it, so a failure anywhere leaves
`chapter_pages` pointing at objects that all still exist.

**A sweep and a selection behave differently, on purpose.** A catalogue-wide run takes the
chapters it can act on: still has originals, and not already stamped with this mark. It
deliberately skips the ones with no originals at all — no run can ever fix those, and an
imported catalogue can have tens of thousands of them, which would fill every report with
the one thing it cannot do. Nothing is hidden: the panel counts them permanently and
`Chapters → Mark` lists every one. When the operator has *named* chapters, every one of them
is walked whatever state it is in, and each gets an outcome — rebuilt, already correct, or
the reason it could not be done. Quietly doing nothing to a chapter somebody explicitly
picked is the failure worth spending a few extra queries to avoid.

**It proves rather than assumes what a chapter carries.** `chapters.processing.watermark`
holds the fingerprint the pipeline burned in, which is the cheap index behind the panel's
column and the SQL filter that keeps a re-run nearly free. A chapter processed before that
field existed reads as *not recorded*, which is deliberately not the same as *stale*: for
those the job re-derives the address from the original (decode, segment, hash — about a
tenth of the cost of a full re-encode) and leaves the chapter completely alone when the keys
already agree.

**It yields and it resumes.** One chapter at a time, at half the pipeline's page
concurrency, with a pause after each chapter it actually rebuilt, and it waits for the
publish pipeline to go quiet before starting one — an upload always wins. The run document
in `settings.watermark_reapply` is the checkpoint: the cursor and the counters commit
together after every chapter, so a killed worker costs one chapter, and the worker's
scheduler picks a run back up whose heartbeat has gone cold. Stop is read between chapters,
so cancelling never leaves a chapter half-written.

Both the worker and the panel write that one document — the worker its cursor, the panel
`cancelRequested` — so **both write it with a `jsonb` merge, never whole**. A full write from
either side throws away whatever the other set in between; when the worker did that, a Stop
pressed mid-chapter was silently undone by the checkpoint that followed it and the sweep ran
to the end of the catalogue.

**It refuses rather than lie about fonts.** `chapter.process` warns and processes unmarked
when the host has no face librsvg can draw with, which costs one chapter. Doing the same
here would quietly rewrite the *entire catalogue* to unmarked pages and report success, so a
run on a fontless host fails with `no_font` and writes nothing.

**Superseded objects are left in place.** The run reports how many bytes stopped being
referenced and deletes none of them. They are served `immutable` with a one-year
`Cache-Control`, so edge caches and readers may still be holding the old URLs; a sweeper that
gets the reachability query slightly wrong deletes the catalogue, while the storage it would
save is a few MB per chapter on R2. Remove them from the bucket by hand once you are
satisfied with the result.

The operator drives all of this from **Appearance → Watermark**: how many chapters are on
the current mark, on an older one, not recorded, or unmarkable; a Re-apply button that
queues the run and shows live progress; and Stop. **Chapters** carries the same state as a
per-row column with a filter, plus per-row and bulk *Re-apply watermark* through the ordinary
bulk-action endpoint, which queues the same job on a narrower scope.

The mark is drawn as SVG text, which means the host needs a font. `node:22-alpine` ships
none and librsvg fails silently on a missing face, so the worker probes once per process and
processes unmarked — with a warning — rather than burning an invisible watermark into every
page. `infra/Dockerfile` installs `font-dejavu` for this.

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
