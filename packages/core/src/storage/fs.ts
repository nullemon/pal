import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getEnv } from '../env.js'
import {
  assertSafeKey,
  joinUrl,
  type PutOptions,
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

  async getSignedPutUrl(
    key: string,
    opts: PutOptions & { expiresInSeconds?: number } = {},
  ): Promise<SignedPutUrl> {
    assertSafeKey(key)
    const expiresAt = new Date(Date.now() + (opts.expiresInSeconds ?? 900) * 1000)
    return {
      url: joinUrl(this.uploadUrl, key),
      method: 'PUT',
      headers: opts.contentType ? { 'content-type': opts.contentType } : {},
      expiresAt,
    }
  }

  getUrl(key: string): string {
    return joinUrl(this.publicUrl, assertSafeKey(key))
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true })
  }

  async exists(key: string): Promise<boolean> {
    try {
      const s = await stat(this.pathFor(key))
      return s.isFile()
    } catch {
      return false
    }
  }
}
