import {
  backupKey,
  isMirroredKey,
  profileForKey,
  type RoutableProfile,
  type StorageProfile,
} from './profiles.js'
import type { ObjectInfo, PutOptions, SignedPutOptions, SignedPutUrl, Storage } from './types.js'

/**
 * One `Storage` over the three buckets, dispatching on the key (`./profiles.ts`).
 *
 * It is a `Storage` itself so the ~30 places that call `getStorage()` keep working unchanged
 * and, more to the point, *cannot* address the wrong bucket: there is no parameter to pass
 * and therefore none to forget. Where a call site previously wrote `uploads/…` into the one
 * bucket the site had, it now writes into the vault because the key says so.
 *
 * ## Single-bucket mode
 *
 * When no vault is configured, `public` and `private` are the same `Storage` instance and
 * this class is a pass-through — which is exactly the behaviour the site had before the
 * split, and what the `fs` development driver and every existing test still get. The
 * `getUrl` guard below is the one behaviour that differs, and it is deliberately inert until
 * an operator has actually separated the buckets.
 */
export class StorageRouter implements Storage {
  readonly driver: 'fs' | 's3'
  private readonly targets: Record<RoutableProfile, Storage>
  private readonly backup: Storage | null
  /** True once the vault is a different bucket from the public one. */
  readonly separated: boolean

  constructor(
    targets: { public: Storage; private?: Storage | null; backup?: Storage | null },
    private readonly onWrite?: (profile: RoutableProfile, key: string) => void,
  ) {
    const priv = targets.private ?? targets.public
    this.targets = { public: targets.public, private: priv }
    this.backup = targets.backup ?? null
    this.separated = priv !== targets.public
    this.driver = targets.public.driver
  }

  /** The bucket behind a profile, for jobs that address one on purpose (mirror, restore). */
  target(profile: StorageProfile): Storage | null {
    return profile === 'backup' ? this.backup : this.targets[profile]
  }

  get hasBackup(): boolean {
    return this.backup !== null
  }

  private for(key: string): Storage {
    return this.targets[profileForKey(key)]
  }

  async put(key: string, body: Uint8Array | string, opts?: PutOptions): Promise<void> {
    await this.for(key).put(key, body, opts)
    // After the write lands, never before: a mirror job for an object that failed to store
    // would retry until it gave up on something that was never there.
    if (this.backup && isMirroredKey(key)) this.onWrite?.(profileForKey(key), key)
  }

  get(key: string): Promise<Uint8Array | null> {
    return this.for(key).get(key)
  }

  getSignedPutUrl(key: string, opts?: SignedPutOptions): Promise<SignedPutUrl> {
    return this.for(key).getSignedPutUrl(key, opts)
  }

  getSignedGetUrl(key: string, expiresInSeconds?: number): Promise<string> {
    return this.for(key).getSignedGetUrl(key, expiresInSeconds)
  }

  /**
   * The public URL of an object — and a thrown error for one that has no such thing.
   *
   * A private object genuinely has no public URL once the buckets are split: the vault has no
   * hostname, so any string this returned would 404 at best and, at worst, be a link to
   * somebody's raw upload. Throwing turns "this code path assumed one bucket" into a stack
   * trace pointing at the call site instead of a broken image in production.
   *
   * Inert in single-bucket mode, where the old behaviour is still correct.
   */
  getUrl(key: string): string {
    const profile = profileForKey(key)
    if (profile === 'private' && this.separated) {
      throw new Error(
        `No public URL for ${JSON.stringify(key)}: it is in the private bucket. ` +
          'Use getSignedGetUrl() for a time-limited link.',
      )
    }
    return this.targets[profile].getUrl(key)
  }

  /**
   * Deletes from the primary bucket only.
   *
   * The mirror is deliberately not touched: protecting against a delete is most of what a
   * backup is for, and a delete that propagated would make it useless for the case it exists
   * to cover.
   *
   * The cost is that the mirror only grows: nothing prunes a copy whose original is gone. A
   * takedown that must erase every trace therefore has to call `purgeFromBackup` as well —
   * `infra/RUNBOOK.md` → "Take down a title" is the procedure.
   */
  delete(key: string): Promise<void> {
    return this.for(key).delete(key)
  }

  exists(key: string): Promise<boolean> {
    return this.for(key).exists(key)
  }

  head(key: string): Promise<ObjectInfo | null> {
    return this.for(key).head(key)
  }

  getRange(key: string, start: number, end: number): Promise<Uint8Array | null> {
    return this.for(key).getRange(key, start, end)
  }

  /** Routed by the prefix, which names the bucket for the same reason a full key does. */
  list(prefix: string): Promise<string[]> {
    return this.for(prefix).list(prefix)
  }

  /**
   * Remove an object's mirrored copy. Only for erasure that must be total — a takedown, or a
   * reader deleting their account — never for ordinary cleanup.
   */
  async purgeFromBackup(key: string): Promise<void> {
    if (!this.backup) return
    await this.backup.delete(backupKey(profileForKey(key), key))
  }
}
