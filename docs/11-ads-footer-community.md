# 11 — Advertising, footer, and community surfaces

## Ad inventory

Ads are a revenue line, not a design afterthought, so each slot has a fixed place, a fixed
size, and a rule for when it is *not* shown. Slots are rendered as reserved boxes with the
final dimensions even before an ad network is wired in — reserving the space is what stops
the layout from jumping when an ad loads.

| Slot id | Placement | Desktop | Mobile | Shown when |
|---|---|---|---|---|
| `home_top` | below the hero, above Latest Updates | 970×90 leaderboard | 320×100 | always, unless ad-free entitlement |
| `home_sidebar` | right column, under Popular | 300×250 MPU | hidden | desktop only |
| `home_infeed` | after the 6th Latest Updates row | native card, matches `SeriesCard` | native card | always, unless ad-free |
| `series_top` | under the series header, above chapters | 728×90 | 320×100 | always, unless ad-free |
| `series_sidebar` | under the chapter list | 300×250 | 300×250 | always, unless ad-free |
| `reader_end` | after the last page, before the Next Chapter control | 336×280 | 300×250 | always, unless ad-free |
| `mobile_anchor` | sticky bottom bar on mobile | — | 320×50 | never inside the reader; dismissible |

**Never inside the reading strip.** No interstitials between pages, no slot that a thumb
can hit while scrolling a chapter. `reader_end` sits after the final page and above the
navigation, so it is seen once per chapter, at a natural pause. This is the rule most sites
in the category break, and it is why their readers install ad blockers.

**Ad-free is an entitlement**, `no_ads`, granted by both subscription tiers. The slot
components check `entitlement(user, 'no_ads')` server-side and render nothing — not a
collapsed box, nothing — so paying readers never see the reserved space either.

**Loading**: ad scripts load `async` after first paint and never block LCP. Every slot has
an explicit `min-height` so the page reserves its box; a slot that fails to fill collapses
to zero height after a 3-second timeout rather than showing an empty frame.

**Content policy**: no pop-unders, no redirects, no auto-playing audio, no "download"
lookalikes. Those earn more per thousand and cost the audience. The Lighthouse CI budgets in
`06-frontend-and-reader.md` still apply with ads loaded.

## Footer

The footer is the one place the whole site's map and the community links live. Four
columns on desktop, an accordion on mobile:

```
[ PALScans mark ]   Browse            Account          Legal
Read manhwa, manga  Latest updates    Bookmarks        DMCA
and manhua, updated Popular           Reading history  Terms of service
daily.              Genres            Notifications    Privacy policy
                    Rankings          PALScans Premium Contact
[ Join the Discord ]  ← primary button, member count optional
[ X ] [ Instagram ] [ Reddit ] [ YouTube ] [ Facebook ] [ RSS ]
© 2026 PALScans. All series belong to their respective authors and publishers.
```

- **Discord is the primary community call to action** — a filled button, not an icon in a
  row. New-chapter notifications go there through the bot, and it is the support channel.
- Social icons are inline SVG at 20px, stroke style, one consistent set. Links open in a
  new tab with `rel="noopener"`.
- The attribution line is deliberate: it is where the "report a data mistake" and DMCA
  entry points live for anyone who scrolls to the bottom looking for them.
- The footer is server-rendered static markup and identical on every page, so it caches
  with the shell.

## Community surfaces

- **Discord**: OAuth link on the account page issues a role in the server matching the
  subscription tier; the bot DMs new-chapter notifications for bookmarked series and can
  sync bookmarks both ways.
- **Announcements** page and the compact home card.
- **Comments** with reactions, threading, mentions and reports (see `02-data-model.md`).
- **Public profiles** with bookmarks that can be shared.
- **RSS**: `/feed` (latest chapters) and `/series/[slug]/feed` — cheap to provide, and it is
  how a meaningful slice of the audience follows releases.

## Header, for completeness

Logo · Home · Browse · Rankings · Genres · Bookmarks · search (⌘K) · notifications bell ·
**Premium** button · avatar menu. The Premium button is the one accent-filled control in the
header; everything else is quiet so it reads as the primary action.
