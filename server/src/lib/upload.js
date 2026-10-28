import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { ApiError } from './errors.js';
import { detectImageType } from './image.js';

/** Multer middleware for a single `photo` file; maps multer errors to API errors. */
export function singleImageUpload(config) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 0 },
  });
  return (req, res, next) =>
    upload.single('photo')(req, res, (err) => {
      if (err?.code === 'LIMIT_FILE_SIZE') {
        return next(
          new ApiError(413, 'UPLOAD_TOO_LARGE', 'File too large', {
            maxBytes: config.maxUploadBytes,
          }),
        );
      }
      if (err) return next(new ApiError(400, 'UPLOAD_INVALID', err.message));
      next();
    });
}

/** Validates the uploaded image by its magic bytes and stores it under a random name. */
export async function storeUploadedImage(config, file) {
  if (!file) throw new ApiError(400, 'UPLOAD_MISSING', 'No file uploaded');
  const kind = detectImageType(file.buffer);
  if (!kind)
    throw new ApiError(
      415,
      'UPLOAD_UNSUPPORTED_TYPE',
      'Only JPEG, PNG, WebP and GIF images are allowed',
    );
  const filename = `${randomUUID()}.${kind.ext}`;
  await writeFile(path.join(config.uploadDir, filename), file.buffer, { mode: 0o640 });
  return filename;
}
