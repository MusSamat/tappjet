import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { detectImageMime, persistImage, removeImage } from './uploads.js';
import { env } from '@/config/env.js';

// Shortest possible valid JPEG and PNG byte sequences for magic-byte tests —
// these aren't decodable images but they carry the signature and that's what
// the validator inspects.
const jpegBytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
const pngBytes = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(100),
]);

function fakeFile(buffer: Buffer, mimetype: string, name = 'x.jpg'): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: name,
    encoding: '7bit',
    mimetype,
    size: buffer.length,
    buffer,
    destination: '',
    filename: '',
    path: '',
    stream: null as never,
  };
}

const created: string[] = [];
afterEach(async () => {
  for (const p of created) await removeImage(p);
  created.length = 0;
});

describe('detectImageMime', () => {
  it('recognises JPEG magic bytes', () => {
    expect(detectImageMime(jpegBytes)).toBe('image/jpeg');
  });
  it('recognises PNG magic bytes', () => {
    expect(detectImageMime(pngBytes)).toBe('image/png');
  });
  it('returns null for an unknown prefix', () => {
    expect(detectImageMime(Buffer.from('hello world'))).toBeNull();
  });
});

describe('persistImage', () => {
  it('writes the file under FILES_DIR/<category>/<year>/<month>', async () => {
    const stored = await persistImage(fakeFile(jpegBytes, 'image/jpeg'), 'driver_license');
    created.push(stored.path);
    expect(stored.mime).toBe('image/jpeg');
    expect(stored.path).toMatch(/^driver_license\/\d{4}\/\d{2}\/[a-f0-9]{16}-[\w-]+\.jpg$/);
    await expect(fs.access(path.join(env.FILES_DIR, stored.path))).resolves.toBeUndefined();
  });

  it('rejects a file with bad magic bytes even when MIME claims JPEG', async () => {
    const lies = fakeFile(Buffer.from('not-an-image'), 'image/jpeg');
    await expect(persistImage(lies, 'x')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects when declared MIME contradicts detected (JPEG bytes, claims PNG)', async () => {
    const mismatch = fakeFile(jpegBytes, 'image/png');
    await expect(persistImage(mismatch, 'x')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
