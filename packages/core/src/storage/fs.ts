import { type Dirent, existsSync } from 'node:fs'
import { mkdir, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getEnv } from '../env.js'
import {
  assertSafeKey,
  contentTypeFor,
  joinUrl,
  type ObjectInfo,
  type PutOptions,
  type SignedPutOptions,
  type SignedPutUrl,
  type Storage,
} from './types.js'

export interface FsStorageOptions {
  /** Absolute or repo-relative root folder. Default: STORAGE_FS_ROOT or `.data/storage`. */
  root?: string
  /** Public base URL, default PUBLIC_CDN_URL or `/_storage`. */
  publicUrl?: string
  /** Base URL for dev uploads (signed PUT), default `${publicUrl}`. */
  uploadUrl?: string
}

/**
 * Walk up from `from` to find the pnpm workspace root, so a relative STORAGE_FS_ROOT
 * resolves to the same folder whether the process runs from apps/web, packages/db or root.
 */
export const findRepoRoot = (from: string = process.cwd()): string => {
  let dir = path.resolve(from)
  for (;;) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return path.resolve(from)
    dir = parent
  }
}

export const resolveFsRoot = (root?: string): string => {
  const r = root ?? getEnv().STORAGE_FS_ROOT
  return path.isAbsolute(r) ? r : path.join(findRepoRoot(), r)
}

export class FsStorage implements Storage {
  readonly driver = 'fs' as const
  readonly root: string
  readonly publicUrl: string
  readonly uploadUrl: string

  constructor(opts: FsStorageOptions = {}) {
    this.root = resolveFsRoot(opts.root)
    this.publicUrl = opts.publicUrl ?? getEnv().PUBLIC_CDN_URL ?? '/_storage'
    this.uploadUrl = opts.uploadUrl ?? this.publicUrl
  }

  pathFor(key: string): string {
    return path.join(this.root, assertSafeKey(key))
  }

  async put(key: string, body: Uint8Array | string, _opts?: PutOptions): Promise<void> {
    const file = this.pathFor(key)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, body)
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.pathFor(key)))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async getSignedPutUrl(key: string, opts: SignedPutOptions = {}): Promise<SignedPutUrl> {
    assertSafeKey(key)
    const expiresAt = new Date(Date.now() + (opts.expiresInSeconds ?? 900) * 1000)
    return {
      url: joinUrl(this.uploadUrl, key),
      method: 'PUT',
      headers: opts.contentType ? { 'content-type': opts.contentType } : {},
      expiresAt,
    }
  }

  async getSignedGetUrl(key: string, _expiresInSeconds = 600): Promise<string> {
    return this.getUrl(key)
  }

  getUrl(key: string): string {
    return joinUrl(this.publicUrl, assertSafeKey(key))
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true })
  }

  async head(key: string): Promise<ObjectInfo | null> {
    try {
      const s = await stat(this.pathFor(key))
      return s.isFile() ? { size: s.size, contentType: contentTypeFor(key) } : null
    } catch {
      return null
    }
  }

  async getRange(key: string, start: number, end: number): Promise<Uint8Array | null> {
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(this.pathFor(key), 'r')
      const length = Math.max(0, end - start + 1)
      const buf = new Uint8Array(length)
      const { bytesRead } = await handle.read(buf, 0, length, start)
      return buf.subarray(0, bytesRead)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    } finally {
      await handle?.close()
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const s = await stat(this.pathFor(key))
      return s.isFile()
    } catch {
      return false
    }
  }

  async list(prefix: string): Promise<string[]> {
    // Walk the deepest directory the prefix names in full, then filter by string prefix so
    // the result matches the S3 driver (`avatars/1/` lists nothing from `avatars/12/`).
    const dir = prefix.endsWith('/') ? prefix.slice(0, -1) : path.posix.dirname(prefix)
    const base = dir && dir !== '.' ? this.pathFor(dir) : this.root
    let entries: Dirent[]
    try {
      entries = await readdir(base, { recursive: true, withFileTypes: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
    return entries
      .filter((e) => e.isFile())
      .map((e) =>
        path.relative(this.root, path.join(e.parentPath, e.name)).split(path.sep).join('/'),
      )
      .filter((key) => key.startsWith(prefix))
      .sort()
  }
}
