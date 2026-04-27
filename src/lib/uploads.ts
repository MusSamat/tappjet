import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import multer, { type FileFilterCallback } from 'multer';
import type { Request } from 'express';
import { env } from '@/config/env.js';
import { Errors } from '@/lib/errors.js';

/**
 * Upload layer for the MVP disk-store. TZ §4.1 + §9.3:
 *   • Only image/jpeg and image/png
 *   • Max 5 MB
 *   • MIME + magic bytes both checked (defence in depth — clients can lie about
 *     the Content-Type; magic bytes are the authoritative signal)
 *   • Stored under FILES_DIR/<year>/<month>/<sha256(random).ext> — flat enough to
 *     browse but partitioned so a single dir never grows unbounded
 *
 * Later (Stage 2) this swaps to an S3-compatible store without touching call sites.
 */

const MAX_BYTES = env.MAX_UPLOAD_MB * 1024 * 1024;

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png']);

// Magic byte signatures.
//   JPEG: FF D8 FF
//   PNG:  89 50 4E 47 0D 0A 1A 0A
export function detectImageMime(buffer: Buffer): 'image/jpeg' | 'image/png' | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  return null;
}

const fileFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback): void => {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    cb(Errors.validation({ reason: 'unsupported_mime', mimetype: file.mimetype }));
    return;
  }
  cb(null, true);
};

// Use memory storage so magic-byte validation happens *before* writing to disk —
// no partially-persisted payload if a malicious upload sneaks past the MIME check.
export const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 10 },
  fileFilter,
});

export interface StoredFile {
  path: string;    // DB-friendly relative path (what we write into *_path columns)
  absPath: string; // on-disk absolute path
  mime: 'image/jpeg' | 'image/png';
  size: number;
  sha256: string;
}

export async function persistImage(
  file: Express.Multer.File,
  category: string,
): Promise<StoredFile> {
  const detected = detectImageMime(file.buffer);
  if (!detected) {
    throw Errors.validation({ reason: 'bad_magic_bytes' });
  }
  if (detected !== file.mimetype) {
    // MIME lied — treat as malicious.
    throw Errors.validation({
      reason: 'mime_mismatch',
      declared: file.mimetype,
      actual: detected,
    });
  }

  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');

  const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const ext = detected === 'image/png' ? 'png' : 'jpg';
  // Random component prevents enumeration; sha256 prefix gives a stable content
  // address for deduplication at the application level if we want it later.
  const token = crypto.randomBytes(12).toString('base64url');
  const filename = `${sha256.slice(0, 16)}-${token}.${ext}`;

  const relDir = path.posix.join(category, yyyy, mm);
  const relPath = path.posix.join(relDir, filename);

  const absDir = path.join(env.FILES_DIR, relDir);
  const absPath = path.join(env.FILES_DIR, relPath);

  await fs.mkdir(absDir, { recursive: true });
  await fs.writeFile(absPath, file.buffer, { mode: 0o640 });

  return { path: relPath, absPath, mime: detected, size: file.size, sha256 };
}

export async function removeImage(relPath: string | null | undefined): Promise<void> {
  if (!relPath) return;
  const abs = path.join(env.FILES_DIR, relPath);
  await fs.unlink(abs).catch(() => undefined); // idempotent — swallow ENOENT
}

export function toFileUrl(relPath: string | null | undefined): string | null {
  if (!relPath) return null;
  return `${env.BASE_URL}/${relPath}`;
}
