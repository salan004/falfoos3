import { useRef, useState } from 'react';
import { apiFetch, resolveImageUrl } from '../../utils/api';

/**
 * Phase F1 — reusable RTL image upload control.
 *
 * Select → preview → upload → replace. The uploaded public URL is handed back
 * through `onChange`; the surrounding form persists it on save. Server-side
 * validation is authoritative (content sniffing + size limit); the client-side
 * checks below only fail fast with the same wording.
 */

export type ImageUploadCategory = 'games' | 'tournaments';

/** Must stay in sync with `server/src/uploads/uploadService.ts`. */
const ACCEPTED_MIME = ['image/webp', 'image/png', 'image/jpeg'];
const ACCEPT_ATTR = ACCEPTED_MIME.join(',');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_MB = MAX_IMAGE_BYTES / (1024 * 1024);

const ERROR_MESSAGES: Record<string, string> = {
  file_too_large: `حجم الصورة كبير جدًا — الحد الأقصى ${MAX_IMAGE_MB} ميجابايت.`,
  unsupported_type: 'صيغة الصورة غير مدعومة — استخدم WebP أو PNG أو JPEG.',
  unsupported_mime: 'صيغة الصورة غير مدعومة — استخدم WebP أو PNG أو JPEG.',
  no_file: 'لم يتم اختيار أي صورة.',
  network_error: 'فشل الاتصال بالخادم.',
  upload_failed: 'تعذّر رفع الصورة. حاول مرة أخرى.',
};

interface ImageUploadFieldProps {
  label: string;
  category: ImageUploadCategory;
  value: string;
  onChange: (url: string) => void;
  disabled?: boolean;
}

export function ImageUploadField({
  label,
  category,
  value,
  onChange,
  disabled = false,
}: ImageUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPicker = () => {
    if (disabled || uploading) return;
    inputRef.current?.click();
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);

    if (!ACCEPTED_MIME.includes(file.type)) {
      setError(ERROR_MESSAGES.unsupported_type);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(ERROR_MESSAGES.file_too_large);
      return;
    }

    const body = new FormData();
    body.append('image', file);

    setUploading(true);
    try {
      const res = await apiFetch(`/api/admin/uploads/${category}`, {
        method: 'POST',
        body,
      });
      const data = await res.json().catch(() => ({} as { url?: string; error?: string }));
      if (!res.ok || typeof data.url !== 'string') {
        setError(ERROR_MESSAGES[data.error ?? ''] ?? ERROR_MESSAGES.upload_failed);
        return;
      }
      onChange(data.url);
    } catch {
      setError(ERROR_MESSAGES.network_error);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="admin-image-field">
      <label className="admin-field-label">{label}</label>

      <div className="admin-image-field-body">
        <div className="admin-image-preview" aria-hidden={!value}>
          {value ? (
            <img src={resolveImageUrl(value)} alt="" loading="lazy" decoding="async" />
          ) : (
            <span className="admin-image-preview-empty">🖼️</span>
          )}
        </div>

        <div className="admin-image-field-actions">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTR}
            className="admin-image-input"
            onChange={(e) => void handleFile(e.target.files?.[0])}
            disabled={disabled || uploading}
            tabIndex={-1}
          />
          <button
            type="button"
            className="btn-neon text-sm"
            onClick={openPicker}
            disabled={disabled || uploading}
          >
            {uploading ? '… جارٍ الرفع' : value ? '📤 استبدال الصورة' : '📤 تحميل الصورة'}
          </button>
          {value && !uploading && (
            <button
              type="button"
              className="admin-image-remove"
              onClick={() => {
                setError(null);
                onChange('');
              }}
              disabled={disabled}
            >
              إزالة الصورة
            </button>
          )}
          <p className="admin-field-hint">
            WebP أو PNG أو JPEG — بحد أقصى {MAX_IMAGE_MB} ميجابايت.
          </p>
        </div>
      </div>

      {error && (
        <p className="admin-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
