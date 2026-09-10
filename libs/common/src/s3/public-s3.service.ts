import { Injectable, Logger } from '@nestjs/common';
import { S3Service } from './s3.service';

/**
 * The PUBLIC storage profile: Copart gallery images, served straight from the
 * CDN with no signing.
 *
 * It is a different bucket rather than a different ACL because Backblaze B2 —
 * unlike DigitalOcean Spaces — has no per-object visibility: a bucket is public
 * or private as a whole. Verified against the real buckets: an object in the
 * public one downloads with no credentials (200), one in the private bucket
 * answers 401.
 *
 * Solo lee variables `B2_*`, sin respaldo al perfil privado: un fallo de
 * configuracion tiene que romper a la vista, no publicar galerias desde el
 * bucket equivocado ni escribir documentos privados en el publico.
 */
@Injectable()
export class PublicS3Service extends S3Service {
  protected readonly logger = new Logger(PublicS3Service.name);

  protected resolveProfile() {
    const host = process.env.B2_ENDPOINT;
    return {
      endpoint: S3Service.toEndpoint(host),
      bucket: process.env.B2_BUCKET_PUBLIC || '',
      region: S3Service.regionFromHost(host),
      accessKeyId: process.env.B2_KEY_ID || '',
      secretAccessKey: process.env.B2_APP_KEY || '',
      // Sin esto las galerias se servirian desde B2 directamente, saltandose
      // Cloudflare — y ahi es donde esta la salida gratis.
      cdnBaseUrl: process.env.B2_CDN_URL,
    };
  }
}
