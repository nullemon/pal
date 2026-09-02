import { type Db, getSetting } from '@palscans/db'
import { BILLING_SETTINGS_KEY, type BillingSettings, parseBillingSettings } from './settings'

/** `settings.billing` read through the same helper as `ads` and `layouts` (docs/16). */
export const getBillingSettings = async (db: Db): Promise<BillingSettings> =>
  parseBillingSettings(await getSetting<unknown>(db, BILLING_SETTINGS_KEY, {}))
