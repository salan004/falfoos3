import { useState, useMemo, useEffect } from 'react';
import { useTriviaQuestions } from '../hooks/useTriviaQuestions';
import { AdminGate } from '../components/AdminGate';
import { TriviaQuestionTable } from '../components/admin/TriviaQuestionTable';
import { TriviaQuestionFormModal } from '../components/admin/TriviaQuestionFormModal';
import { TriviaPreviewModal } from '../components/admin/TriviaPreviewModal';
import { TriviaImportModal } from '../components/admin/TriviaImportModal';
import type { TriviaQuestionAdmin, CreateQuestionInput, UpdateQuestionInput, ImportRowPreview, ImportPreviewResult, ImportCommitResult } from '../types/triviaAdmin';

export function TriviaQuestionsPage() {
  const {
    questions,
    total,
    loading,
    error,
    params,
    setPage,
    setPageSize,
    setSearch,
    setCategory,
    setDifficulty,
    setVerifiedFilter,
    setLanguage,
    setSort,
    createQuestion,
    updateQuestion,
    deleteQuestion,
    setVerified,
    previewImport,
    commitImport,
    refresh,
  } = useTriviaQuestions();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<TriviaQuestionAdmin | null>(null);
  const [previewQuestion, setPreviewQuestion] = useState<TriviaQuestionAdmin | null>(null);
  const [searchDebounced, setSearchDebounced] = useState(params.search || '');
  const [searchTimeout, setSearchTimeout] = useState<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchDebounced);
    }, 300);
    setSearchTimeout(timeout);
    return () => clearTimeout(timeout);
  }, [searchDebounced, setSearch]);

  const categories = useMemo(
    () => [...new Set(questions.map((q) => q.category))].sort(),
    [questions]
  );

  const difficulties = useMemo(
    () => [...new Set(questions.map((q) => q.difficulty))].sort(),
    [questions]
  );

  const languages = useMemo(
    () => [...new Set(questions.map((q) => q.language))].sort(),
    [questions]
  );

  const totalPages = Math.ceil(total / params.pageSize) || 1;

  const handleCreate = async (input: CreateQuestionInput | UpdateQuestionInput) => {
    await createQuestion(input as CreateQuestionInput);
    setShowCreateModal(false);
  };

  const handleEdit = async (input: CreateQuestionInput | UpdateQuestionInput) => {
    if (!editingQuestion) return;
    await updateQuestion(editingQuestion.id, input as UpdateQuestionInput);
    setEditingQuestion(null);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا السؤال؟')) return;
    await deleteQuestion(id);
  };

  const handleVerify = async (id: string, currentVerified: number) => {
    await setVerified(id, currentVerified ? 0 : 1);
  };

  const handlePreview = (question: TriviaQuestionAdmin) => {
    setPreviewQuestion(question);
  };

  const handleImportPreview = async (file: File): Promise<ImportPreviewResult> => {
    return await previewImport(file);
  };

  const handleImportCommit = async (rows: ImportRowPreview[]): Promise<ImportCommitResult> => {
    return await commitImport(rows);
  };

  return (
    <main className="page-fade" dir="rtl">
      <div className="content-page">
        <header className="page-header">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="game-icon" style={{ background: 'rgba(0, 240, 255, 0.1)', borderColor: 'var(--neon-cyan)', boxShadow: '0 0 18px rgba(0, 255, 255, 0.2)' }}>
                ❓
              </span>
              <div>
                <h1 className="page-title" style={{ fontSize: '1.7rem' }}>إدارة أسئلة الترايفيا</h1>
                <p className="hero-subtitle">تصفح، بحث، تعديل واستيراد أسئلة الترايفيا</p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <AdminGate />
            </div>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button className="btn-neon" onClick={() => { setEditingQuestion(null); setShowCreateModal(true); }}>
              ➕ إضافة سؤال
            </button>
            <button className="btn-neon-pink" onClick={() => setShowImportModal(true)}>
              📥 استيراد
            </button>
          </div>
        </header>

        {error && (
          <div className="panel mt-4" style={{ background: 'rgba(255, 51, 85, 0.07)', borderColor: 'rgba(255, 51, 85, 0.3)' }}>
            <div className="flex items-center gap-3">
              <span>⚠️</span>
              <span className="text-neon-red">{error}</span>
              <button className="btn-neon ml-auto" onClick={refresh}>إعادة المحاولة</button>
            </div>
          </div>
        )}

        <section className="panel filters-bar mt-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <input
                type="text"
                placeholder="ابحث في نص السؤال..."
                value={searchDebounced}
                onChange={(e) => setSearchDebounced(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded-[var(--radius)] outline-none focus:border-neon-cyan"
                aria-label="بحث في الأسئلة"
              />
              <span className="absolute inset-y-0 right-3 flex items-center text-[var(--text-muted)]">🔍</span>
              {searchDebounced && (
                <button
                  onClick={() => setSearchDebounced('')}
                  className="absolute inset-y-0 left-3 flex items-center text-[var(--text-muted)] hover:text-neon-red"
                  aria-label="مسح البحث"
                >
                  ✕
                </button>
              )}
            </div>

            <select
              value={params.category || ''}
              onChange={(e) => setCategory(e.target.value)}
              className="text-sm bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded-[var(--radius)] px-3 py-2 outline-none focus:border-neon-cyan min-w-[160px]"
            >
              <option value="">كل الفئات</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>

            <select
              value={params.difficulty || ''}
              onChange={(e) => setDifficulty(e.target.value)}
              className="text-sm bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded-[var(--radius)] px-3 py-2 outline-none focus:border-neon-cyan min-w-[140px]"
            >
              <option value="">كل الصعوبات</option>
              {difficulties.map((diff) => (
                <option key={diff} value={diff}>{diff}</option>
              ))}
            </select>

            <select
              value={params.verified !== undefined ? String(params.verified) : ''}
              onChange={(e) => setVerifiedFilter(e.target.value ? parseInt(e.target.value, 10) : undefined)}
              className="text-sm bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded-[var(--radius)] px-3 py-2 outline-none focus:border-neon-cyan min-w-[140px]"
            >
              <option value="">الكل</option>
              <option value="1">مُحقّق</option>
              <option value="0">غير مُحقّق</option>
            </select>

            <select
              value={params.language || ''}
              onChange={(e) => setLanguage(e.target.value)}
              className="text-sm bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded-[var(--radius)] px-3 py-2 outline-none focus:border-neon-cyan min-w-[120px]"
            >
              <option value="">كل اللغات</option>
              {languages.map((lang) => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
          </div>
        </section>

        {error && (
          <div className="panel mt-4" style={{ background: 'rgba(255, 51, 85, 0.07)', borderColor: 'rgba(255, 51, 85, 0.3)' }}>
            <div className="flex items-center gap-3">
              <span>⚠️</span>
              <span className="text-neon-red">{error}</span>
              <button className="btn-neon ml-auto" onClick={refresh}>إعادة المحاولة</button>
            </div>
          </div>
        )}

        <section className="panel mt-4">
          <TriviaQuestionTable
            questions={questions}
            loading={loading}
            total={total}
            params={params}
            totalPages={totalPages}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            onSort={setSort}
            onEdit={setEditingQuestion}
            onPreview={handlePreview}
            onDelete={handleDelete}
            onVerify={handleVerify}
          />
        </section>

        {showCreateModal && (
          <TriviaQuestionFormModal
            isOpen={showCreateModal}
            onClose={() => setShowCreateModal(false)}
            onSubmit={handleCreate}
            initialData={null}
          />
        )}

        {editingQuestion && (
          <TriviaQuestionFormModal
            isOpen={true}
            onClose={() => setEditingQuestion(null)}
            onSubmit={handleEdit}
            initialData={editingQuestion}
          />
        )}

        {previewQuestion && (
          <TriviaPreviewModal
            isOpen={true}
            onClose={() => setPreviewQuestion(null)}
            question={previewQuestion}
          />
        )}

        {showImportModal && (
          <TriviaImportModal
            isOpen={showImportModal}
            onClose={() => setShowImportModal(false)}
            onPreview={handleImportPreview}
            onCommit={handleImportCommit}
          />
        )}
      </div>
    </main>
  );
}