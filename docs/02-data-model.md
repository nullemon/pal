# 02 — Data model

PostgreSQL 16. Written as DDL because it is the part of the design that is most expensive
to get wrong and cheapest to review now. Drizzle schema in `packages/db` mirrors this.

Conventions: `bigint` identity primary keys, `citext` for case-insensitive uniqueness,
`timestamptz` everywhere (never `timestamp`), `deleted_at` soft deletes, and
`created_at`/`updated_at` on every mutable table.

## Identity

```sql
CREATE TYPE user_role AS ENUM ('user','supporter','premium','uploader','moderator','admin');

CREATE TABLE users (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email           citext UNIQUE NOT NULL,
  username        citext UNIQUE,                     -- null until onboarding completes
  password_hash   text,                              -- null for OAuth-only accounts
  role            user_role NOT NULL DEFAULT 'user',
  display_name    text,
  bio             text,
  avatar_key      text,                              -- object key, not a URL
  banner_key      text,
  email_verified_at timestamptz,
  comment_banned_until timestamptz,
  last_login_at   timestamptz,
  last_login_method text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE TABLE oauth_accounts (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      text NOT NULL,                       -- 'google', 'discord'
  provider_uid  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);

-- Opaque server-side sessions. The cookie holds the id + a secret; only the SHA-256 of the
-- secret is stored, so a database leak does not hand over live sessions.
CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secret_hash   bytea NOT NULL,
  user_agent    text,
  ip_hash       bytea,                               -- hashed, for abuse detection, not logging
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX ON sessions (expires_at);

CREATE TABLE auth_tokens (                           -- verification + password reset
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL,                         -- 'verify_email' | 'reset_password'
  token_hash  bytea NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

## Catalog

```sql
CREATE TYPE series_type   AS ENUM ('manga','manhwa','manhua','comic','novel');
CREATE TYPE series_status AS ENUM ('ongoing','completed','hiatus','cancelled','dropped');
CREATE TYPE pub_state     AS ENUM ('draft','scheduled','published','unlisted','removed');

CREATE TABLE series (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug             citext UNIQUE NOT NULL,
  title            text NOT NULL,
  type             series_type NOT NULL,
  status           series_status NOT NULL DEFAULT 'ongoing',
  state            pub_state NOT NULL DEFAULT 'draft',
  synopsis         text,
  cover_key        text,
  banner_key       text,
  country          char(2),
  released_year    smallint,
  serialization    text,
  age_rating       text,                             -- 'all' | 'teen' | 'mature'
  is_featured      boolean NOT NULL DEFAULT false,   -- drives the hero carousel
  is_pinned        boolean NOT NULL DEFAULT false,
  comments_enabled boolean NOT NULL DEFAULT true,
  linked_series_id bigint REFERENCES series(id),     -- comic <-> novel cross-sell
  release_schedule text,                             -- free text, e.g. 'Every Friday'
  published_at     timestamptz,
  -- denormalised counters, maintained by triggers; never computed on a read path
  chapter_count    integer NOT NULL DEFAULT 0,
  bookmark_count   integer NOT NULL DEFAULT 0,
  view_count       bigint  NOT NULL DEFAULT 0,
  rating_sum       bigint  NOT NULL DEFAULT 0,
  rating_count     integer NOT NULL DEFAULT 0,
  last_chapter_at  timestamptz,
  search_vector    tsvector GENERATED ALWAYS AS (
                     setweight(to_tsvector('simple', coalesce(title,'')), 'A')
                  ) STORED,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
CREATE INDEX ON series USING gin (search_vector);
CREATE INDEX ON series USING gin (title gin_trgm_ops);        -- fuzzy / typo-tolerant search
CREATE INDEX ON series (state, last_chapter_at DESC NULLS LAST) WHERE deleted_at IS NULL;
CREATE INDEX ON series (type, status) WHERE deleted_at IS NULL AND state = 'published';

CREATE TABLE series_titles (                          -- the 20+ localized aliases per series
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  series_id   bigint NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  title       text NOT NULL,
  lang        text,
  UNIQUE (series_id, title)
);
CREATE INDEX ON series_titles USING gin (title gin_trgm_ops);

CREATE TABLE genres (
  id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug  citext UNIQUE NOT NULL,
  name  text NOT NULL,
  kind  text NOT NULL DEFAULT 'genre'                 -- 'genre' | 'theme' | 'format'
);
CREATE TABLE series_genres (
  series_id bigint NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  genre_id  bigint NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  PRIMARY KEY (series_id, genre_id)
);
CREATE INDEX ON series_genres (genre_id, series_id);

CREATE TABLE people (                                 -- authors, artists, studios
  id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug citext UNIQUE NOT NULL,
  name text NOT NULL
);
CREATE TABLE series_people (
  series_id bigint NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  person_id bigint NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  credit    text NOT NULL,                            -- 'author' | 'artist' | 'translator'
  PRIMARY KEY (series_id, person_id, credit)
);
```

## Chapters and pages

```sql
CREATE TYPE chapter_state AS ENUM ('draft','processing','ready','scheduled','published','failed','removed');

CREATE TABLE chapters (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  series_id         bigint NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  number            numeric(10,3) NOT NULL,           -- numeric so 12.5 and 7.1 work
  volume            smallint,
  title             text,
  state             chapter_state NOT NULL DEFAULT 'draft',
  is_premium        boolean NOT NULL DEFAULT false,
  early_access_until timestamptz,                     -- premium-only window before it goes free
  published_at      timestamptz,
  page_count        smallint NOT NULL DEFAULT 0,
  view_count        bigint NOT NULL DEFAULT 0,
  uploaded_by       bigint REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  UNIQUE (series_id, number)
);
CREATE INDEX ON chapters (series_id, number DESC) WHERE deleted_at IS NULL;
CREATE INDEX ON chapters (state, published_at)
  WHERE state = 'scheduled';                          -- the publisher's work queue
CREATE INDEX ON chapters (published_at DESC)
  WHERE state = 'published' AND deleted_at IS NULL;   -- "latest updates" feed

CREATE TABLE chapter_pages (
  chapter_id  bigint NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  idx         smallint NOT NULL,                      -- 0-based display order
  key         text NOT NULL,                          -- content-addressed base object key
  width       integer NOT NULL,                       -- intrinsic dimensions: zero layout shift
  height      integer NOT NULL,
  bytes       integer NOT NULL,
  blur_hash   text,                                   -- tiny placeholder
  variants    jsonb NOT NULL DEFAULT '[]',            -- [{w:720,fmt:'avif',bytes:...}, ...]
  PRIMARY KEY (chapter_id, idx)
);
```

`number` as `numeric` rather than `integer` or `text` is deliberate: half-chapters and
extras are the norm in this medium, and text sorting puts chapter 10 before chapter 2.

## Reading, rating, bookmarks

```sql
CREATE TABLE bookmarks (
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  series_id  bigint NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'reading',   -- reading|planned|completed|paused|dropped
  is_public  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, series_id)
);
CREATE INDEX ON bookmarks (series_id);

CREATE TABLE reading_progress (
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  series_id    bigint NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  chapter_id   bigint NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  page_idx     smallint NOT NULL DEFAULT 0,
  scroll_pct   real    NOT NULL DEFAULT 0,      -- resume exactly where they stopped
  read_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, series_id)
);
CREATE INDEX ON reading_progress (user_id, read_at DESC);

CREATE TABLE chapter_reads (                     -- full history; feeds "recently read"
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chapter_id bigint NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  read_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, chapter_id)
);

CREATE TABLE ratings (
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  series_id  bigint NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  score      smallint NOT NULL CHECK (score BETWEEN 1 AND 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, series_id)
);
```

Display rating is `rating_sum / rating_count`, **rounded to one decimal at write time** into
a generated column — not shipped raw to the client. For ranking, use a Bayesian prior so a
single 10/10 does not top the chart:
`(rating_sum + C*m) / (rating_count + C)` with `m` = site mean, `C` ≈ 20.

## Views and ranking

Do not `UPDATE ... SET view_count = view_count + 1` on every page view; that serialises
writes on hot rows. Instead:

```sql
CREATE TABLE view_events (                       -- append-only, partitioned by day
  series_id  bigint NOT NULL,
  chapter_id bigint,
  bucket     date NOT NULL,
  viewer_key bytea NOT NULL,                     -- hash(user_id | ip+ua salt) for dedupe
  PRIMARY KEY (bucket, series_id, viewer_key, chapter_id)
) PARTITION BY RANGE (bucket);

CREATE TABLE series_stats_daily (
  series_id bigint NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  bucket    date   NOT NULL,
  views     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (series_id, bucket)
);
```

A job rolls `view_events` into `series_stats_daily` every few minutes, then drops
partitions older than 90 days. Popular Weekly / Monthly / All-Time are then plain
aggregates over `series_stats_daily`, cached in Redis for 5 minutes. `viewer_key` in the
primary key gives you unique-visitor counting and free bot-inflation resistance.

## Comments

```sql
CREATE TABLE comments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  series_id   bigint REFERENCES series(id) ON DELETE CASCADE,
  chapter_id  bigint REFERENCES chapters(id) ON DELETE CASCADE,
  parent_id   bigint REFERENCES comments(id) ON DELETE CASCADE,
  body        jsonb NOT NULL,                    -- structured rich text, never raw HTML
  is_spoiler  boolean NOT NULL DEFAULT false,
  is_pinned   boolean NOT NULL DEFAULT false,
  score       integer NOT NULL DEFAULT 0,
  edited_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CHECK (series_id IS NOT NULL OR chapter_id IS NOT NULL)
);
CREATE INDEX ON comments (chapter_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ON comments (series_id, score DESC)       WHERE deleted_at IS NULL;

CREATE TABLE comment_reactions (
  comment_id bigint NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text   NOT NULL,                    -- up|funny|love|surprised|angry|sad
  PRIMARY KEY (comment_id, user_id, kind)
);

CREATE TABLE reports (                            -- one queue for every report type
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind         text NOT NULL,                     -- comment|series_data|broken_chapter|site|dmca
  target_type  text NOT NULL,
  target_id    bigint,
  reporter_id  bigint REFERENCES users(id),
  reporter_email citext,                          -- DMCA notices come from non-users
  reason       text NOT NULL,
  detail       text,
  status       text NOT NULL DEFAULT 'open',      -- open|triaged|actioned|rejected
  handled_by   bigint REFERENCES users(id),
  handled_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON reports (status, kind, created_at);
```

Comment bodies are stored as **structured JSON**, not HTML. Rendering walks a whitelisted
node type union. Storing HTML and sanitising on the way out is how comment XSS happens, and
in this design an XSS is not a session compromise only because sessions are HttpOnly —
don't rely on the second line of defence.

## Monetization

```sql
CREATE TABLE plans (
  id            text PRIMARY KEY,                 -- 'supporter' | 'premium'
  name          text NOT NULL,
  price_cents   integer NOT NULL,
  interval      text NOT NULL,                    -- 'month' | 'year'
  stripe_price_id text NOT NULL
);

CREATE TABLE subscriptions (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id              bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id              text NOT NULL REFERENCES plans(id),
  stripe_customer_id   text NOT NULL,
  stripe_subscription_id text UNIQUE NOT NULL,
  status               text NOT NULL,             -- mirrors Stripe
  current_period_end   timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON subscriptions (user_id) WHERE status IN ('active','trialing','past_due');

-- The single source of truth the app reads. Written by the Stripe webhook, by admin grants,
-- and by promo redemptions. Never inferred from `users.role`.
CREATE TABLE entitlements (
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature    text   NOT NULL,                     -- 'early_access' | 'offline' | 'no_ads' | ...
  source     text   NOT NULL,                     -- 'subscription' | 'grant' | 'promo'
  expires_at timestamptz,                         -- null = permanent
  PRIMARY KEY (user_id, feature)
);
CREATE INDEX ON entitlements (expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE webhook_events (                     -- idempotency for Stripe redelivery
  id           text PRIMARY KEY,                  -- Stripe event id
  type         text NOT NULL,
  processed_at timestamptz,
  payload      jsonb NOT NULL
);
```

Separating `entitlements` from `users.role` is the fix for Asura's `premium_until` coupling.
Role answers "what may this person *do* in the admin panel"; entitlement answers "what may
this person *access*". Conflating them is why their client-side `isPremiumActive()` has to
special-case staff roles in two different scripts.

## Announcements, notifications, audit

```sql
CREATE TABLE announcements (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug         citext UNIQUE NOT NULL,
  title        text NOT NULL,
  body         jsonb NOT NULL,
  cover_key    text,
  author_id    bigint REFERENCES users(id),
  state        pub_state NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL,                       -- new_chapter|reply|reaction|system
  payload    jsonb NOT NULL,
  group_key  text,                                -- collapses "12 people liked your comment"
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id   bigint REFERENCES users(id),
  action     text NOT NULL,                       -- 'chapter.delete', 'user.role_change'
  target_type text NOT NULL,
  target_id  bigint,
  before     jsonb,
  after      jsonb,
  ip_hash    bytea,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (target_type, target_id, created_at DESC);
CREATE INDEX ON audit_log (actor_id, created_at DESC);
```

## Content compliance

Because the platform hosts uploaded material, takedown handling is a product feature, not
an afterthought bolted on when the first notice arrives.

```sql
CREATE TABLE takedowns (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  series_id     bigint REFERENCES series(id),
  chapter_id    bigint REFERENCES chapters(id),
  claimant      text NOT NULL,
  claimant_email citext NOT NULL,
  notice_body   text NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  actioned_at   timestamptz,
  action        text,                             -- 'removed' | 'geo_blocked' | 'rejected'
  counter_notice text,
  created_by    bigint REFERENCES users(id)
);

CREATE TABLE geo_restrictions (                   -- per-title territory control
  series_id  bigint NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  country    char(2) NOT NULL,
  mode       text NOT NULL,                       -- 'allow' | 'block'
  PRIMARY KEY (series_id, country)
);
```

Setting a series to `state = 'removed'` must, in one transaction, hide it from every feed,
purge its CDN paths, and write both an `audit_log` and a `takedowns` row. A repeat-infringer
policy needs the uploader attribution that `chapters.uploaded_by` already provides.

## SEO tables

The `seo_settings` singleton, per-series and per-genre SEO columns, `slug_history`,
`redirects` and `sitemap_builds` are specified in `12-seo.md` §9.

## Counter maintenance

`chapter_count`, `bookmark_count`, `rating_sum`, `rating_count`, and `last_chapter_at` are
maintained by `AFTER INSERT/UPDATE/DELETE` triggers, not recomputed on read. A nightly job
reconciles them against the source tables and logs any drift — triggers do fail eventually,
and silent counter drift is the kind of bug that takes a year to notice.
