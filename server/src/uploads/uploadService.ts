import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

/**
 * Phase F1 — persistent admin image storage.
 *
 * Uploaded images live under `<server>/data/uploads/<category>/` (the same
 * persistent data root the SQLite database uses). They are NEVER written into
 * `client/public` or `client/dist`, so a production rebuild cannot wipe them.
 *
 * Filenames are always server-generated (random UUID + verified extension) —
 * the client-supplied filename is never used as a filesystem path.
 */

export type UploadCategory = 'games' | 'tournaments';

/** Explicit, enforced image size ceiling (5 MB). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

interface ImageKind {
  ext: string;
  mime: string;
}

const WEBP: ImageKind = { ext: '.webp', mime: 'image/webp' };
const PNG: ImageKind = { ext: '.png', mime: 'image/png' };
const JPEG: ImageKind = { ext: '.jpg', mime: 'image/jpeg' };

const MIME_TO_KIND: Record<string, ImageKind> = {
  [WEBP.mime]: WEBP,
  [PNG.mime]: PNG,
  [JPEG.mime]: JPEG,
};

export function isAllowedImageMime(mime: string): boolean {
  return Object.prototype.hasOwnProperty.call(MIME_TO_KIND, mime);
}

/**
 * Content sniffing (magic bytes) — the browser's declared MIME and the file
 * extension are never trusted on their own. Returns the verified kind or null.
 */
export function sniffImageKind(buffer: Buffer): ImageKind | null {
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return WEBP;
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
    return PNG;
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return JPEG;
  }
  return null;
}

/** Root directory for all uploads (persistent, outside any client bundle). */
export function uploadsRootDir(): string {
  // __dirname is <server>/dist/uploads (built) or <server>/src/uploads (dev);
  // two levels up lands on the server root in both cases.
  return path.resolve(__dirname, '..', '..', 'data', 'uploads');
}

export function categoryDir(category: UploadCategory): string {
  const dir = path.join(uploadsRootDir(), category);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Validates and persists an in-memory upload. Only the verified image kind
 * determines the stored extension; the file is written with `wx` so an
 * existing path can never be overwritten.
 */
export function storeImage(
  category: UploadCategory,
  buffer: Buffer
): { url: string; filename: string } {
  const kind = sniffImageKind(buffer);
  if (!kind) {
    throw new Error('unsupported_image');
  }

  const filename = `${crypto.randomUUID()}${kind.ext}`;
  const destination = path.join(categoryDir(category), filename);
  fs.writeFileSync(destination, buffer, { flag: 'wx' });

  return { url: `/api/uploads/${category}/${filename}`, filename };
}
