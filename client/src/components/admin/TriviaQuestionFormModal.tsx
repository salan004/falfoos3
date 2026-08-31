import { useEffect, useRef, useCallback, useState } from 'react';
import type { TriviaQuestionAdmin, CreateQuestionInput, UpdateQuestionInput } from '../../types/triviaAdmin';

interface TriviaQuestionFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: CreateQuestionInput | UpdateQuestionInput) => Promise<void>;
  initialData: TriviaQuestionAdmin | null;
}

const DIFFICULTIES = ['سهل', 'متوسط', 'صعب'] as const;
const LANGUAGES = ['ar'] as const;

interface FormState {
  question: string;
  choices: string[];
  correct_idx: number;
  category: string;
  difficulty: string;
  tags: string;
  source: string;
  verified: number;
  language: string;
}

export function TriviaQuestionFormModal({ isOpen, onClose, onSubmit, initialData }: TriviaQuestionFormModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const scrollPositionRef = useRef<number>(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState<FormState>({
    question: '',
    choices: ['', '', '', ''],
    correct_idx: 0,
    category: '',
    difficulty: 'سهل',
    tags: '',
    source: '',
    verified: 0,
    language: 'ar',
  });

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
    if (initialData) {
      setFormData({
        question: initialData.question,
        choices: [...initialData.choices],
        correct_idx: initialData.correct_idx,
        category: initialData.category,
        difficulty: initialData.difficulty,
        tags: initialData.tags.join(', '),
        source: initialData.source ?? '',
        verified: initialData.verified,
        language: initialData.language,
      });
    } else {
      setFormData({
        question: '',
        choices: ['', '', '', ''],
        correct_idx: 0,
        category: '',
        difficulty: 'سهل',
        tags: '',
        source: '',
        verified: 0,
        language: 'ar',
      });
    }
    setError(null);
  }, [initialData, isOpen]);

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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    if (name.startsWith('choices.')) {
      const idx = parseInt(name.split('.')[1], 10);
      const newChoices = [...formData.choices];
      newChoices[idx] = value;
      setFormData({ ...formData, choices: newChoices });
    } else if (type === 'checkbox') {
      setFormData({ ...formData, [name]: (e.target as HTMLInputElement).checked ? 1 : 0 });
    } else {
      setFormData({ ...formData, [name]: value });
    }
    setError(null);
  };

  const handleCorrectChange = (idx: number) => {
    setFormData({ ...formData, correct_idx: idx });
  };

  const validateForm = (): string | null => {
    if (!formData.question?.trim()) return 'نص السؤال مطلوب';
    if (!formData.choices || formData.choices.length !== 4) return 'يجب وجود 4 خيارات بالضبط';
    for (let i = 0; i < 4; i++) {
      if (!formData.choices[i]?.trim()) return `الخيار ${i + 1} مطلوب`;
    }
    if (!Number.isInteger(formData.correct_idx) || formData.correct_idx < 0 || formData.correct_idx > 3) {
      return 'الإجابة الصحيحة يجب أن تكون بين 0 و 3';
    }
    if (!formData.category?.trim()) return 'الفئة مطلوبة';
    if (!DIFFICULTIES.includes(formData.difficulty as typeof DIFFICULTIES[number])) {
      return `الصعوبة يجب أن تكون أحد: ${DIFFICULTIES.join(', ')}`;
    }
    if (!LANGUAGES.includes(formData.language as typeof LANGUAGES[number])) {
      return `اللغة يجب أن تكون أحد: ${LANGUAGES.join(', ')}`;
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const payload: CreateQuestionInput | UpdateQuestionInput = {
        question: formData.question.trim(),
        choices: formData.choices.map((c) => c.trim()),
        correct_idx: formData.correct_idx,
        category: formData.category.trim(),
        difficulty: formData.difficulty,
        tags: formData.tags.split(',').map((t) => t.trim()).filter(Boolean),
        source: formData.source.trim() || undefined,
        verified: formData.verified,
        language: formData.language,
      };

      await onSubmit(payload);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل في الحفظ');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const isEdit = !!initialData;

  return (
    <dialog
      ref={dialogRef}
      className="game-info-modal"
      onKeyDown={handleKeyDown}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={isEdit ? 'edit-question-title' : 'create-question-title'}
    >
      <form className="game-info-content" onSubmit={handleSubmit}>
        <div className="game-info-header">
          <div className="game-info-title-area">
            <h2 id={isEdit ? 'edit-question-title' : 'create-question-title'} className="game-info-title">
              {isEdit ? 'تعديل سؤال' : 'إضافة سؤال جديد'}
            </h2>
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
          {error && (
            <div className="text-neon-red text-sm mb-4 p-3 bg-[rgba(255,51,85,0.07)] border border-[rgba(255,51,85,0.3)] rounded">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-[var(--text-primary)] mb-1">نص السؤال *</label>
              <textarea
                name="question"
                value={formData.question}
                onChange={handleChange}
                rows={3}
                className="w-full text-sm bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded-[var(--radius)] px-3 py-2 outline-none focus:border-neon-cyan resize-none"
                placeholder="اكتب نص السؤال هنا..."
                required
              />
            </div>

            <fieldset>
              <legend className="text-sm text-[var(--text-primary)] mb-2">الخيارات (4 مطلوبة) *</legend>
              <div className="space-y-2" role="radiogroup" aria-label="الإجابة الصحيحة">
                {formData.choices.map((choice, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="correct_idx"
                      value={idx}
                      checked={formData.correct_idx === idx}
                      onChange={() => handleCorrectChange(idx)}
                      className="w-5 h-5 accent-neon-cyan"
                      aria-label={`الخيار ${idx + 1} هو الإجابة الصحيحة`}
                    />
                    <input
                      type="text"
                      name={`choices.${idx}`}
                      value={choice}
                      onChange={handleChange}
                      className="flex-1 text-sm bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded-[var(--radius)] px-3 py-2 outline-none focus:border-neon-cyan"
                      placeholder={`الخيار ${idx + 1}`}
                      required
                    />
                  </div>
                ))}
              </div>
            </fieldset>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[var(--text-primary)] mb-1">الفئة *</label>
                <input
                  type="text"
                  name="category"
                  value={formData.category}
                  onChange={handleChange}
                  className="w-full text-sm bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded-[var(--radius)] px-3 py-2 outline-none focus:border-neon-cyan"
                  placeholder="مثال: ثقافة عامة"
                  required
                />
              </div>

              <div>
                <label className="block text-sm text-[var(--text-primary)] mb-1">الصعوبة *</label>
                <select
                  name="difficulty"
                  value={formData.difficulty}
                  onChange={handleChange}
                  className="w-full text-sm bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded-[var(--radius)] px-3 py-2 outline-none focus:border-neon-cyan"
                  required
                >
                  {DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[var(--text-primary)] mb-1">اللغة</label>
                <select
                  name="language"
                  value={formData.language}
                  onChange={handleChange}
                  className="w-full text-sm bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded-[var(--radius)] px-3 py-2 outline-none focus:border-neon-cyan"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-[var(--text-primary)] mb-1">مُحقّق</label>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="verified"
                    checked={formData.verified === 1}
                    onChange={handleChange}
                    className="w-5 h-5 accent-neon-cyan"
                  />
                  <span className="text-sm text-[var(--text-primary)]">نعم، هذا السؤال مُحقّق</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[var(--text-primary)] mb-1">المصدر</label>
                <input
                  type="text"
                  name="source"
                  value={formData.source}
                  onChange={handleChange}
                  className="w-full text-sm bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded-[var(--radius)] px-3 py-2 outline-none focus:border-neon-cyan"
                  placeholder="مثال: مصدر السؤال"
                />
              </div>

              <div>
                <label className="block text-sm text-[var(--text-primary)] mb-1">الوسوم (مفصولة بفواصل)</label>
                <input
                  type="text"
                  name="tags"
                  value={formData.tags}
                  onChange={handleChange}
                  className="w-full text-sm bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded-[var(--radius)] px-3 py-2 outline-none focus:border-neon-cyan"
                  placeholder="مثال: تاريخ, جغرافيا, علوم"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="game-info-footer flex justify-end gap-3">
          <button type="button" className="btn-neon" onClick={onClose} disabled={saving}>
            إلغاء
          </button>
          <button type="submit" className="btn-neon" disabled={saving}>
            {saving ? 'جاري الحفظ...' : (isEdit ? 'حفظ التغييرات' : 'إضافة السؤال')}
          </button>
        </div>
      </form>
    </dialog>
  );
}