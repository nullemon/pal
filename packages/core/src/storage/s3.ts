import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
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

const isMissing = (err: unknown): boolean => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
  return e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404
}

export interface S3StorageOptions {
  bucket?: string
  endpoint?: string
  region?: string
  accessKeyId?: string
  secretAccessKey?: string
  publicUrl?: string
  forcePathStyle?: boolean
  client?: S3Client
}

export class S3Storage implements Storage {
  readonly driver = 's3' as const
  readonly bucket: string
  readonly publicUrl: string
  readonly client: S3Client

  constructor(opts: S3StorageOptions = {}) {
    const env = getEnv()
    this.bucket = opts.bucket ?? env.S3_BUCKET ?? 'palscans'
    this.publicUrl = opts.publicUrl ?? env.PUBLIC_CDN_URL ?? ''
    if (!this.publicUrl) throw new Error('PUBLIC_CDN_URL is required for the s3 storage driver')
    const accessKeyId = opts.accessKeyId ?? env.S3_ACCESS_KEY_ID
    const secretAccessKey = opts.secretAccessKey ?? env.S3_SECRET_ACCESS_KEY
    this.client =
      opts.client ??
      new S3Client({
        region: opts.region ?? env.S3_REGION ?? 'auto',
        endpoint: opts.endpoint ?? env.S3_ENDPOINT,
        forcePathStyle: opts.forcePathStyle ?? env.S3_FORCE_PATH_STYLE ?? false,
        ...(accessKeyId && secretAccessKey
          ? { credentials: { accessKeyId, secretAccessKey } }
          : {}),
      })
  }

  async put(key: string, body: Uint8Array | string, opts: PutOptions = {}): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: assertSafeKey(key),
        Body: body,
        ContentType: opts.contentType ?? contentTypeFor(key),
        CacheControl: opts.cacheControl ?? 'public, max-age=31536000, immutable',
        Metadata: opts.metadata,
      }),
    )
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: assertSafeKey(key) }),
      )
      return res.Body ? await res.Body.transformToByteArray() : null
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchKey') return null
      throw err
    }
  }

  async getSignedPutUrl(key: string, opts: SignedPutOptions = {}): Promise<SignedPutUrl> {
    const expiresIn = opts.expiresInSeconds ?? 900
    const contentType = opts.contentType ?? contentTypeFor(key)
    // ContentLength is part of the signature, so the browser cannot PUT a larger body
    // than the intent declared (the intent already caps it).
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: assertSafeKey(key),
        ContentType: contentType,
        ContentLength: opts.contentLength,
        CacheControl: opts.cacheControl,
      }),
      { expiresIn },
    )
    return {
      url,
      method: 'PUT',
      headers: {
        'content-type': contentType,
        ...(opts.contentLength !== undefined
          ? { 'content-length': String(opts.contentLength) }
          : {}),
      },
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    }
  }

  async getSignedGetUrl(key: string, expiresInSeconds = 600): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: assertSafeKey(key) }),
      { expiresIn: expiresInSeconds },
    )
  }

  getUrl(key: string): string {
    return joinUrl(this.publicUrl, assertSafeKey(key))
  }

  async head(key: string): Promise<ObjectInfo | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: assertSafeKey(key) }),
      )
      return { size: res.ContentLength ?? 0, contentType: res.ContentType ?? null }
    } catch (err) {
      if (isMissing(err)) return null
      throw err
    }
  }

  async getRange(key: string, start: number, end: number): Promise<Uint8Array | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: assertSafeKey(key),
          Range: `bytes=${start}-${end}`,
        }),
      )
      return res.Body ? await res.Body.transformToByteArray() : null
    } catch (err) {
      if (isMissing(err)) return null
      throw err
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: assertSafeKey(key) }),
    )
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: assertSafeKey(key) }),
      )
      return true
    } catch (err) {
      if (isMissing(err)) return false
      throw err
    }
  }
}
