import type { DiscoveryReport, DryRunReport, ImportSetting } from '@palscans/core/import'

/**
 * Client-safe shapes for the Import screen. Kept out of `service.ts` because that module
 * pulls in @palscans/db, which must never reach the browser bundle (docs/16 conventions).
 */
export interface StoredDiscovery extends DiscoveryReport {
  ranAt: string
}
export interface StoredDryRun extends DryRunReport {
  ranAt: string
}
export interface ImportDoc {
  config: ImportSetting
  discovery: StoredDiscovery | null
  dryRun: StoredDryRun | null
}
