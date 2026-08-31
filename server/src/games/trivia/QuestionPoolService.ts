import { getDb } from '../../db/db';
import crypto from 'crypto';

/**
 * Phase B3.1 — Trivia Question Pool Service.
 * Phase B3.2 — Cross-Match Question Rotation.
 *
 * Provides scalable, database-backed question access.
 * Does NOT load the entire question bank into memory.
 */

// Raw row as returned from the database (JSON fields are strings)
interface DbRow {
  id: string;
  question: string;
  choices: string;       // JSON string
  correct_idx: number;   // 0-3
  category: string;
  difficulty: string;
  tags: string;          // JSON string
  source: string | null;
  verified: number;      // 0 or 1
  language: string;
  hash: string;
  created_at: number;
  updated_at: number;
}

export interface TriviaQuestion {
  id: string;
  question: string;
  choices: string[];
  correct_idx: number;   // 0-3
  category: string;
  difficulty: string;
  tags: string[];
  source: string | null;
  verified: number;      // 0 or 1
  language: string;
  hash: string;
  created_at: number;
  updated_at: number;
}

export interface QuestionFilters {
  category?: string;
  difficulty?: string;
  language?: string;
  verifiedOnly?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  hash?: string;
}

export const VALID_DIFFICULTIES = ['سهل', 'متوسط', 'صعب'] as const;
export const VALID_LANGUAGES = ['ar'] as const;

/**
 * Normalizes text for hash computation.
 * Trims whitespace, collapses internal whitespace, preserves Arabic text meaning.
 */
function normalizeForHash(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFC');
}

/**
 * Computes a deterministic SHA-256 hash for a question.
 * Used for duplicate detection.
 */
export function computeQuestionHash(question: string, choices: string[], category: string, difficulty: string): string {
  const normalizedQuestion = normalizeForHash(question);
  const normalizedChoices = choices.map(normalizeForHash).join('|');
  const normalizedCategory = normalizeForHash(category);
  const normalizedDifficulty = normalizeForHash(difficulty);
  
  const content = `${normalizedQuestion}|${normalizedChoices}|${normalizedCategory}|${normalizedDifficulty}`;
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Validates a question before insertion.
 */
export function validateQuestion(
  question: string,
  choices: string[],
  correct_idx: number,
  category: string,
  difficulty: string,
  language: string = 'ar'
): ValidationResult {
  const errors: string[] = [];

  if (!question || !question.trim()) {
    errors.push('Question text is required');
  }

  if (!Array.isArray(choices) || choices.length !== 4) {
    errors.push('Exactly 4 choices are required');
  } else {
    for (let i = 0; i < choices.length; i++) {
      if (!choices[i] || !choices[i].trim()) {
        errors.push(`Choice ${i + 1} is required`);
      }
    }
  }

  if (!Number.isInteger(correct_idx) || correct_idx < 0 || correct_idx > 3) {
    errors.push('correct_idx must be an integer between 0 and 3');
  }

  if (!category || !category.trim()) {
    errors.push('Category is required');
  }

  if (!VALID_DIFFICULTIES.includes(difficulty as typeof VALID_DIFFICULTIES[number])) {
    errors.push(`Difficulty must be one of: ${VALID_DIFFICULTIES.join(', ')}`);
  }

  if (!VALID_LANGUAGES.includes(language as typeof VALID_LANGUAGES[number])) {
    errors.push(`Language must be one of: ${VALID_LANGUAGES.join(', ')}`);
  }

  const hash = computeQuestionHash(question, choices, category, difficulty);

  return {
    valid: errors.length === 0,
    errors,
    hash,
  };
}

/**
 * Inserts a validated question into the database.
 * Returns the question ID if inserted, or null if duplicate (hash conflict).
 */
export function importQuestion(
  question: string,
  choices: string[],
  correct_idx: number,
  category: string,
  difficulty: string,
  options: {
    tags?: string[];
    source?: string;
    verified?: number;
    language?: string;
    id?: string;
  } = {}
): { id: string | null; hash: string } {
  const validation = validateQuestion(question, choices, correct_idx, category, difficulty, options.language);
  if (!validation.valid) {
    throw new Error(`Validation failed: ${validation.errors.join('; ')}`);
  }

  const hash = validation.hash!;
  const now = Date.now();
  const id = options.id ?? crypto.randomUUID();
  const tags = options.tags ?? [];
  const source = options.source ?? null;
  const verified = options.verified ?? 0;

  const db = getDb();

  try {
    const stmt = db.prepare(`
      INSERT INTO trivia_questions (
        id, question, choices, correct_idx, category, difficulty,
        tags, source, verified, language, hash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      question,
      JSON.stringify(choices),
      correct_idx,
      category,
      difficulty,
      JSON.stringify(tags),
      source,
      verified,
      options.language ?? 'ar',
      hash,
      now,
      now
    );

    return { id, hash };
  } catch (err: any) {
    // SQLite UNIQUE constraint violation on hash
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' && err.message.includes('hash')) {
      return { id: null, hash };
    }
    throw err;
  }
}

/**
 * Bulk imports questions efficiently using a transaction.
 * Returns counts of imported, skipped (duplicates), and rejected questions.
 */
export function importQuestions(
  questions: Array<{
    question: string;
    choices: string[];
    correct_idx: number;
    category: string;
    difficulty: string;
    tags?: string[];
    source?: string;
    verified?: number;
    language?: string;
    id?: string;
  }>
): { imported: number; skipped: number; rejected: number } {
  const db = getDb();
  
  let imported = 0;
  let skipped = 0;
  let rejected = 0;

  const tx = db.transaction((qs: typeof questions) => {
    for (const q of qs) {
      const validation = validateQuestion(q.question, q.choices, q.correct_idx, q.category, q.difficulty, q.language);
      if (!validation.valid) {
        rejected++;
        continue;
      }

      try {
        const result = importQuestion(q.question, q.choices, q.correct_idx, q.category, q.difficulty, {
          tags: q.tags,
          source: q.source,
          verified: q.verified,
          language: q.language,
          id: q.id,
        });
        if (result.id) {
          imported++;
        } else {
          skipped++;
        }
      } catch {
        rejected++;
      }
    }
  });

  tx(questions);

  return { imported, skipped, rejected };
}

/**
 * Retrieves a single question by ID.
 */
export function getQuestionById(id: string): TriviaQuestion | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM trivia_questions WHERE id = ?').get(id) as
    | { id: string; question: string; choices: string; correct_idx: number; category: string; difficulty: string; tags: string; source: string | null; verified: number; language: string; hash: string; created_at: number; updated_at: number }
    | undefined;
  
  if (!row) return null;
  
  return {
    ...row,
    choices: JSON.parse(row.choices),
    tags: JSON.parse(row.tags),
  };
}

/**
 * Counts questions matching the given filters.
 */
export function countQuestions(filters: QuestionFilters = {}): number {
  const db = getDb();
  
  let sql = 'SELECT COUNT(*) as count FROM trivia_questions WHERE 1=1';
  const params: Array<string | number> = [];

  if (filters.category) {
    sql += ' AND category = ?';
    params.push(filters.category);
  }
  if (filters.difficulty) {
    sql += ' AND difficulty = ?';
    params.push(filters.difficulty);
  }
  if (filters.language) {
    sql += ' AND language = ?';
    params.push(filters.language);
  }
  if (filters.verifiedOnly) {
    sql += ' AND verified = 1';
  }

  const result = db.prepare(sql).get(...params) as { count: number } | undefined;
  return result?.count ?? 0;
}

/**
 * Retrieves questions using cross-match rotation priority.
 * 
 * Priority order:
 * 1. Never-used questions (no row in trivia_question_usage)
 * 2. Oldest last_used_at (least recently used)
 * 3. Lower usage_count (fairness tie-breaker)
 * 4. RANDOM() (final tie-breaker for equal priority)
 * 
 * Preserves all existing filters and match-level excludeIds.
 * Does NOT load the entire table into memory.
 */
export function getRandomQuestions(
  count: number,
  filters: QuestionFilters = {},
  excludeIds: string[] = []
): TriviaQuestion[] {
  const db = getDb();
  
  let sql = `
    SELECT q.* FROM trivia_questions q
    LEFT JOIN trivia_question_usage u ON q.id = u.question_id
    WHERE 1=1
  `;
  const params: Array<string | number> = [];

  if (filters.category) {
    sql += ' AND q.category = ?';
    params.push(filters.category);
  }
  if (filters.difficulty) {
    sql += ' AND q.difficulty = ?';
    params.push(filters.difficulty);
  }
  if (filters.language) {
    sql += ' AND q.language = ?';
    params.push(filters.language);
  }
  if (filters.verifiedOnly) {
    sql += ' AND q.verified = 1';
  }
  if (excludeIds.length > 0) {
    const placeholders = excludeIds.map(() => '?').join(',');
    sql += ` AND q.id NOT IN (${placeholders})`;
    params.push(...excludeIds);
  }

  // Rotation ordering:
  // 1. Never-used first (u.question_id IS NULL -> 0, else 1)
  // 2. Oldest last_used_at (NULL sorts first in ASC)
  // 3. Lower usage_count
  // 4. RANDOM() for final tie-breaking
  sql += `
    ORDER BY
      CASE WHEN u.question_id IS NULL THEN 0 ELSE 1 END ASC,
      u.last_used_at ASC,
      u.usage_count ASC,
      RANDOM()
    LIMIT ?
  `;
  params.push(count);

  interface RawRow {
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

  const rows = db.prepare(sql).all(...params) as Array<{ id: string; question: string; choices: string; correct_idx: number; category: string; difficulty: string; tags: string; source: string | null; verified: number; language: string; hash: string; created_at: number; updated_at: number }>;
  
  return rows.map(row => ({
    ...row,
    choices: JSON.parse(row.choices),
    tags: JSON.parse(row.tags),
  }));
}

/**
 * Marks a question as used in the current match.
 * Called ONLY when a question becomes the active displayed question.
 * Does NOT mark prefetched or merely queried questions.
 * 
 * UPSERT behavior:
 * - First use: inserts row with usage_count=1
 * - Subsequent uses: increments usage_count, updates last_used_at and last_match_id
 */
export function markQuestionAsUsed(questionId: string, matchId: string): void {
  const db = getDb();
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO trivia_question_usage (question_id, usage_count, last_used_at, last_match_id, created_at, updated_at)
    VALUES (?, 1, ?, ?, ?, ?)
    ON CONFLICT(question_id) DO UPDATE SET
      usage_count = usage_count + 1,
      last_used_at = excluded.last_used_at,
      last_match_id = excluded.last_match_id,
      updated_at = excluded.updated_at
  `);

  stmt.run(questionId, now, matchId, now, now);
}

/**
 * Gets all distinct categories present in the question bank.
 */
export function getCategories(): string[] {
  const db = getDb();
  const rows = db.prepare('SELECT DISTINCT category FROM trivia_questions ORDER BY category').all() as { category: string }[];
  return rows.map(r => r.category);
}

/**
 * Gets all distinct difficulties present in the question bank.
 */
export function getDifficulties(): string[] {
  const db = getDb();
  const rows = db.prepare('SELECT DISTINCT difficulty FROM trivia_questions ORDER BY difficulty').all() as { difficulty: string }[];
  return rows.map(r => r.difficulty);
}

export interface TriviaQuestion {
  id: string;
  question: string;
  choices: string[];
  correct_idx: number;   // 0-3
  category: string;
  difficulty: string;
  tags: string[];
  source: string | null;
  verified: number;      // 0 or 1
  language: string;
  hash: string;
  created_at: number;
  updated_at: number;
}

export interface QuestionFilters {
  category?: string;
  difficulty?: string;
  language?: string;
  verifiedOnly?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  hash?: string;
}