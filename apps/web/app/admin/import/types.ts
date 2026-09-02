import type { DiscoveryReport, DryRunReport, ImportSetting } from '@palscans/core/import'
import type { ImportCounts, ImportPhase, ImportRunError, ImportStatus } from '@palscans/db/schema'

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

/** One import run as the admin panel sees it — progress only, never the source credentials. */
export interface RunView {
  id: number
  source: string
  status: ImportStatus
  phase: ImportPhase
  counts: ImportCounts
  /** The most recent problems; `errorCount` is how many the run actually recorded. */
  errors: ImportRunError[]
  errorCount: number
  /** A pause or cancel has been asked for and the runner has not reached it yet. */
  stopping: boolean
  startedAt: string
  updatedAt: string
  heartbeatAt: string | null
  finishedAt: string | null
}
