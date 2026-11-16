import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  DeleteBucketPolicyCommand,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { Env } from '../config/env.schema';

export const S3_MAX_PARTS = 10_000;
export const S3_MIN_PART_SIZE = 5 * 1024 * 1024; // 5 MiB S3 minimum for non-final parts
export const MULTIPART_THRESHOLD_BYTES = 2 * S3_MIN_PART_SIZE; // 10 MiB

export const CONTENT_TYPE_ALLOWLIST: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/octet-stream': 'bin',
  'text/css': 'css',
  'application/javascript': 'js',
  'text/plain': 'txt',
  'application/gzip': 'gz',
};

/**
 * Computes a valid S3 multipart part size from total file size:
 * - At most 10,000 parts (ceil(fileSize / 10_000))
 * - At least 5 MiB per part (S3 minimum for all parts except the last)
 */
export function calculatePartSize(fileSize: number): number {
  const minForPartLimit = Math.ceil(fileSize / S3_MAX_PARTS);
  return Math.max(S3_MIN_PART_SIZE, minForPartLimit);
}

export interface HeadObjectResult {
  exists: boolean;
  contentLength?: number;
  etag?: string;
}

export interface UploadedPartInfo {
  partNumber: number;
  etag: string;
  size: number;
}

@Injectable()
export class StorageService {
  readonly client: S3Client;
  readonly bucket: string;
  readonly endpoint?: string;
  readonly presignedPutTtlSeconds: number;

  constructor(private readonly configService: ConfigService<Env, true>) {
    this.endpoint = this.configService.get('STORAGE_ENDPOINT', { infer: true }) || undefined;
    const region = this.configService.get('STORAGE_REGION', { infer: true });
    this.bucket = this.configService.get('STORAGE_BUCKET', { infer: true });
    const accessKeyId = this.configService.get('STORAGE_ACCESS_KEY', { infer: true });
    const secretAccessKey = this.configService.get('STORAGE_SECRET_KEY', { infer: true });
    this.presignedPutTtlSeconds = this.configService.get('PRESIGNED_PUT_TTL_SECONDS', {
      infer: true,
    });

    this.client = new S3Client({
      region,
      endpoint: this.endpoint,
      forcePathStyle: Boolean(this.endpoint),
      credentials: { accessKeyId, secretAccessKey },
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }

  /**
   * Generates a server-controlled object key from validated contentType.
   * Client-supplied filename is never included in the key.
   */
  generateObjectKey(userId: string, contentType: string): string {
    const ext = CONTENT_TYPE_ALLOWLIST[contentType];
    if (!ext) {
      throw new BadRequestException(`Unsupported contentType: ${contentType}`);
    }
    return `uploads/${userId}/${randomUUID()}.${ext}`;
  }

  async ensureBucketPrivate(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
    try {
      await this.client.send(new DeleteBucketPolicyCommand({ Bucket: this.bucket }));
    } catch {
      // Ignore if bucket policy did not exist
    }
  }

  async presignPut(
    key: string,
    contentType: string,
    expiresInSeconds = this.presignedPutTtlSeconds,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async presignGet(key: string, expiresInSeconds = 60): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async createMultipartUpload(key: string, contentType: string): Promise<string> {
    const res = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!res.UploadId) {
      throw new Error('S3 CreateMultipartUpload did not return UploadId');
    }
    return res.UploadId;
  }

  async presignUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresInSeconds = this.presignedPutTtlSeconds,
  ): Promise<string> {
    const command = new UploadPartCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async listParts(key: string, uploadId: string): Promise<UploadedPartInfo[]> {
    const parts: UploadedPartInfo[] = [];
    let partNumberMarker: string | undefined;

    do {
      const res = await this.client.send(
        new ListPartsCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumberMarker: partNumberMarker,
        }),
      );
      for (const p of res.Parts ?? []) {
        if (p.PartNumber !== undefined && p.ETag) {
          parts.push({
            partNumber: p.PartNumber,
            etag: p.ETag,
            size: p.Size ?? 0,
          });
        }
      }
      partNumberMarker = res.IsTruncated ? res.NextPartNumberMarker : undefined;
    } while (partNumberMarker);

    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: UploadedPartInfo[],
  ): Promise<{ etag?: string }> {
    const res = await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((p) => ({
            PartNumber: p.partNumber,
            ETag: p.etag,
          })),
        },
      }),
    );
    return { etag: res.ETag };
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  async headObject(key: string): Promise<HeadObjectResult> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return {
        exists: true,
        contentLength: res.ContentLength,
        etag: res.ETag,
      };
    } catch (err: any) {
      const status = err?.$metadata?.httpStatusCode;
      if (status === 404 || err?.name === 'NotFound' || err?.name === 'NoSuchKey') {
        return { exists: false };
      }
      throw err;
    }
  }

  async putObject(
    key: string,
    body: Buffer | string,
    contentType: string,
    cacheControl?: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ...(cacheControl ? { CacheControl: cacheControl } : {}),
      }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  async cleanupPrefix(prefix: string): Promise<void> {
    const uploads = await this.client.send(
      new ListMultipartUploadsCommand({
        Bucket: this.bucket,
        Prefix: prefix,
      }),
    );
    for (const u of uploads.Uploads ?? []) {
      if (u.Key && u.UploadId) {
        await this.abortMultipartUpload(u.Key, u.UploadId).catch(() => undefined);
      }
    }

    const objects = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
      }),
    );
    for (const obj of objects.Contents ?? []) {
      if (obj.Key) {
        await this.deleteObject(obj.Key).catch(() => undefined);
      }
    }
  }
}
