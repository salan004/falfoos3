import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { requirePermission, requireSuperAdmin } from '../middleware/authorize';
import {
  MAX_IMAGE_BYTES,
  isAllowedImageMime,
  storeImage,
  type UploadCategory,
} from '../uploads/uploadService';

/**
 * Phase F1 — admin image upload endpoints.
 *
 * `POST /api/admin/uploads/games` and `POST /api/admin/uploads/tournaments`
 * accept a single `image` file (multipart/form-data), verify its MIME type and
 * magic bytes, and persist it to the persistent server data directory.
 *
 * Authorization is session-based and per-category (see below): game imagery is
 * SUPER_ADMIN-only; tournament imagery follows the `can_create_tournaments`
 * permission. Client-side checks are never the security boundary.
 */
export const adminUploadRoutes = Router();

// Authorization is per-category:
// - game imagery is SUPER_ADMIN only (Games is a locked area for moderators);
// - tournament imagery is allowed to a LIMITED_ADMIN ONLY while they hold the
//   `can_create_tournaments` permission (it is part of tournament creation).

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    // First gate: declared MIME type. The content is re-verified below.
    if (isAllowedImageMime(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('unsupported_mime'));
  },
});

function handleUpload(category: UploadCategory) {
  return (req: Request, res: Response): void => {
    if (!req.file) {
      res.status(400).json({ error: 'no_file' });
      return;
    }
    try {
      const { url } = storeImage(category, req.file.buffer);
      res.status(201).json({ url });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'upload_failed';
      if (message === 'unsupported_image') {
        res.status(415).json({ error: 'unsupported_type' });
        return;
      }
      console.error('[AdminUploads] Failed to store image:', err);
      res.status(500).json({ error: 'upload_failed' });
    }
  };
}

adminUploadRoutes.post('/games', requireSuperAdmin, upload.single('image'), handleUpload('games'));
adminUploadRoutes.post(
  '/tournaments',
  requirePermission('can_create_tournaments'),
  upload.single('image'),
  handleUpload('tournaments')
);

// Translate multer's low-level errors into clear, stable error codes.
adminUploadRoutes.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const code = (err as { code?: string; message?: string } | undefined)?.code;
  const message = (err as { message?: string } | undefined)?.message;
  if (code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'file_too_large' });
    return;
  }
  if (message === 'unsupported_mime') {
    res.status(415).json({ error: 'unsupported_type' });
    return;
  }
  res.status(400).json({ error: 'invalid_upload' });
});
