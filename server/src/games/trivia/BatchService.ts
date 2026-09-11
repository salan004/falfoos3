import { getDb } from '../../db/db';
import crypto from 'crypto';

export type BatchStatus = 
  | 'DRAFT'
  | 'VALIDATING'
  | 'VALIDATED'
  | 'RECONCILED'
  | 'APPROVED'
  | 'IMPORTED'
  | 'REJECTED';

export interface TriviaBatch {
  id: string;
  name: string;
  batch_number: number;
  status: BatchStatus;
  question_count: number;
  validation_report: string | null;
  import_report: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateBatchInput {
  name: string;
  batch_number?: number;
}

export interface UpdateBatchStatusInput {
  status: BatchStatus;
  validation_report?: string;
  import_report?: string;
  question_count?: number;
}

const VALID_STATUSES: BatchStatus[] = [
  'DRAFT',
  'VALIDATING',
  'VALIDATED',
  'RECONCILED',
  'APPROVED',
  'IMPORTED',
  'REJECTED',
];

function validateStatus(status: string): BatchStatus {
  if (VALID_STATUSES.includes(status as BatchStatus)) {
    return status as BatchStatus;
  }
  throw new Error(`Invalid batch status: ${status}. Must be one of: ${VALID_STATUSES.join(', ')}`);
}

function rowToBatch(row: any): TriviaBatch {
  return {
    id: row.id,
    name: row.name,
    batch_number: row.batch_number,
    status: row.status,
    question_count: row.question_count,
    validation_report: row.validation_report,
    import_report: row.import_report,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createBatch(input: CreateBatchInput): TriviaBatch {
  const db = getDb();
  const now = Date.now();

  let batchNumber = input.batch_number;
  if (!batchNumber) {
    const maxResult = db.prepare('SELECT MAX(batch_number) as max_num FROM trivia_batches').get() as { max_num: number | null } | undefined;
    batchNumber = (maxResult?.max_num ?? 0) + 1;
  }

  const existing = db.prepare('SELECT id FROM trivia_batches WHERE batch_number = ?').get(batchNumber);
  if (existing) {
    throw new Error(`Batch number ${batchNumber} already exists`);
  }

  const id = crypto.randomUUID();

  const stmt = db.prepare(`
    INSERT INTO trivia_batches (id, name, batch_number, status, question_count, created_at, updated_at)
    VALUES (?, ?, ?, 'DRAFT', 0, ?, ?)
  `);

  stmt.run(id, input.name, batchNumber, now, now);

  return getBatch(id)!;
}

export function getBatch(id: string): TriviaBatch | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM trivia_batches WHERE id = ?').get(id);
  return row ? rowToBatch(row) : null;
}

export function getBatchByNumber(batchNumber: number): TriviaBatch | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM trivia_batches WHERE batch_number = ?').get(batchNumber);
  return row ? rowToBatch(row) : null;
}

export function listBatches(): TriviaBatch[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM trivia_batches ORDER BY batch_number ASC').all();
  return rows.map(rowToBatch);
}

export function updateBatchStatus(
  id: string,
  input: UpdateBatchStatusInput
): TriviaBatch {
  const db = getDb();
  const status = validateStatus(input.status);
  const now = Date.now();

  const batch = getBatch(id);
  if (!batch) {
    throw new Error(`Batch not found: ${id}`);
  }

  const updates: string[] = ['status = ?', 'updated_at = ?'];
  const params: any[] = [status, now];

  if (input.validation_report !== undefined) {
    updates.push('validation_report = ?');
    params.push(input.validation_report);
  }
  if (input.import_report !== undefined) {
    updates.push('import_report = ?');
    params.push(input.import_report);
  }
  if (input.question_count !== undefined) {
    updates.push('question_count = ?');
    params.push(input.question_count);
  }

  params.push(id);

  db.prepare(`UPDATE trivia_batches SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  return getBatch(id)!;
}

export function deleteBatch(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM trivia_batches WHERE id = ?').run(id);
  return result.changes > 0;
}

export function getBatchQuestions(batchId: string): any[] {
  const db = getDb();
  return db.prepare('SELECT * FROM trivia_questions WHERE batch_id = ?').all(batchId);
}

export function countBatchQuestions(batchId: string): number {
  const db = getDb();
  const result = db.prepare('SELECT COUNT(*) as count FROM trivia_questions WHERE batch_id = ?').get(batchId) as { count: number };
  return result.count;
}

export function assignQuestionsToBatch(questionIds: string[], batchId: string): number {
  const db = getDb();
  const placeholders = questionIds.map(() => '?').join(',');
  const result = db.prepare(
    `UPDATE trivia_questions SET batch_id = ?, updated_at = ? WHERE id IN (${placeholders})`
  ).run(batchId, Date.now(), ...questionIds);
  return result.changes;
}

export function removeBatchFromQuestions(batchId: string): number {
  const db = getDb();
  const result = db.prepare('UPDATE trivia_questions SET batch_id = NULL, updated_at = ? WHERE batch_id = ?').run(Date.now(), batchId);
  return result.changes;
}

export function canTransitionStatus(from: BatchStatus, to: BatchStatus): boolean {
  const validTransitions: Record<BatchStatus, BatchStatus[]> = {
    DRAFT: ['VALIDATING', 'REJECTED'],
    VALIDATING: ['VALIDATED', 'REJECTED', 'DRAFT'],
    VALIDATED: ['RECONCILED', 'REJECTED', 'VALIDATING'],
    RECONCILED: ['APPROVED', 'REJECTED', 'VALIDATED'],
    APPROVED: ['IMPORTED', 'REJECTED', 'RECONCILED'],
    IMPORTED: ['REJECTED'],
    REJECTED: ['DRAFT', 'VALIDATING'],
  };
  return validTransitions[from]?.includes(to) ?? false;
}

export function transitionBatchStatus(
  id: string,
  newStatus: BatchStatus,
  options: { validation_report?: string; import_report?: string; question_count?: number } = {}
): TriviaBatch {
  const batch = getBatch(id);
  if (!batch) {
    throw new Error(`Batch not found: ${id}`);
  }

  if (!canTransitionStatus(batch.status, newStatus)) {
    throw new Error(`Invalid status transition: ${batch.status} -> ${newStatus}`);
  }

  return updateBatchStatus(id, {
    status: newStatus,
    validation_report: options.validation_report ?? batch.validation_report ?? undefined,
    import_report: options.import_report ?? batch.import_report ?? undefined,
    question_count: options.question_count ?? batch.question_count,
  });
}