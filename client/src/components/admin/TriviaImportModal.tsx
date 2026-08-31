import { useEffect, useRef, useCallback, useState } from 'react';
import type { ImportPreviewResult, ImportRowPreview, ImportCommitResult } from '../../types/triviaAdmin';

interface TriviaImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPreview: (file: File) => Promise<ImportPreviewResult>;
  onCommit: (rows: ImportRowPreview[]) => Promise<ImportCommitResult>;
}

const STATUS_LABELS: Record<string, string> = {
  valid_new: 'صالح وجديد',
  duplicate: 'مكرر',
  invalid: 'غير صالح',
  warning: 'تحذير',
};

const STATUS_BADGES: Record<string, string> = {
  valid_new: 'badge-green',
  duplicate: 'badge-yellow',
  invalid: 'badge-red',
  warning: 'badge-purple',
};

export function TriviaImportModal({ isOpen, onClose, onPreview, onCommit }: TriviaImportModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const scrollPositionRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'file' | 'preview' | 'commit' | 'result'>('file');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewResult, setPreviewResult] = useState<ImportPreviewResult | null>(null);
  const [commitResult, setCommitResult] = useState<ImportCommitResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lockBodyScroll = useCallback(() => {
    if (typeof window === 'undefined') return;
    scrollPositionRef.current = window.scrollY;
    const body = document.body;
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollPositionRef.current}px`;
    body.style.width = '100%';
  }, []);

  const unlockBodyScroll = useCallback(() => {
    if (typeof window === 'undefined') return;
    const body = document.body;
    const scrollY = Math.abs(parseInt(body.style.top || '0', 10));
    body.style.overflow = '';
    body.style.position = '';
    body.style.top = '';
    body.style.width = '';
    window.scrollTo(0, scrollY);
  }, []);

  const handleFocusTrap = useCallback((e: KeyboardEvent) => {
    const dialog = dialogRef.current;
    if (!dialog || e.key !== 'Tab') return;

    const focusableSelectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusable = dialog.querySelectorAll<HTMLElement>(focusableSelectors);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      lockBodyScroll();
      dialog.showModal();
      dialog.querySelector<HTMLElement>('[autofocus]')?.focus();
      dialog.addEventListener('keydown', handleFocusTrap);
    } else {
      dialog.removeEventListener('keydown', handleFocusTrap);
      dialog.close();
      unlockBodyScroll();
      previousActiveElement.current?.focus();
    }

    return () => {
      dialog.removeEventListener('keydown', handleFocusTrap);
      dialog.close();
      unlockBodyScroll();
    };
  }, [isOpen, lockBodyScroll, unlockBodyScroll, handleFocusTrap]);

  useEffect(() => {
    if (!isOpen) {
      setStep('file');
      setSelectedFile(null);
      setPreviewResult(null);
      setCommitResult(null);
      setError(null);
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    const dialog = dialogRef.current;
    if (dialog && e.target === dialog) {
      onClose();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 1024 * 1024) {
        setError('حجم الملف يجب أن يكون أقل من 1 ميجابايت');
        return;
      }
      if (!['application/json', 'text/json', 'text/csv', 'application/csv'].includes(file.type) && !file.name.match(/\.(json|csv)$/i)) {
        setError('تنسيق الملف غير مدعوم. استخدم JSON أو CSV');
        return;
      }
      setSelectedFile(file);
      setError(null);
    }
  };

  const handlePreview = async () => {
    if (!selectedFile) return;
    setPreviewing(true);
    setError(null);
    try {
      const result = await onPreview(selectedFile);
      setPreviewResult(result);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل في المعاينة');
    } finally {
      setPreviewing(false);
    }
  };

  const handleCommit = async () => {
    if (!previewResult) return;
    const validRows = previewResult.rows.filter((r) => r.status === 'valid_new');
    if (validRows.length === 0) {
      setError('لا توجد صفوف صالحة للاستيراد');
      return;
    }
    setCommitting(true);
    setError(null);
    try {
      const result = await onCommit(validRows);
      setCommitResult(result);
      setStep('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل في تأكيد الاستيراد');
    } finally {
      setCommitting(false);
    }
  };

  const handleBack = () => {
    if (step === 'preview') {
      setStep('file');
      setPreviewResult(null);
    } else if (step === 'result') {
      setStep('preview');
      setCommitResult(null);
    }
  };

  const handleReset = () => {
    setStep('file');
    setSelectedFile(null);
    setPreviewResult(null);
    setCommitResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      className="game-info-modal"
      onKeyDown={(e) => { if (e.key === 'Escape') handleClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-modal-title"
    >
      <div className="game-info-content" style={{ maxWidth: '720px' }}>
        <div className="game-info-header">
          <div className="game-info-title-area">
            <h2 id="import-modal-title" className="game-info-title">استيراد أسئلة</h2>
            <p className="game-info-summary arabic-wrap">استيراد أسئلة من ملف JSON أو CSV</p>
          </div>
          <button
            className="game-info-close"
            onClick={handleClose}
            aria-label="إغلاق"
            autoFocus
          >
            ✕
          </button>
        </div>

        <div className="game-info-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {error && (
            <div className="text-neon-red text-sm mb-4 p-3 bg-[rgba(255,51,85,0.07)] border border-[rgba(255,51,85,0.3)] rounded">
              {error}
            </div>
          )}

          {step === 'file' && (
            <div className="space-y-4">
              <div className="panel text-center py-8">
                <div className="text-4xl mb-3">📁</div>
                <p className="text-[var(--text-dim)] mb-4">اسحب وأفلت الملف هنا أو اضغط للاختيار</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.csv,application/json,text/csv"
                  onChange={handleFileChange}
                  className="sr-only"
                  id="import-file"
                />
                <label htmlFor="import-file" className="btn-neon cursor-pointer">
                  اختر ملف
                </label>
                <p className="text-xs text-[var(--text-muted)] mt-2">
                  صيغ مدعومة: JSON، CSV | الحد الأقصى: 1 ميجابايت، 1000 صف
                </p>
              </div>

              {selectedFile && (
                <div className="panel p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{selectedFile.name.endsWith('.json') ? '📄' : '📊'}</span>
                      <div>
                        <div className="font-medium text-[var(--text-primary)]">{selectedFile.name}</div>
                        <div className="text-xs text-[var(--text-dim)]">
                          {(selectedFile.size / 1024).toFixed(1)} KB
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => setSelectedFile(null)}
                      className="text-neon-red hover:underline text-sm"
                    >
                      إزالة
                    </button>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button className="btn-neon" onClick={() => setSelectedFile(null)} disabled={!selectedFile}>
                  إلغاء
                </button>
                <button
                  className="btn-neon"
                  onClick={handlePreview}
                  disabled={!selectedFile || previewing}
                >
                  {previewing ? 'جاري المعاينة...' : 'معاينة الاستيراد'}
                </button>
              </div>
            </div>
          )}

          {step === 'preview' && previewResult && (
            <div className="space-y-4">
              <div className="panel p-4">
                <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
                  <h3 className="font-semibold text-[var(--text-primary)]">نتائج المعاينة</h3>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="badge badge-green">صالح: {previewResult.summary.valid}</span>
                    <span className="badge badge-yellow">مكرر: {previewResult.summary.duplicate}</span>
                    <span className="badge badge-red">غير صالح: {previewResult.summary.invalid}</span>
                    <span className="badge badge-purple">تحذير: {previewResult.summary.warning}</span>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm" role="grid">
                    <thead>
                      <tr className="border-b border-[var(--border-color)]">
                        <th className="text-right py-2 px-3 font-semibold text-[var(--text-primary)]">#</th>
                        <th className="text-right py-2 px-3 font-semibold text-[var(--text-primary)]">السؤال</th>
                        <th className="text-center py-2 px-3 font-semibold text-[var(--text-primary)]">الحالة</th>
                        <th className="text-center py-2 px-3 font-semibold text-[var(--text-primary)]">الفئة</th>
                        <th className="text-center py-2 px-3 font-semibold text-[var(--text-primary)]">الصعوبة</th>
                        <th className="text-left py-2 px-3 font-semibold text-[var(--text-primary)]">تفاصيل</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewResult.rows.map((row, idx) => (
                        <tr key={row.hash} className="border-b border-[var(--border-color)] hover:bg-[rgba(0,240,255,0.02)]">
                          <td className="py-2 px-3 text-[var(--text-dim)] font-mono">{row.index + 1}</td>
                          <td className="py-2 px-3 max-w-xs truncate text-[var(--text-primary)]" title={row.question}>
                            {row.question}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <span className={`badge ${STATUS_BADGES[row.status] || 'badge'} text-xs`}>
                              {STATUS_LABELS[row.status] || row.status}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-center text-[var(--text-primary)]">{row.category}</td>
                          <td className="py-2 px-3 text-center">
                            <span className="badge badge-cyan text-xs">{row.difficulty}</span>
                          </td>
                          <td className="py-2 px-3 text-left">
                            {row.status === 'invalid' && row.errors && row.errors.length > 0 && (
                              <button
                                className="text-neon-red hover:underline text-xs"
                                onClick={() => alert(row.errors!.join('\n'))}
                              >
                                عرض الأخطاء
                              </button>
                            )}
                            {row.status === 'duplicate' && row.existingId && (
                              <span className="text-[var(--text-dim)] text-xs">مكرر مع: {row.existingId.slice(0, 8)}...</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-between gap-2">
                <button className="btn-neon" onClick={handleBack}>رجوع</button>
                <div className="flex gap-2 ml-auto">
                  <button
                    className="btn-neon-pink"
                    onClick={handleCommit}
                    disabled={previewResult!.summary.valid === 0 || committing}
                  >
                    {committing ? 'جاري الاستيراد...' : `استيراد ${previewResult!.summary.valid} سؤال`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === 'result' && commitResult && (
            <div className="space-y-4 text-center">
              <div className="panel p-8">
                <div className="text-4xl mb-3">✅</div>
                <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2">اكتمل الاستيراد</h3>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="panel p-4">
                    <div className="text-2xl font-bold text-neon-green">{commitResult.imported}</div>
                    <div className="text-xs text-[var(--text-dim)]">تم الاستيراد</div>
                  </div>
                  <div className="panel p-4">
                    <div className="text-2xl font-bold text-neon-yellow">{commitResult.skipped}</div>
                    <div className="text-xs text-[var(--text-dim)]">تم التخطي</div>
                  </div>
                  <div className="panel p-4">
                    <div className="text-2xl font-bold text-neon-red">{commitResult.rejected}</div>
                    <div className="text-xs text-[var(--text-dim)]">تم الرفض</div>
                  </div>
                </div>
              </div>

              <div className="flex justify-center gap-2">
                <button className="btn-neon" onClick={handleBack}>استيراد آخر</button>
                <button className="btn-neon-pink" onClick={handleClose}>إغلاق</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}