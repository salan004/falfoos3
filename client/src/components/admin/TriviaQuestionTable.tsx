import type { TriviaQuestionsListParams, TriviaQuestionAdmin } from '../../types/triviaAdmin';

interface TriviaQuestionTableProps {
  questions: TriviaQuestionAdmin[];
  loading: boolean;
  total: number;
  params: TriviaQuestionsListParams;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onSort: (sort: string) => void;
  onEdit: (question: TriviaQuestionAdmin) => void;
  onPreview: (question: TriviaQuestionAdmin) => void;
  onDelete: (id: string) => void;
  onVerify: (id: string, currentVerified: number) => void;
}

const SORT_LABELS: Record<string, string> = {
  created_at: 'تاريخ الإنشاء',
  updated_at: 'تاريخ التحديث',
  category: 'الفئة',
  difficulty: 'الصعوبة',
  verified: 'التحقق',
  usage_count: 'الاستخدام',
  question: 'نص السؤال',
  language: 'اللغة',
};

const DIFFICULTY_BADGES: Record<string, string> = {
  سهل: 'badge-green',
  متوسط: 'badge-yellow',
  صعب: 'badge-red',
};

export function TriviaQuestionTable({
  questions,
  loading,
  total,
  params,
  totalPages,
  onPageChange,
  onPageSizeChange,
  onSort,
  onEdit,
  onPreview,
  onDelete,
  onVerify,
}: TriviaQuestionTableProps) {
  const handleSort = (field: string) => {
    if (['created_at', 'updated_at', 'category', 'difficulty', 'verified', 'usage_count', 'question', 'language'].includes(field)) {
      onSort(field);
    }
  };

  const getSortIcon = (field: string) => {
    if (params.sort !== field) return '⇅';
    return params.order === 'asc' ? '↑' : '↓';
  };

  if (loading && questions.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="loading-pulse text-[var(--text-dim)]">جارٍ تحميل الأسئلة…</div>
      </div>
    );
  }

  if (!loading && questions.length === 0) {
    return (
      <div className="panel text-center py-12 text-[var(--text-dim)]">
        لا توجد أسئلة مطابقة للبحث.
      </div>
    );
  }

  return (
    <div className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full" role="grid">
          <thead>
            <tr className="border-b border-[var(--border-color)]">
              <th className="text-right py-3 px-4 font-semibold text-[var(--text-primary)] cursor-pointer hover:text-neon-cyan" onClick={() => handleSort('question')}>
                السؤال <span className="text-xs text-[var(--text-muted)] ml-1">{getSortIcon('question')}</span>
              </th>
              <th className="text-right py-3 px-4 font-semibold text-[var(--text-primary)] cursor-pointer hover:text-neon-cyan" onClick={() => handleSort('category')}>
                الفئة <span className="text-xs text-[var(--text-muted)] ml-1">{getSortIcon('category')}</span>
              </th>
              <th className="text-right py-3 px-4 font-semibold text-[var(--text-primary)] cursor-pointer hover:text-neon-cyan" onClick={() => handleSort('difficulty')}>
                الصعوبة <span className="text-xs text-[var(--text-muted)] ml-1">{getSortIcon('difficulty')}</span>
              </th>
              <th className="text-center py-3 px-4 font-semibold text-[var(--text-primary)] cursor-pointer hover:text-neon-cyan" onClick={() => handleSort('verified')}>
                التحقق <span className="text-xs text-[var(--text-muted)] ml-1">{getSortIcon('verified')}</span>
              </th>
              <th className="text-center py-3 px-4 font-semibold text-[var(--text-primary)] cursor-pointer hover:text-neon-cyan" onClick={() => handleSort('usage_count')}>
                الاستخدام <span className="text-xs text-[var(--text-muted)] ml-1">{getSortIcon('usage_count')}</span>
              </th>
              <th className="text-center py-3 px-4 font-semibold text-[var(--text-primary)] cursor-pointer hover:text-neon-cyan" onClick={() => handleSort('updated_at')}>
                التحديث <span className="text-xs text-[var(--text-muted)] ml-1">{getSortIcon('updated_at')}</span>
              </th>
              <th className="text-left py-3 px-4 font-semibold text-[var(--text-primary)]">
                الإجراءات
              </th>
            </tr>
          </thead>
          <tbody>
            {questions.map((question) => (
              <tr key={question.id} className="border-b border-[var(--border-color)] hover:bg-[rgba(0,240,255,0.02)]">
                <td className="py-3 px-4">
                  <div className="max-w-xs truncate text-[var(--text-primary)]" title={question.question}>
                    {question.question}
                  </div>
                </td>
                <td className="py-3 px-4">
                  <span className="badge badge-cyan text-xs">{question.category}</span>
                </td>
                <td className="py-3 px-4 text-center">
                  <span className={`badge ${DIFFICULTY_BADGES[question.difficulty] || 'badge'} text-xs`}>
                    {question.difficulty}
                  </span>
                </td>
                <td className="py-3 px-4 text-center">
                  <span className={`badge ${question.verified ? 'badge-green' : 'badge-yellow'} text-xs`}>
                    {question.verified ? '✓ مُحقّق' : '✗ غير مُحقّق'}
                  </span>
                </td>
                <td className="py-3 px-4 text-center text-[var(--text-dim)] font-mono">
                  {question.usage_count ?? 0}
                </td>
                <td className="py-3 px-4 text-center text-[var(--text-dim)] text-xs">
                  {new Date(question.updated_at).toLocaleDateString('ar', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </td>
                <td className="py-3 px-4 text-left">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onPreview(question)}
                      className="p-2 text-[var(--text-dim)] hover:text-neon-cyan hover:bg-[rgba(0,240,255,0.05)] rounded transition-colors"
                      aria-label={`معاينة: ${question.question.slice(0, 30)}...`}
                      title="معاينة"
                    >
                      👁
                    </button>
                    <button
                      onClick={() => onEdit(question)}
                      className="p-2 text-[var(--text-dim)] hover:text-neon-yellow hover:bg-[rgba(255,221,0,0.05)] rounded transition-colors"
                      aria-label={`تعديل: ${question.question.slice(0, 30)}...`}
                      title="تعديل"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => onVerify(question.id, question.verified)}
                      className={`p-2 ${question.verified ? 'text-neon-green' : 'text-[var(--text-dim)]'} hover:bg-[rgba(0,255,136,0.05)] rounded transition-colors`}
                      aria-label={question.verified ? `إلغاء التحقق: ${question.question.slice(0, 30)}...` : `تحقق: ${question.question.slice(0, 30)}...`}
                      title={question.verified ? 'إلغاء التحقق' : 'تحقق'}
                    >
                      {question.verified ? '✓' : '✗'}
                    </button>
                    <button
                      onClick={() => onDelete(question.id)}
                      className="p-2 text-[var(--text-dim)] hover:text-neon-red hover:bg-[rgba(255,51,85,0.05)] rounded transition-colors"
                      aria-label={`حذف: ${question.question.slice(0, 30)}...`}
                      title="حذف"
                    >
                      🗑
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-4 mt-4 flex-wrap">
        <div className="text-sm text-[var(--text-dim)]">
          عرض {((params.page - 1) * params.pageSize) + 1} إلى {Math.min(params.page * params.pageSize, total)} من {total} نتيجة
        </div>

        <div className="flex items-center gap-2">
          <select
            value={params.pageSize}
            onChange={(e) => onPageSizeChange(parseInt(e.target.value, 10))}
            className="text-sm bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded-[var(--radius)] px-3 py-2 outline-none focus:border-neon-cyan"
            aria-label="عدد النتائج لكل صفحة"
          >
            {[10, 20, 50, 100].map((size) => (
              <option key={size} value={size}>{size} لكل صفحة</option>
            ))}
          </select>

          <button
            onClick={() => onPageChange(1)}
            disabled={params.page === 1}
            className="p-2 text-[var(--text-dim)] hover:text-neon-cyan disabled:opacity-50 disabled:cursor-not-allowed rounded border border-[var(--border-color)] transition-colors"
            aria-label="الصفحة الأولى"
          >
            ⏮
          </button>
          <button
            onClick={() => onPageChange(params.page - 1)}
            disabled={params.page === 1}
            className="p-2 text-[var(--text-dim)] hover:text-neon-cyan disabled:opacity-50 disabled:cursor-not-allowed rounded border border-[var(--border-color)] transition-colors"
            aria-label="الصفحة السابقة"
          >
            ◀
          </button>

          <span className="px-3 text-[var(--text-primary)] font-mono">
            صفحة {params.page} من {totalPages}
          </span>

          <button
            onClick={() => onPageChange(params.page + 1)}
            disabled={params.page >= totalPages}
            className="p-2 text-[var(--text-dim)] hover:text-neon-cyan disabled:opacity-50 disabled:cursor-not-allowed rounded border border-[var(--border-color)] transition-colors"
            aria-label="الصفحة التالية"
          >
            ▶
          </button>
          <button
            onClick={() => onPageChange(totalPages)}
            disabled={params.page >= totalPages}
            className="p-2 text-[var(--text-dim)] hover:text-neon-cyan disabled:opacity-50 disabled:cursor-not-allowed rounded border border-[var(--border-color)] transition-colors"
            aria-label="الصفحة الأخيرة"
          >
            ⏭
          </button>
        </div>
      </div>
    </div>
  );
}