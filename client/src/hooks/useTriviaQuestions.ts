import { useState, useCallback, useEffect, useRef } from 'react';
import { apiFetch } from '../utils/api';
import type {
  TriviaQuestionAdmin,
  TriviaQuestionsListParams,
  TriviaQuestionsListResponse,
  ImportPreviewResult,
  ImportCommitResult,
  ImportRowPreview,
  CreateQuestionInput,
  UpdateQuestionInput,
} from '../types/triviaAdmin';

const DEFAULT_PAGE_SIZE = 20;

export function useTriviaQuestions() {
  const [questions, setQuestions] = useState<TriviaQuestionAdmin[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useState<TriviaQuestionsListParams>({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    sort: 'created_at',
    order: 'desc',
  });
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchQuestions = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setLoading(true);
    setError(null);

    try {
      const queryParams = new URLSearchParams();
      queryParams.set('page', String(params.page));
      queryParams.set('pageSize', String(params.pageSize));
      if (params.search) queryParams.set('search', params.search);
      if (params.category) queryParams.set('category', params.category);
      if (params.difficulty) queryParams.set('difficulty', params.difficulty);
      if (params.verified !== undefined) queryParams.set('verified', String(params.verified));
      if (params.language) queryParams.set('language', params.language);
      if (params.sort) queryParams.set('sort', params.sort);
      if (params.order) queryParams.set('order', params.order);

      const res = await apiFetch(`/api/admin/trivia/questions?${queryParams.toString()}`, {
        signal: abortControllerRef.current.signal,
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error('غير مصرح — سجّل الدخول كمشرف أولاً.');
        }
        throw new Error('فشل في تحميل الأسئلة');
      }

      const data: TriviaQuestionsListResponse = await res.json();
      setQuestions(data.questions);
      setTotal(data.total);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
      setQuestions([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  const setPage = useCallback((page: number) => {
    setParams((prev) => ({ ...prev, page }));
  }, []);

  const setPageSize = useCallback((pageSize: number) => {
    setParams((prev) => ({ ...prev, pageSize, page: 1 }));
  }, []);

  const setSearch = useCallback((search: string) => {
    setParams((prev) => ({ ...prev, search, page: 1 }));
  }, []);

  const setCategory = useCallback((category: string) => {
    setParams((prev) => ({ ...prev, category: category || undefined, page: 1 }));
  }, []);

  const setDifficulty = useCallback((difficulty: string) => {
    setParams((prev) => ({ ...prev, difficulty: difficulty || undefined, page: 1 }));
  }, []);

  const setVerifiedFilter = useCallback((verified: number | undefined) => {
    setParams((prev) => ({ ...prev, verified, page: 1 }));
  }, []);

  const setLanguage = useCallback((language: string) => {
    setParams((prev) => ({ ...prev, language: language || undefined, page: 1 }));
  }, []);

  const setSort = useCallback((sort: string) => {
    setParams((prev) => {
      const newOrder = prev.sort === sort && prev.order === 'asc' ? 'desc' : 'asc';
      return { ...prev, sort, order: newOrder, page: 1 };
    });
  }, []);

  const createQuestion = useCallback(async (input: CreateQuestionInput): Promise<TriviaQuestionAdmin | null> => {
    try {
      const res = await apiFetch('/api/admin/trivia/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'فشل في إنشاء السؤال');
      }

      const data = await res.json();
      await fetchQuestions();
      return data.question;
    } catch (err) {
      throw err;
    }
  }, [fetchQuestions]);

  const updateQuestion = useCallback(async (id: string, input: UpdateQuestionInput): Promise<TriviaQuestionAdmin | null> => {
    try {
      const res = await apiFetch(`/api/admin/trivia/questions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'فشل في تحديث السؤال');
      }

      const data = await res.json();
      await fetchQuestions();
      return data.question;
    } catch (err) {
      throw err;
    }
  }, [fetchQuestions]);

  const deleteQuestion = useCallback(async (id: string): Promise<void> => {
    try {
      const res = await apiFetch(`/api/admin/trivia/questions/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'فشل في حذف السؤال');
      }

      await fetchQuestions();
    } catch (err) {
      throw err;
    }
  }, [fetchQuestions]);

  const setVerified = useCallback(async (id: string, verified: number): Promise<void> => {
    try {
      const res = await apiFetch(`/api/admin/trivia/questions/${id}/verify`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verified }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'فشل في تغيير حالة التحقق');
      }

      await fetchQuestions();
    } catch (err) {
      throw err;
    }
  }, [fetchQuestions]);

  const previewImport = useCallback(async (file: File): Promise<ImportPreviewResult> => {
    const formData = new FormData();
    formData.append('file', file);

    const res = await apiFetch('/api/admin/trivia/questions/import/preview', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'فشل في معاينة الاستيراد');
    }

    return res.json();
  }, []);

  const commitImport = useCallback(async (rows: ImportRowPreview[]): Promise<ImportCommitResult> => {
    const res = await apiFetch('/api/admin/trivia/questions/import/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'فشل في تأكيد الاستيراد');
    }

    await fetchQuestions();
    return res.json();
  }, [fetchQuestions]);

  const refresh = useCallback(() => {
    setParams((prev) => ({ ...prev }));
  }, []);

  return {
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
  };
}