/**
 * Thin re-export of the @palscans/core storage adapter for app code (docs/16 "Storage").
 * Import from here rather than the core root barrel so client bundles never see BullMQ.
 */
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
