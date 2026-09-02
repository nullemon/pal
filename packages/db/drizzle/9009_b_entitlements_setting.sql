-- docs/17 §B — operator-controlled entitlements.
-- `settings.entitlements` holds the per-feature mode ('premium' | 'free' | 'disabled'), the
-- "all premium features free" master switch and the window that ends a promotion by itself.
-- No new table or column: the generic key/value `settings` row is the whole feature. Seeded
-- here so an existing database shows the defaults on Admin → Business → Premium; the app
-- also falls back to these values when the row is missing.
INSERT INTO "settings" ("key", "value")
VALUES (
  'entitlements',
  '{
     "all_free": false,
     "free_until": null,
     "features": {
       "early_access": "premium",
       "premium_content": "premium",
       "offline": "premium",
       "no_ads": "premium",
       "priority_comments": "premium",
       "see_reactors": "premium",
       "custom_gifs": "premium",
       "animated_avatar": "premium",
       "profile_banner": "premium"
     }
   }'::jsonb
)
ON CONFLICT ("key") DO NOTHING;
