import { useEffect, useRef, useCallback } from 'react';
import type { TriviaQuestionAdmin } from '../../types/triviaAdmin';

interface TriviaPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  question: TriviaQuestionAdmin;
}

const DIFFICULTY_BADGES: Record<string, string> = {
  سهل: 'badge-green',
  متوسط: 'badge-yellow',
  صعب: 'badge-red',
};

export function TriviaPreviewModal({ isOpen, onClose, question }: TriviaPreviewModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const scrollPositionRef = useRef<number>(0);

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

  if (!isOpen) return null;

  const correctChoice = question.choices[question.correct_idx];

  return (
    <dialog
      ref={dialogRef}
      className="game-info-modal"
      onKeyDown={handleKeyDown}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-question-title"
    >
      <div className="game-info-content">
        <div className="game-info-header">
          <div className="game-info-title-area">
            <h2 id="preview-question-title" className="game-info-title">معاينة السؤال</h2>
            <p className="game-info-summary arabic-wrap">معاينة كيف سيظهر السؤال للاعب</p>
          </div>
          <button
            className="game-info-close"
            onClick={onClose}
            aria-label="إغلاق"
            autoFocus
          >
            ✕
          </button>
        </div>

        <div className="game-info-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          <div className="space-y-4">
            <div className="question-card arabic-wrap">
              <p className="text-lg font-semibold">{question.question}</p>
            </div>

            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              {question.choices.map((choice, idx) => (
                <div
                  key={idx}
                  className={`choice-card ${idx === question.correct_idx ? 'choice-correct' : ''}`}
                  style={{
                    borderLeft: idx === question.correct_idx ? '4px solid var(--neon-green)' : 'none',
                  }}
                >
                  <span className="choice-num">
                    {idx + 1}
                    {idx === question.correct_idx && <span className="ml-1 text-xs">✓</span>}
                  </span>
                  <span className="arabic-wrap">{choice}</span>
                </div>
              ))}
            </div>

            <div className="panel">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-[var(--text-dim)] block mb-1">الفئة</span>
                  <span className="font-medium text-[var(--text-primary)]">{question.category}</span>
                </div>
                <div>
                  <span className="text-[var(--text-dim)] block mb-1">الصعوبة</span>
                  <span className={`badge ${DIFFICULTY_BADGES[question.difficulty] || 'badge'}`}>
                    {question.difficulty}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--text-dim)] block mb-1">الحالة</span>
                  <span className={`badge ${question.verified ? 'badge-green' : 'badge-yellow'}`}>
                    {question.verified ? '✓ مُحقّق' : '✗ غير مُحقّق'}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--text-dim)] block mb-1">اللغة</span>
                  <span className="font-medium text-[var(--text-primary)]">{question.language}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mt-4 pt-4 border-t border-[var(--border-color)]">
                <div>
                  <span className="text-[var(--text-dim)] block mb-1">الاستخدام</span>
                  <span className="font-mono font-bold text-[var(--text-primary)]">{question.usage_count ?? 0}</span>
                </div>
                <div>
                  <span className="text-[var(--text-dim)] block mb-1">آخر استخدام</span>
                  <span className="font-mono text-[var(--text-primary)] text-xs">
                    {question.last_used_at ? new Date(question.last_used_at).toLocaleDateString('ar') : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--text-dim)] block mb-1">تم الإنشاء</span>
                  <span className="font-mono text-[var(--text-primary)] text-xs">
                    {new Date(question.created_at).toLocaleDateString('ar', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--text-dim)] block mb-1">آخر تحديث</span>
                  <span className="font-mono text-[var(--text-primary)] text-xs">
                    {new Date(question.updated_at).toLocaleDateString('ar', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </span>
                </div>
              </div>

              {question.tags && question.tags.length > 0 && (
                <div className="mt-4 pt-4 border-t border-[var(--border-color)]">
                  <span className="text-[var(--text-dim)] block mb-1">الوسوم</span>
                  <div className="flex flex-wrap gap-2">
                    {question.tags.map((tag, idx) => (
                      <span key={idx} className="badge badge-cyan text-xs">{tag}</span>
                    ))}
                  </div>
                </div>
              )}

              {question.source && (
                <div className="mt-4 pt-4 border-t border-[var(--border-color)]">
                  <span className="text-[var(--text-dim)] block mb-1">المصدر</span>
                  <span className="text-[var(--text-primary)]">{question.source}</span>
                </div>
              )}

              <div className="mt-4 pt-4 border-t border-[var(--border-color)]">
                <span className="text-[var(--text-dim)] block mb-1">الإجابة الصحيحة (للمشرف فقط)</span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[var(--text-dim)] text-sm">الخيار</span>
                    <span className="font-bold text-neon-green">{question.correct_idx + 1}</span>
                  </div>
                  <div>
                    <span className="text-[var(--text-dim)] text-sm">النص</span>
                    <span className="font-mono text-[var(--text-primary)] text-sm">{correctChoice}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="game-info-footer">
          <button className="btn-neon" onClick={onClose}>إغلاق</button>
        </div>
      </div>
    </dialog>
  );
}