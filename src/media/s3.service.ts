import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
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

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly region: string;
  private readonly cdnBaseUrl: string | null;

  constructor() {
    this.region = process.env.AWS_REGION || 'us-east-1';
    this.bucket = process.env.AWS_S3_BUCKET || '';
    this.cdnBaseUrl = process.env.CDN_BASE_URL?.replace(/\/+$/, '') || null;

    this.s3Client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
  }

  /** Build public URL — uses CDN if configured, otherwise falls back to direct S3 */
  buildPublicUrl(key: string): string {
    if (this.cdnBaseUrl) {
      return `${this.cdnBaseUrl}/${key}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  /** Generate a Lambda-ready S3 key: {folder}/{year}/{uuid}/original.{ext} */
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

  /** Legacy: upload file buffer from backend (backward compat) */
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

  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const url = await getSignedUrl(this.s3Client, command, { expiresIn });
      return url;
    } catch (error) {
      this.logger.error('Error generating signed URL', error);
      throw error;
    }
  }
}
