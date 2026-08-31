import { getDb } from '../../db/db';
import {
  validateQuestion,
  computeQuestionHash,
  importQuestions as importQuestionsBatch,
  TriviaQuestion,
} from './QuestionPoolService';

export interface ImportRowInput {
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

export type ImportRowStatus = 'valid_new' | 'duplicate' | 'invalid' | 'warning';

export interface ImportRowPreview {
  index: number;
  status: ImportRowStatus;
  question: string;
  choices: string[];
  correct_idx: number;
  category: string;
  difficulty: string;
  tags?: string[];
  source?: string;
  verified?: number;
  language?: string;
  errors?: string[];
  existingId?: string;
  hash: string;
}

export interface ImportPreviewResult {
  rows: ImportRowPreview[];
  summary: {
    valid: number;
    duplicate: number;
    invalid: number;
    warning: number;
  };
}

export interface ImportCommitResult {
  imported: number;
  skipped: number;
  rejected: number;
}

const MAX_FILE_SIZE = 1024 * 1024;
const MAX_ROWS = 1000;

function parseJsonContent(content: string): ImportRowInput[] {
  const data = JSON.parse(content);
  if (!Array.isArray(data)) {
    throw new Error('JSON must be an array of questions');
  }
  return data.map((row, index) => normalizeRow(row, index));
}

function parseCsvContent(content: string): ImportRowInput[] {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error('CSV must have at least a header row and one data row');
  }

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const requiredHeaders = ['question', 'choice1', 'choice2', 'choice3', 'choice4', 'correct_idx', 'category', 'difficulty'];
  for (const req of requiredHeaders) {
    if (!headers.includes(req)) {
      throw new Error(`Missing required CSV column: ${req}`);
    }
  }

  const rows: ImportRowInput[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCsvLine(line);
    if (values.length < headers.length) {
      throw new Error(`Row ${i + 1}: insufficient columns`);
    }
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });
    rows.push(normalizeCsvRow(row, i - 1));
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function normalizeRow(row: any, index: number): ImportRowInput {
  return {
    question: String(row.question ?? '').trim(),
    choices: Array.isArray(row.choices) ? row.choices.map(String) : [],
    correct_idx: parseInt(String(row.correct_idx ?? row.correctAnswer ?? '0'), 10),
    category: String(row.category ?? '').trim(),
    difficulty: String(row.difficulty ?? '').trim(),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : (row.tags ? String(row.tags).split(',').map(s => s.trim()) : []),
    source: row.source ? String(row.source) : undefined,
    verified: row.verified !== undefined ? parseInt(String(row.verified), 10) : 0,
    language: row.language ? String(row.language) : 'ar',
  };
}

function normalizeCsvRow(row: Record<string, string>, index: number): ImportRowInput {
  const choices = [
    row.choice1 ?? '',
    row.choice2 ?? '',
    row.choice3 ?? '',
    row.choice4 ?? '',
  ].map(c => c.trim());

  return {
    question: (row.question ?? '').trim(),
    choices,
    correct_idx: parseInt(String(row.correct_idx ?? '0'), 10),
    category: (row.category ?? '').trim(),
    difficulty: (row.difficulty ?? '').trim(),
    tags: row.tags ? String(row.tags).split(',').map(s => s.trim()) : [],
    source: row.source ? String(row.source).trim() : undefined,
    verified: row.verified !== undefined ? parseInt(String(row.verified), 10) : 0,
    language: row.language ? String(row.language).trim() : 'ar',
  };
}

export function previewImport(fileContent: string, mimeType: string): ImportPreviewResult {
  let rows: ImportRowInput[];

  if (mimeType === 'application/json' || mimeType === 'text/json') {
    rows = parseJsonContent(fileContent);
  } else if (mimeType === 'text/csv' || mimeType === 'application/csv') {
    rows = parseCsvContent(fileContent);
  } else {
    throw new Error('Unsupported file format. Use JSON or CSV.');
  }

  if (rows.length > MAX_ROWS) {
    throw new Error(`Too many rows. Maximum is ${MAX_ROWS}.`);
  }

  const db = getDb();
  const validRows = rows.filter(r => {
    const v = validateQuestion(r.question, r.choices, r.correct_idx, r.category, r.difficulty, r.language);
    return v.valid;
  });
  const hashes = validRows.map(r => computeQuestionHash(r.question, r.choices, r.category, r.difficulty));
  const uniqueHashes = [...new Set(hashes)];

  let existingHashes = new Set<string>();
  if (uniqueHashes.length > 0) {
    const placeholders = uniqueHashes.map(() => '?').join(',');
    const existing = db.prepare(`SELECT hash FROM trivia_questions WHERE hash IN (${placeholders})`).all(...uniqueHashes) as { hash: string }[];
    existingHashes = new Set(existing.map(e => e.hash));
  }

  const inFileHashes = new Map<string, number>();
  const previews: ImportRowPreview[] = [];

  rows.forEach((row, index) => {
    const validation = validateQuestion(row.question, row.choices, row.correct_idx, row.category, row.difficulty, row.language);
    const hash = validation.hash!;

    let status: ImportRowStatus = 'valid_new';
    let errors: string[] | undefined;
    let existingId: string | undefined;

    if (!validation.valid) {
      status = 'invalid';
      errors = validation.errors;
    } else if (existingHashes.has(hash)) {
      status = 'duplicate';
      const existing = db.prepare('SELECT id FROM trivia_questions WHERE hash = ?').get(hash) as { id: string } | undefined;
      if (existing) existingId = existing.id;
    } else if (inFileHashes.has(hash)) {
      status = 'duplicate';
    } else {
      inFileHashes.set(hash, index);
    }

    previews.push({
      index,
      status,
      question: row.question,
      choices: row.choices,
      correct_idx: row.correct_idx,
      category: row.category,
      difficulty: row.difficulty,
      tags: row.tags,
      source: row.source,
      verified: row.verified,
      language: row.language,
      errors,
      existingId,
      hash,
    });
  });

  const summary = {
    valid: previews.filter(p => p.status === 'valid_new').length,
    duplicate: previews.filter(p => p.status === 'duplicate').length,
    invalid: previews.filter(p => p.status === 'invalid').length,
    warning: previews.filter(p => p.status === 'warning').length,
  };

  return { rows: previews, summary };
}

export function commitImport(rows: ImportRowPreview[]): ImportCommitResult {
  const validRows = rows
    .filter(p => p.status === 'valid_new')
    .map(p => ({
      question: p.question,
      choices: p.choices,
      correct_idx: p.correct_idx,
      category: p.category,
      difficulty: p.difficulty,
      tags: p.tags,
      source: p.source,
      verified: p.verified ?? 0,
      language: p.language ?? 'ar',
    }));

  return importQuestionsBatch(validRows);
}