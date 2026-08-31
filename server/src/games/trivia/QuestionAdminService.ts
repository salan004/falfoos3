import { getDb } from '../../db/db';
import { GameManager } from '../../core/GameManager';
import {
  validateQuestion,
  computeQuestionHash,
  importQuestion,
  TriviaQuestion,
  QuestionFilters,
  VALID_DIFFICULTIES,
  VALID_LANGUAGES,
} from './QuestionPoolService';

export interface ListQuestionsParams {
  page: number;
  pageSize: number;
  search?: string;
  category?: string;
  difficulty?: string;
  verified?: number;
  language?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface ListQuestionsResult {
  questions: TriviaQuestion[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateQuestionInput {
  question: string;
  choices: string[];
  correct_idx: number;
  category: string;
  difficulty: string;
  tags?: string[];
  source?: string;
  verified?: number;
  language?: string;
}

export interface UpdateQuestionInput {
  question?: string;
  choices?: string[];
  correct_idx?: number;
  category?: string;
  difficulty?: string;
  tags?: string[];
  source?: string;
  verified?: number;
  language?: string;
}

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_PAGE = 1;

const ALLOWED_SORT_FIELDS = [
  'created_at',
  'updated_at',
  'category',
  'difficulty',
  'verified',
  'usage_count',
  'question',
  'language',
] as const;

type AllowedSortField = (typeof ALLOWED_SORT_FIELDS)[number];

function sanitizePage(page: number): number {
  const p = Math.floor(page);
  return p > 0 ? p : DEFAULT_PAGE;
}

function sanitizePageSize(pageSize: number): number {
  const ps = Math.floor(pageSize);
  return ps > 0 ? Math.min(ps, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
}

function sanitizeSort(sort?: string): AllowedSortField {
  if (sort && ALLOWED_SORT_FIELDS.includes(sort as AllowedSortField)) {
    return sort as AllowedSortField;
  }
  return 'created_at';
}

function sanitizeOrder(order?: string): 'asc' | 'desc' {
  return order === 'asc' ? 'asc' : 'desc';
}

function getGameManagerInstance(): GameManager | null {
  return (globalThis as any).__falfoosGameManager ?? null;
}

function isQuestionActiveInCurrentMatch(questionId: string): boolean {
  const gm = getGameManagerInstance();
  if (!gm) return false;
  const activeGame = gm.getActiveGame();
  if (!activeGame || activeGame.config.id !== 'trivia') return false;
  const triviaGame = activeGame as any;
  return triviaGame.state?.currentQuestion?.id === questionId;
}

export function listQuestions(params: ListQuestionsParams): ListQuestionsResult {
  const db = getDb();

  const page = sanitizePage(params.page);
  const pageSize = sanitizePageSize(params.pageSize);
  const sort = sanitizeSort(params.sort);
  const order = sanitizeOrder(params.order);

  let whereSql = 'WHERE 1=1';
  const whereParams: Array<string | number> = [];

  if (params.search && params.search.trim()) {
    whereSql += ' AND question LIKE ?';
    whereParams.push(`%${params.search.trim()}%`);
  }
  if (params.category) {
    whereSql += ' AND category = ?';
    whereParams.push(params.category);
  }
  if (params.difficulty) {
    whereSql += ' AND difficulty = ?';
    whereParams.push(params.difficulty);
  }
  if (params.verified !== undefined) {
    whereSql += ' AND verified = ?';
    whereParams.push(params.verified);
  }
  if (params.language) {
    whereSql += ' AND language = ?';
    whereParams.push(params.language);
  }

  const countSql = `SELECT COUNT(*) as count FROM trivia_questions ${whereSql}`;
  const totalResult = db.prepare(countSql).get(...whereParams) as { count: number } | undefined;
  const total = totalResult?.count ?? 0;

  const offset = (page - 1) * pageSize;

  let selectSql = `
    SELECT q.*, 
      COALESCE(u.usage_count, 0) as usage_count,
      u.last_used_at,
      u.last_match_id
    FROM trivia_questions q
    LEFT JOIN trivia_question_usage u ON q.id = u.question_id
    ${whereSql}
  `;

  const sortColumn = sort === 'usage_count' ? 'usage_count' : `q.${sort}`;
  selectSql += ` ORDER BY ${sortColumn} ${order.toUpperCase()} LIMIT ? OFFSET ?`;

  const selectParams = [...whereParams, pageSize, offset];

  interface RowWithUsage {
    id: string;
    question: string;
    choices: string;
    correct_idx: number;
    category: string;
    difficulty: string;
    tags: string;
    source: string | null;
    verified: number;
    language: string;
    hash: string;
    created_at: number;
    updated_at: number;
    usage_count: number;
    last_used_at: number | null;
    last_match_id: string | null;
  }

  const rows = db.prepare(selectSql).all(...selectParams) as RowWithUsage[];

  const questions = rows.map(row => ({
    id: row.id,
    question: row.question,
    choices: JSON.parse(row.choices),
    correct_idx: row.correct_idx,
    category: row.category,
    difficulty: row.difficulty,
    tags: JSON.parse(row.tags),
    source: row.source,
    verified: row.verified,
    language: row.language,
    hash: row.hash,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  return { questions, total, page, pageSize };
}

export function getQuestion(id: string): TriviaQuestion | null {
  const db = getDb();

  const row = db.prepare(`
    SELECT q.*, 
      COALESCE(u.usage_count, 0) as usage_count,
      u.last_used_at,
      u.last_match_id
    FROM trivia_questions q
    LEFT JOIN trivia_question_usage u ON q.id = u.question_id
    WHERE q.id = ?
  `).get(id) as
    | {
        id: string;
        question: string;
        choices: string;
        correct_idx: number;
        category: string;
        difficulty: string;
        tags: string;
        source: string | null;
        verified: number;
        language: string;
        hash: string;
        created_at: number;
        updated_at: number;
        usage_count: number;
        last_used_at: number | null;
        last_match_id: string | null;
      }
    | undefined;

  if (!row) return null;

  return {
    id: row.id,
    question: row.question,
    choices: JSON.parse(row.choices),
    correct_idx: row.correct_idx,
    category: row.category,
    difficulty: row.difficulty,
    tags: JSON.parse(row.tags),
    source: row.source,
    verified: row.verified,
    language: row.language,
    hash: row.hash,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createQuestion(input: CreateQuestionInput): { question: TriviaQuestion } | { error: string; status: number } {
  const validation = validateQuestion(
    input.question,
    input.choices,
    input.correct_idx,
    input.category,
    input.difficulty,
    input.language
  );

  if (!validation.valid) {
    return { error: validation.errors.join('; '), status: 400 };
  }

  const result = importQuestion(
    input.question,
    input.choices,
    input.correct_idx,
    input.category,
    input.difficulty,
    {
      tags: input.tags,
      source: input.source,
      verified: input.verified ?? 0,
      language: input.language,
    }
  );

  if (!result.id) {
    return { error: 'Duplicate question content', status: 409 };
  }

  const question = getQuestion(result.id);
  if (!question) {
    return { error: 'Failed to retrieve created question', status: 500 };
  }

  return { question };
}

export function updateQuestion(id: string, input: UpdateQuestionInput): { question: TriviaQuestion } | { error: string; status: number } {
  const db = getDb();

  const existing = db.prepare('SELECT * FROM trivia_questions WHERE id = ?').get(id) as
    | {
        id: string;
        question: string;
        choices: string;
        correct_idx: number;
        category: string;
        difficulty: string;
        tags: string;
        source: string | null;
        verified: number;
        language: string;
        hash: string;
        created_at: number;
        updated_at: number;
      }
    | undefined;

  if (!existing) {
    return { error: 'Question not found', status: 404 };
  }

  const mergedQuestion = input.question ?? existing.question;
  const mergedChoices = input.choices ?? JSON.parse(existing.choices);
  const mergedCorrectIdx = input.correct_idx ?? existing.correct_idx;
  const mergedCategory = input.category ?? existing.category;
  const mergedDifficulty = input.difficulty ?? existing.difficulty;
  const mergedTags = input.tags ?? JSON.parse(existing.tags);
  const mergedSource = input.source ?? existing.source;
  const mergedVerified = input.verified ?? existing.verified;
  const mergedLanguage = input.language ?? existing.language;

  const validation = validateQuestion(
    mergedQuestion,
    mergedChoices,
    mergedCorrectIdx,
    mergedCategory,
    mergedDifficulty,
    mergedLanguage
  );

  if (!validation.valid) {
    return { error: validation.errors.join('; '), status: 400 };
  }

  const contentChanged = validation.hash !== existing.hash;

  if (contentChanged) {
    const duplicate = db.prepare('SELECT id FROM trivia_questions WHERE hash = ? AND id != ?').get(validation.hash, id);
    if (duplicate) {
      return { error: 'Duplicate question content', status: 409 };
    }
  }

  const now = Date.now();
  const stmt = db.prepare(`
    UPDATE trivia_questions
    SET question = ?, choices = ?, correct_idx = ?, category = ?, difficulty = ?,
        tags = ?, source = ?, verified = ?, language = ?, hash = ?, updated_at = ?
    WHERE id = ?
  `);

  stmt.run(
    mergedQuestion,
    JSON.stringify(mergedChoices),
    mergedCorrectIdx,
    mergedCategory,
    mergedDifficulty,
    JSON.stringify(mergedTags),
    mergedSource,
    mergedVerified,
    mergedLanguage,
    validation.hash,
    now,
    id
  );

  const question = getQuestion(id);
  if (!question) {
    return { error: 'Failed to retrieve updated question', status: 500 };
  }

  return { question };
}

export function deleteQuestion(id: string): { success: true } | { error: string; status: number } {
  const db = getDb();

  const existing = db.prepare('SELECT id FROM trivia_questions WHERE id = ?').get(id);
  if (!existing) {
    return { error: 'Question not found', status: 404 };
  }

  if (isQuestionActiveInCurrentMatch(id)) {
    return { error: 'لا يمكن حذف السؤال المعروض حالياً', status: 409 };
  }

  db.prepare('DELETE FROM trivia_questions WHERE id = ?').run(id);

  return { success: true };
}

export function setVerified(id: string, verified: number): { question: TriviaQuestion } | { error: string; status: number } {
  const db = getDb();

  const existing = db.prepare('SELECT id FROM trivia_questions WHERE id = ?').get(id);
  if (!existing) {
    return { error: 'Question not found', status: 404 };
  }

  const now = Date.now();
  db.prepare('UPDATE trivia_questions SET verified = ?, updated_at = ? WHERE id = ?').run(verified ? 1 : 0, now, id);

  const question = getQuestion(id);
  if (!question) {
    return { error: 'Failed to retrieve updated question', status: 500 };
  }

  return { question };
}