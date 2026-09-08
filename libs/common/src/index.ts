// Audit Module
export { AuditModule } from './audit.module';

// DTOs
export { PaginatedResponseDto, PaginationMeta } from './dto/paginated-response.dto';
export { PaginationDto } from './dto/pagination.dto';

// Decorators
export { AuditLog, AUDIT_LOG_KEY } from './decorators/audit-log.decorator';
export type { AuditLogMetadata } from './decorators/audit-log.decorator';
export { TransformEmptyToUndefined } from './decorators/transform-empty-to-undefined.decorator';

// Validators
export { IsValidSSN, IsValidSSNConstraint } from './validators/ssn.validator';
export { IsValidVIN, IsValidVINConstraint } from './validators/vin.validator';

// Pipes
export { GlobalValidationPipe } from './pipes/sanitize.pipe';

// Transformers
export { SanitizeString, NormalizeSSN, NormalizeVIN, NormalizeEmail, NormalizePhone, CapitalizeName, SanitizeURL } from './transformers/sanitize.transformer';

// Utils
export { normalizePhoneNumber, isValidE164, formatPhoneForDisplay, phoneNumbersMatch } from './utils/phone.utils';
export {
  slugifyUsername,
  baseUsernameForUser,
  findAvailableUsername,
  buildTenantEmail,
  resolveTenantUserIdentity,
} from './utils/tenant-email.utils';
export {
  TITLE_CATEGORIES,
  ASSIGNABLE_TITLE_CATEGORIES,
  TITLE_CATEGORY_LABELS,
  TITLE_CATEGORY_CODES,
  deriveTitleCategory,
  codesForTitleCategories,
  allKnownCodes,
} from './utils/title-category.utils';
export type { TitleCategory, TitleOverrides } from './utils/title-category.utils';
export {
  SELLER_CATEGORIES,
  deriveSellerCategory,
  parseEngineSizeL,
} from './utils/auction-derive.utils';
export type { SellerCategory } from './utils/auction-derive.utils';
export { deriveSellerRisk, explainSellerRisk, SELLER_RISKS } from './utils/seller-risk.utils';
export {
  decodeSolaceFrame,
  looksLikeAuctionFrame,
  normalizeLot,
  isSaleEvent,
  isBidEvent,
} from './auction/solace-frame.decoder';
export type { DecodedFrame, AuctionEventType } from './auction/solace-frame.decoder';
export type { SellerRisk } from './utils/seller-risk.utils';
export {
  CANONICAL_FIELDS,
  normalizeToken,
  canonicalize,
} from './utils/auction-canonical.utils';
export type { CanonicalField, AliasMap } from './utils/auction-canonical.utils';
export { geocodeZip, haversineMiles, boundingBox } from './utils/geo.utils';
export type { LatLng } from './utils/geo.utils';

// Interceptors
export { AuditLogInterceptor } from './interceptors/audit-log.interceptor';
export { TenantInterceptor } from './interceptors/tenant.interceptor';

// S3 Service (shared across all apps)
export { S3Service } from './s3/s3.service';
export type { S3Profile } from './s3/s3.service';
// Public bucket (gallery images). Separate bucket because B2 has no per-object ACL.
export { PublicS3Service } from './s3/public-s3.service';
// Reparte las subastas del calendario entre agentes (cron en data-sync, botón en la api).
export { AgentAssignmentService } from './auction/agent-assignment.service';
export type { AssignmentResult } from './auction/agent-assignment.service';
export {
  isAssignmentEditable,
  houstonHour,
  houstonSaleDate,
  LOCK_FROM_HOUR,
  LOCK_TO_HOUR,
} from './auction/agent-assignment.service';
export type { UploadResult, PresignResult, HeadObjectResult } from './s3/s3.service';

// Proxy Service
export { ProxyService, ImageFetchBlockedError } from './proxy/proxy.service';

// Copart images (shared gallery fetch + queue contract)
export { CopartImagesService } from './copart/copart-images.service';
export type { GalleryImage, GalleryResponse } from './copart/copart-images.service';
export { GALLERY_CACHE_QUEUE } from './copart/gallery-cache.constants';
export type { GalleryCacheMessage } from './copart/gallery-cache.constants';

// Concurrency
export { mapWithConcurrency } from './utils/concurrency.utils';
