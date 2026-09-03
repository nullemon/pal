/**
 * Thin re-export of the @palscans/core storage adapter for app code (docs/16 "Storage").
 * Import from here rather than the core root barrel so client bundles never see BullMQ.
 *
 * Importing `../config/install` for its side effect is what points `getStorage()` at the
 * credentials stored in the admin panel. It has to happen in the app's own module graph —
 * installing it from `instrumentation.ts` silently does not apply, because Next bundles that
 * separately (docs/19). Import `getStorage` from here, never from `@palscans/core/storage`.
 */
import '../config/install'

export {
  assertSafeKey,
  CONTENT_TYPES,
  contentTypeFor,
  createStorage,
  FsStorage,
  getStorage,
  joinUrl,
  MAX_ORIGINAL_BYTES,
  type ObjectInfo,
  type PutOptions,
  resolveFsRoot,
  type SignedPutOptions,
  type SignedPutUrl,
  type Storage,
  type StorageDriver,
} from '@palscans/core/storage'
export {
  presignUpload,
  SIGNED_URL_TTL_SEC,
  signedStorageUrl,
  sniffImage,
  storageGetSignature,
  storageUrl,
  UPLOAD_TTL_MS,
  type UploadedObjectCheck,
  uploadSignature,
  verifyStorageGetSignature,
  verifyUploadedObject,
  verifyUploadSignature,
} from './upload'
