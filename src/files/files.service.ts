import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import {
  StorageService,
  MULTIPART_THRESHOLD_BYTES,
  calculatePartSize,
} from './storage.service';

export interface CreateUploadIntentDto {
  contentType: string;
  filename?: string;
  size?: number;
}

interface FileRow {
  id: string;
  key: string;
  owner_id: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  size: string | null;
  upload_id: string | null;
  content_type: string;
  etag: string | null;
}

@Injectable()
export class FilesService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly storage: StorageService,
  ) {}

  async createIntent(userId: string, dto: CreateUploadIntentDto) {
    // filename from client is intentionally ignored; key is server-generated from validated contentType
    const key = this.storage.generateObjectKey(userId, dto.contentType);
    const size = dto.size !== undefined ? Number(dto.size) : null;
    const isMultipart = size !== null && size > MULTIPART_THRESHOLD_BYTES;

    if (isMultipart && size !== null) {
      const partSize = calculatePartSize(size);
      const partCount = Math.ceil(size / partSize);
      const uploadId = await this.storage.createMultipartUpload(key, dto.contentType);

      const res = await this.pool.query<{ id: string }>(
        `INSERT INTO files (key, owner_id, status, size, upload_id, content_type)
         VALUES ($1, $2, 'PENDING', $3, $4, $5)
         RETURNING id`,
        [key, userId, String(size), uploadId, dto.contentType],
      );
      const fileId = res.rows[0].id;

      const parts = await Promise.all(
        Array.from({ length: partCount }, async (_, idx) => {
          const partNumber = idx + 1;
          const uploadUrl = await this.storage.presignUploadPart(key, uploadId, partNumber);
          return { partNumber, uploadUrl };
        }),
      );

      return {
        fileId,
        key,
        mode: 'multipart' as const,
        uploadId,
        partSize,
        partCount,
        expiresIn: this.storage.presignedPutTtlSeconds,
        parts,
      };
    }

    const res = await this.pool.query<{ id: string }>(
      `INSERT INTO files (key, owner_id, status, size, upload_id, content_type)
       VALUES ($1, $2, 'PENDING', $3, NULL, $4)
       RETURNING id`,
      [key, userId, size !== null ? String(size) : null, dto.contentType],
    );
    const fileId = res.rows[0].id;
    const uploadUrl = await this.storage.presignPut(key, dto.contentType);

    return {
      fileId,
      key,
      mode: 'single' as const,
      uploadUrl,
      expiresIn: this.storage.presignedPutTtlSeconds,
    };
  }

  async commitUpload(userId: string, fileId: string) {
    const file = await this.findOwnedFile(userId, fileId);

    if (file.status === 'COMPLETED') {
      return {
        fileId: file.id,
        key: file.key,
        status: file.status,
        size: file.size ? Number(file.size) : 0,
        etag: file.etag,
      };
    }

    const head = await this.storage.headObject(file.key);
    if (!head.exists) {
      throw new ConflictException('Object has not been uploaded to storage yet');
    }

    if (file.size !== null && head.contentLength !== Number(file.size)) {
      throw new ConflictException(
        `Uploaded size mismatch: expected ${file.size}, got ${head.contentLength}`,
      );
    }

    await this.pool.query(
      `UPDATE files
       SET status = 'COMPLETED', size = $2, etag = $3, updated_at = now()
       WHERE id = $1`,
      [file.id, String(head.contentLength ?? 0), head.etag ?? null],
    );

    return {
      fileId: file.id,
      key: file.key,
      status: 'COMPLETED',
      size: head.contentLength ?? 0,
      etag: head.etag ?? null,
    };
  }

  async getMultipartParts(userId: string, fileId: string) {
    const file = await this.findOwnedFile(userId, fileId);
    if (!file.upload_id) {
      throw new BadRequestException('File is not a multipart upload');
    }

    const totalSize = Number(file.size ?? 0);
    const partSize = calculatePartSize(totalSize);
    const partCount = Math.ceil(totalSize / partSize);

    const uploadedParts = await this.storage.listParts(file.key, file.upload_id);
    const uploadedNumbers = new Set(uploadedParts.map((p) => p.partNumber));

    const missingParts: Array<{ partNumber: number; uploadUrl: string }> = [];
    for (let partNumber = 1; partNumber <= partCount; partNumber++) {
      if (!uploadedNumbers.has(partNumber)) {
        const uploadUrl = await this.storage.presignUploadPart(
          file.key,
          file.upload_id,
          partNumber,
        );
        missingParts.push({ partNumber, uploadUrl });
      }
    }

    return {
      fileId: file.id,
      key: file.key,
      uploadId: file.upload_id,
      partSize,
      partCount,
      uploadedParts,
      missingParts,
    };
  }

  async completeMultipart(userId: string, fileId: string) {
    const file = await this.findOwnedFile(userId, fileId);
    if (!file.upload_id) {
      throw new BadRequestException('File is not a multipart upload');
    }

    const uploadedParts = await this.storage.listParts(file.key, file.upload_id);
    if (uploadedParts.length === 0) {
      throw new ConflictException('No parts uploaded for multipart upload');
    }

    const completed = await this.storage.completeMultipartUpload(
      file.key,
      file.upload_id,
      uploadedParts,
    );

    const head = await this.storage.headObject(file.key);
    if (!head.exists) {
      throw new ConflictException('Completed object not found in storage');
    }

    if (file.size !== null && head.contentLength !== Number(file.size)) {
      throw new ConflictException(
        `Completed size mismatch: expected ${file.size}, got ${head.contentLength}`,
      );
    }

    const etag = head.etag ?? completed.etag ?? null;
    await this.pool.query(
      `UPDATE files
       SET status = 'COMPLETED', size = $2, etag = $3, updated_at = now()
       WHERE id = $1`,
      [file.id, String(head.contentLength ?? 0), etag],
    );

    return {
      fileId: file.id,
      key: file.key,
      status: 'COMPLETED',
      size: head.contentLength ?? 0,
      etag,
    };
  }

  async getDownloadRedirectUrl(userId: string, userRole: string, fileId: string): Promise<string> {
    const res = await this.pool.query<FileRow>(
      `SELECT id, key, owner_id, status, size, upload_id, content_type, etag
       FROM files WHERE id = $1`,
      [fileId],
    );
    const file = res.rows[0];
    if (!file) {
      throw new NotFoundException('File not found');
    }
    if (file.owner_id !== userId && userRole !== 'ADMIN') {
      throw new ForbiddenException('Access denied');
    }
    if (file.status !== 'COMPLETED') {
      throw new ConflictException('File upload is not completed');
    }
    // Short-lived presigned GET (60s); never logged
    return this.storage.presignGet(file.key, 60);
  }

  private async findOwnedFile(userId: string, fileId: string): Promise<FileRow> {
    const res = await this.pool.query<FileRow>(
      `SELECT id, key, owner_id, status, size, upload_id, content_type, etag
       FROM files WHERE id = $1`,
      [fileId],
    );
    const file = res.rows[0];
    if (!file) {
      throw new NotFoundException('File not found');
    }
    if (file.owner_id !== userId) {
      throw new ForbiddenException('Access denied');
    }
    return file;
  }
}
