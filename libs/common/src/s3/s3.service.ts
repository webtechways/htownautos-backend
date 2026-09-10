import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListObjectsV2Command,
  type ObjectCannedACL,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

export interface UploadResult {
  url: string;
  key: string;
  bucket: string;
  size: number;
  mimeType: string;
}

export interface PresignResult {
  uploadUrl: string;
  key: string;
  publicUrl: string;
}

export interface HeadObjectResult {
  exists: boolean;
  contentLength: number;
  contentType: string;
}

/**
 * One storage backend. The default profile is the PRIVATE bucket (documents,
 * recordings, buyer IDs); {@link PublicS3Service} overrides it with the public
 * one that serves gallery images through the CDN. They are separate buckets
 * because Backblaze B2 — unlike Spaces — has no per-object ACL: visibility is a
 * property of the bucket, so mixing both in one would publish everything.
 */
export interface S3Profile {
  endpoint?: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  cdnBaseUrl?: string | null;
}

@Injectable()
export class S3Service {
  protected readonly logger = new Logger(S3Service.name);
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly region: string;
  private readonly endpoint: string | null;
  private readonly cdnBaseUrl: string | null;

  /**
   * NO constructor parameters: Nest reads the constructor metadata of an
   * @Injectable and tries to resolve every argument, so an optional
   * `profile?: S3Profile` becomes an unresolvable `Object` dependency and the
   * whole API crash-loops on boot. Subclasses override `resolveProfile()`
   * instead.
   */
  constructor() {
    const cfg = this.resolveProfile();

    this.region = cfg.region;
    this.bucket = cfg.bucket;
    this.endpoint = cfg.endpoint?.replace(/\/+$/, '') || null;
    this.cdnBaseUrl = cfg.cdnBaseUrl?.replace(/\/+$/, '') || null;

    // No se lanza excepcion: un throw aqui deja a Nest sin resolver el
    // proveedor y la API entera entra en bucle de reinicio. Se avisa fuerte y
    // el primer uso fallara con un error que se entiende.
    if (!this.bucket || !cfg.accessKeyId) {
      this.logger.error(
        `[S3] Perfil sin configurar (bucket="${this.bucket}"). ` +
          'Revisa B2_ENDPOINT / B2_BUCKET_PRIVATE / B2_BUCKET_PUBLIC / B2_KEY_ID / B2_APP_KEY.',
      );
    }

    this.s3Client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      ...(this.endpoint && { endpoint: this.endpoint, forcePathStyle: false }),
    });
  }

  /**
   * La region va dentro del propio host de B2
   * (`s3.us-east-005.backblazeb2.com`), asi que se deduce en vez de pedir otra
   * variable que se pueda quedar desincronizada de la anterior.
   */
  protected static regionFromHost(host?: string): string {
    return host?.match(/s3\.([a-z0-9-]+)\.backblazeb2/)?.[1] ?? 'us-east-005';
  }

  /** `s3.x.backblazeb2.com` o `https://s3.x…` -> siempre con esquema. */
  protected static toEndpoint(host?: string): string | undefined {
    if (!host) return undefined;
    return /^https?:\/\//.test(host) ? host : `https://${host}`;
  }

  /**
   * Perfil por defecto: el bucket **privado**.
   *
   * Solo lee variables `B2_*`. Antes caia a `AWS_S3_*` y de ahi a
   * `AWS_S3_BUCKET_PUBLIC`, y eso es exactamente como acabaron los documentos
   * privados apuntando a un DigitalOcean que ya no existe: la migracion cambio
   * el perfil publico y el privado se quedo con el endpoint viejo sin que nada
   * lo dijera. Sin respaldos silenciosos, una variable mal puesta se nota.
   */
  protected resolveProfile(): S3Profile {
    const host = process.env.B2_ENDPOINT;
    return {
      endpoint: S3Service.toEndpoint(host),
      bucket: process.env.B2_BUCKET_PRIVATE || '',
      region: S3Service.regionFromHost(host),
      accessKeyId: process.env.B2_KEY_ID || '',
      secretAccessKey: process.env.B2_APP_KEY || '',
      // Sin CDN: lo privado se sirve siempre con URL firmada.
      cdnBaseUrl: undefined,
    };
  }

  /** Build public URL — CDN if configured, else the provider's own host. */
  buildPublicUrl(key: string): string {
    if (this.cdnBaseUrl) {
      return `${this.cdnBaseUrl}/${key}`;
    }
    // Any S3-compatible provider (Spaces, B2, R2…) reached by its endpoint.
    if (this.endpoint) {
      return `${this.endpoint}/${this.bucket}/${key}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  /**
   * Sum the total size (bytes) and object count under a key prefix by paginating
   * ListObjectsV2. Used for the "Storage" stat over the `gallery/` prefix. This
   * lists every object, so call it from a throttled/background path, not per-request.
   */
  async sumPrefixSize(prefix: string): Promise<{ bytes: number; objects: number }> {
    let bytes = 0;
    let objects = 0;
    let token: string | undefined;

    do {
      const res = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
          MaxKeys: 1000,
        }),
      );
      for (const o of res.Contents ?? []) {
        bytes += o.Size ?? 0;
        objects += 1;
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);

    return { bytes, objects };
  }

  /**
   * Delete every object under a key prefix, 1000 at a time. Returns how many
   * objects were removed. Used by gallery retention — the prefix is always
   * `gallery/<lot>/`, so a caller can never wipe a whole folder by accident with
   * an empty prefix (guarded below).
   */
  async deletePrefix(prefix: string): Promise<number> {
    if (!prefix || prefix.trim().length < 2) {
      throw new Error('deletePrefix requires a non-trivial prefix');
    }

    let deleted = 0;
    let token: string | undefined;

    do {
      const listed = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
          MaxKeys: 1000,
        }),
      );
      const keys = (listed.Contents ?? [])
        .map((o) => o.Key)
        .filter((k): k is string => !!k);

      if (keys.length) {
        await this.s3Client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        deleted += keys.length;
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);

    return deleted;
  }

  /** Generate an S3 key: {folder}/{year}/{uuid}/original.{ext} */
  generateKey(folder: string, fileExtension: string): string {
    const uuid = randomUUID();
    const year = new Date().getFullYear();
    return `${folder}/${year}/${uuid}/original.${fileExtension}`;
  }

  /** Generate a presigned PUT URL for direct client-to-S3 upload */
  async generatePresignedPutUrl(
    folder: string,
    fileExtension: string,
    contentType: string,
    isPrivate: boolean = false,
    expiresIn: number = 300,
  ): Promise<PresignResult> {
    const key = this.generateKey(folder, fileExtension);

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn });
    const publicUrl = this.buildPublicUrl(key);

    this.logger.log(`Presigned PUT URL generated: ${key} (${isPrivate ? 'private' : 'public'})`);

    return { uploadUrl, key, publicUrl };
  }

  /** Verify a file exists in S3 via HeadObject */
  async headObject(key: string): Promise<HeadObjectResult> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const response = await this.s3Client.send(command);
      return {
        exists: true,
        contentLength: response.ContentLength ?? 0,
        contentType: response.ContentType ?? 'application/octet-stream',
      };
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return { exists: false, contentLength: 0, contentType: '' };
      }
      throw error;
    }
  }

  /** Upload file buffer from backend */
  async uploadFile(
    file: Express.Multer.File,
    folder: string = 'uploads',
    isPrivate: boolean = false,
  ): Promise<UploadResult> {
    try {
      const fileExtension = file.originalname.split('.').pop() || 'bin';
      const key = this.generateKey(folder, fileExtension);

      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      });

      await this.s3Client.send(command);

      const url = this.buildPublicUrl(key);

      this.logger.log(`File uploaded successfully: ${key} (${isPrivate ? 'private' : 'public'})`);

      return {
        url,
        key,
        bucket: this.bucket,
        size: file.size,
        mimeType: file.mimetype,
      };
    } catch (error) {
      this.logger.error('Error uploading file to S3', error);
      throw error;
    }
  }

  /** Upload a buffer directly to S3 (for generated content like TTS audio) */
  async uploadBuffer(
    buffer: Buffer,
    folder: string,
    fileExtension: string,
    contentType: string,
  ): Promise<UploadResult> {
    try {
      const key = this.generateKey(folder, fileExtension);

      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      });

      await this.s3Client.send(command);

      const url = this.buildPublicUrl(key);

      this.logger.log(`Buffer uploaded successfully: ${key}`);

      return {
        url,
        key,
        bucket: this.bucket,
        size: buffer.length,
        mimeType: contentType,
      };
    } catch (error) {
      this.logger.error('Error uploading buffer to S3', error);
      throw error;
    }
  }

  async deleteFile(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.s3Client.send(command);
      this.logger.log(`File deleted successfully: ${key}`);
    } catch (error) {
      this.logger.error('Error deleting file from S3', error);
      throw error;
    }
  }

  /** Upload a buffer to S3 with a specific key */
  async uploadBufferToKey(
    buffer: Buffer,
    key: string,
    contentType: string,
    acl?: ObjectCannedACL,
  ): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ...(acl && { ACL: acl }),
    });
    await this.s3Client.send(command);
  }

  /**
   * Sube un fichero desde disco por streaming.
   *
   * Existe para el volcado de la base de datos: son cientos de MB y meterlos en
   * un Buffer se lleva por delante el contenedor. Con `ContentLength` conocido
   * el SDK puede mandarlo sin bufferizarlo.
   */
  async uploadStreamToKey(
    body: NodeJS.ReadableStream,
    key: string,
    contentLength: number,
    contentType = 'application/octet-stream',
  ): Promise<void> {
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body as any,
        ContentLength: contentLength,
        ContentType: contentType,
      }),
    );
  }

  /** Objetos bajo un prefijo, con su fecha y tamaño. Para purgas por antiguedad. */
  async listPrefix(prefix: string): Promise<Array<{ key: string; size: number; modified: Date }>> {
    const out: Array<{ key: string; size: number; modified: Date }> = [];
    let token: string | undefined;
    do {
      const res = await this.s3Client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of res.Contents ?? []) {
        if (o.Key) out.push({ key: o.Key, size: o.Size ?? 0, modified: o.LastModified ?? new Date(0) });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  /** Borra objetos por clave exacta. */
  async deleteKeys(keys: string[]): Promise<number> {
    if (!keys.length) return 0;
    await this.s3Client.send(
      new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })) },
      }),
    );
    return keys.length;
  }

  /** Download an external URL and upload to S3 with a specific key */
  async uploadFromUrl(url: string, key: string, contentType: string = 'image/jpeg', acl?: ObjectCannedACL): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ...(acl && { ACL: acl }),
    });

    await this.s3Client.send(command);
  }

  /** Download a file from S3 as a Buffer */
  async downloadBuffer(key: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const response = await this.s3Client.send(command);
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as any) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      this.logger.error(`Error downloading file from S3: ${key}`, error);
      throw error;
    }
  }

  async getSignedUrl(
    key: string,
    expiresIn: number = 3600,
    options?: { contentType?: string; disposition?: 'inline' | 'attachment' },
  ): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        // Force how the browser handles the object (e.g. render a PDF inline
        // in an <iframe> instead of downloading it).
        ...(options?.contentType
          ? { ResponseContentType: options.contentType }
          : {}),
        ...(options?.disposition
          ? { ResponseContentDisposition: options.disposition }
          : {}),
      });

      const url = await getSignedUrl(this.s3Client, command, { expiresIn });
      return url;
    } catch (error) {
      this.logger.error('Error generating signed URL', error);
      throw error;
    }
  }

  /**
   * Replace each attachment's `url` on the given records with a short-lived
   * presigned S3 URL, based on each attachment's `key`. Mutates in place.
   *
   * Safe on heterogeneous shapes:
   *   - records may be arbitrary objects; only those with `attachments: []`
   *     and entries having `.key` get signed.
   *   - a key that fails to sign is left with an empty url so the UI can still
   *     render the metadata.
   */
  async signAttachmentsOnRecords(records: any[], expiresIn = 3600): Promise<void> {
    if (!records?.length) return;
    const tasks: Promise<void>[] = [];
    for (const rec of records) {
      if (!Array.isArray(rec?.attachments)) continue;
      for (const att of rec.attachments) {
        if (!att || typeof att !== 'object' || !att.key) continue;
        tasks.push(
          this.getSignedUrl(att.key, expiresIn)
            .then((signed) => {
              att.url = signed;
            })
            .catch(() => {
              att.url = '';
            }),
        );
      }
    }
    await Promise.all(tasks);
  }

  /**
   * Start an S3 multipart upload. Returns the upload session id that the
   * caller will reference when uploading individual parts and when
   * completing/aborting the upload.
   */
  async initMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<{ uploadId: string }> {
    const command = new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    const response = await this.s3Client.send(command);
    if (!response.UploadId) {
      throw new Error('S3 did not return an UploadId for multipart init');
    }
    this.logger.log(`Multipart upload started: ${key} (uploadId=${response.UploadId})`);
    return { uploadId: response.UploadId };
  }

  /**
   * Presign a single part of an in-flight multipart upload. The browser
   * will PUT the chunk bytes to this URL directly and read the `ETag` from
   * the response header to pass back into `completeMultipartUpload`.
   *
   * Part numbers are 1-indexed (S3 contract).
   */
  async presignUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn = 3600,
  ): Promise<string> {
    const command = new UploadPartCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });
    return getSignedUrl(this.s3Client, command, { expiresIn });
  }

  /**
   * Finalize a multipart upload. `parts` must be sorted ascending by
   * partNumber; S3 reassembles in that order. ETags are passed through
   * verbatim — DO Spaces (and some other S3-compatibles) include the
   * surrounding quotes and re-quoting / unquoting trips them up.
   */
  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: { partNumber: number; etag: string }[],
  ): Promise<void> {
    if (!parts.length) {
      throw new Error('completeMultipartUpload called with empty parts array');
    }
    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const command = new CompleteMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: sorted.map((p) => ({ ETag: p.etag, PartNumber: p.partNumber })),
      },
    });
    await this.s3Client.send(command);
    this.logger.log(`Multipart upload completed: ${key} (${sorted.length} parts)`);
  }

  /**
   * Abort an in-flight multipart upload. Idempotent: if S3 reports the
   * upload no longer exists, we treat it as a successful no-op so callers
   * can safely retry abort.
   *
   * Always call this when a multipart upload fails mid-way — otherwise
   * the uploaded parts stay in S3 and keep accruing storage cost.
   */
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    try {
      const command = new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      });
      await this.s3Client.send(command);
      this.logger.log(`Multipart upload aborted: ${key} (uploadId=${uploadId})`);
    } catch (error: any) {
      // S3 returns NoSuchUpload when the upload was already aborted or
      // completed; that's fine — keep the call idempotent.
      if (
        error?.name === 'NoSuchUpload' ||
        error?.$metadata?.httpStatusCode === 404
      ) {
        this.logger.log(`Multipart upload already gone: ${key}`);
        return;
      }
      throw error;
    }
  }
}
