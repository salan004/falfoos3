import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  createBatch,
  getBatch,
  updateBatchStatus,
  transitionBatchStatus,
  assignQuestionsToBatch,
  getBatchQuestions,
  TriviaBatch,
  BatchStatus,
} from './BatchService';
import {
  runValidationPipeline,
  BatchValidationReport,
  BatchValidationInput,
} from './validation/TriviaValidationPipeline';
import { importQuestions, computeQuestionHash } from './QuestionPoolService';
import { getDb } from '../../db/db';

export interface BatchProcessingOptions {
  validate?: boolean;
  reconcile?: boolean;
  import?: boolean;
  skipValidationOnImport?: boolean;
}

export interface BatchProcessingResult {
  batch: TriviaBatch;
  validationReport?: BatchValidationReport;
  importResult?: { imported: number; skipped: number; rejected: number };
  reconciliationReport?: ReconciliationReport;
}

export interface ReconciliationReport {
  batchId: string;
  totalInBatch: number;
  foundInDb: number;
  missingFromDb: number;
  hashMismatches: number;
  extraInDb: number;
  passed: boolean;
  details: string[];
}

export interface BatchSourceQuestion {
  question: string;
  choices: string[];
  correct_idx: number;
  correct_answer: string;
  category: string;
  difficulty: string;
  language?: string;
  tags?: string[];
  source?: string;
  verified?: boolean;
}

export function createBatchFromQuestions(
  name: string,
  questions: BatchSourceQuestion[],
  batchNumber?: number
): TriviaBatch {
  const batch = createBatch({ name, batch_number: batchNumber });
  return batch;
}

export function loadBatchFromFile(
  batchId: string,
  filePath: string
): BatchSourceQuestion[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content);
  if (!Array.isArray(data)) {
    throw new Error('Batch file must contain a JSON array of questions');
  }
  return data;
}

export function saveBatchToFile(
  batchId: string,
  questions: BatchSourceQuestion[],
  outputDir?: string
): string {
  const batch = getBatch(batchId);
  if (!batch) throw new Error(`Batch not found: ${batchId}`);

  const dir = outputDir ?? path.resolve('scripts/trivia-t2/batches');
  fs.mkdirSync(dir, { recursive: true });

  const fileName = `batch-${String(batch.batch_number).padStart(3, '0')}.json`;
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(questions, null, 2), 'utf-8');
  return filePath;
}

export function ingestBatchQuestions(
  batchId: string,
  questions: BatchSourceQuestion[]
): string[] {
  const batch = getBatch(batchId);
  if (!batch) throw new Error(`Batch not found: ${batchId}`);

  const db = getDb();
  const questionIds: string[] = [];

  const tx = db.transaction((qs: BatchSourceQuestion[]) => {
    for (const q of qs) {
      const id = crypto.randomUUID();
      const now = Date.now();
      const hash = computeQuestionHash(q.question, q.choices, q.category, q.difficulty);

      db.prepare(`
        INSERT INTO trivia_questions (
          id, question, choices, correct_idx, correct_answer, category, difficulty,
          tags, source, verified, language, hash, batch_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        q.question,
        JSON.stringify(q.choices),
        q.correct_idx,
        q.correct_answer,
        q.category,
        q.difficulty,
        JSON.stringify(q.tags ?? []),
        q.source ?? null,
        q.verified ? 1 : 0,
        q.language ?? 'ar',
        hash,
        batchId,
        now,
        now
      );

      questionIds.push(id);
    }
  });

  tx(questions);
  return questionIds;
}

export function validateBatch(batchId: string): BatchValidationReport {
  const batch = getBatch(batchId);
  if (!batch) throw new Error(`Batch not found: ${batchId}`);

  const questions = getBatchQuestions(batchId);
  if (questions.length === 0) {
    throw new Error(`Batch ${batchId} has no questions`);
  }

  // Convert DB questions to validation input format
  const validationInput: BatchValidationInput['questions'] = questions.map(q => ({
    question: q.question,
    choices: JSON.parse(q.choices),
    correct_idx: q.correct_idx,
    correct_answer: q.correct_answer ?? q.choices[q.correct_idx],
    category: q.category,
    difficulty: q.difficulty,
    language: q.language,
    tags: JSON.parse(q.tags),
    source: q.source,
    verified: q.verified === 1,
  }));

  const report = runValidationPipeline(batchId, validationInput);
  report.batchName = batch.name;

  // Update batch status - first to VALIDATING, then to VALIDATED/REJECTED
  transitionBatchStatus(batchId, 'VALIDATING');
  const newStatus = report.passed ? 'VALIDATED' : 'REJECTED';
  transitionBatchStatus(batchId, newStatus, {
    validation_report: JSON.stringify(report),
    question_count: report.validQuestions,
  });

  return report;
}

export function reconcileBatch(batchId: string): ReconciliationReport {
  const batch = getBatch(batchId);
  if (!batch) throw new Error(`Batch not found: ${batchId}`);

  const batchQuestions = getBatchQuestions(batchId);
  const totalInBatch = batchQuestions.length;
  const details: string[] = [];

  let foundInDb = 0;
  let hashMismatches = 0;
  let missingFromDb = 0;

  batchQuestions.forEach(q => {
    const dbQuestion = getDb().prepare('SELECT * FROM trivia_questions WHERE id = ?').get(q.id) as { hash: string } | undefined;
    if (!dbQuestion) {
      missingFromDb++;
      details.push(`MISSING: ${q.id} - "${q.question.substring(0, 50)}..."`);
    } else {
      foundInDb++;
      if (dbQuestion.hash !== q.hash) {
        hashMismatches++;
        details.push(`HASH_MISMATCH: ${q.id} - DB hash differs`);
      }
    }
  });

  // Check for extra questions in DB with this batch_id
  const dbQuestions = getDb().prepare('SELECT id FROM trivia_questions WHERE batch_id = ?').all(batchId) as { id: string }[];
  const batchIds = new Set(batchQuestions.map(q => q.id));
  let extraInDb = 0;
  dbQuestions.forEach(q => {
    if (!batchIds.has(q.id)) {
      extraInDb++;
      details.push(`EXTRA_IN_DB: ${q.id} - exists in DB but not in batch source`);
    }
  });

  const passed = missingFromDb === 0 && hashMismatches === 0 && extraInDb === 0;

  if (passed) {
    details.push('RECONCILIATION PASSED: All batch questions present in DB with matching hashes');
  }

  const report: ReconciliationReport = {
    batchId,
    totalInBatch,
    foundInDb,
    missingFromDb,
    hashMismatches,
    extraInDb,
    passed,
    details,
  };

  // Update batch status
  if (batch.status === 'VALIDATED' && passed) {
    transitionBatchStatus(batchId, 'RECONCILED', {
      question_count: totalInBatch,
    });
  }

  return report;
}

export function importBatch(batchId: string, skipValidation = false): { imported: number; skipped: number; rejected: number } {
  const batch = getBatch(batchId);
  if (!batch) throw new Error(`Batch not found: ${batchId}`);

  if (!skipValidation && batch.status !== 'VALIDATED' && batch.status !== 'RECONCILED' && batch.status !== 'APPROVED') {
    throw new Error(`Batch ${batchId} is not validated (status: ${batch.status}). Run validation first or use skipValidation=true.`);
  }

  const questions = getBatchQuestions(batchId);
  if (questions.length === 0) {
    throw new Error(`Batch ${batchId} has no questions`);
  }

  // Convert to import format
  const importQuestionsList = questions.map(q => ({
    question: q.question,
    choices: JSON.parse(q.choices),
    correct_idx: q.correct_idx,
    category: q.category,
    difficulty: q.difficulty,
    tags: JSON.parse(q.tags),
    source: q.source,
    verified: q.verified,
    language: q.language,
    id: q.id,
  }));

  const result = importQuestions(importQuestionsList);

  // Update batch status
  transitionBatchStatus(batchId, 'IMPORTED', {
    import_report: JSON.stringify(result),
    question_count: result.imported,
  });

  return result;
}

export function approveBatch(batchId: string): TriviaBatch {
  const batch = getBatch(batchId);
  if (!batch) throw new Error(`Batch not found: ${batchId}`);

  if (batch.status !== 'RECONCILED') {
    throw new Error(`Batch ${batchId} must be RECONCILED before approval (current: ${batch.status})`);
  }

  return transitionBatchStatus(batchId, 'APPROVED');
}

export function processBatch(
  batchId: string,
  options: BatchProcessingOptions = {}
): BatchProcessingResult {
  const batch = getBatch(batchId);
  if (!batch) throw new Error(`Batch not found: ${batchId}`);

  const result: BatchProcessingResult = { batch };

  // Validate
  if (options.validate !== false) {
    transitionBatchStatus(batchId, 'VALIDATING');
    result.validationReport = validateBatch(batchId);
  }

  // Reconcile
  if (options.reconcile !== false && result.validationReport?.passed) {
    result.reconciliationReport = reconcileBatch(batchId);
  }

  // Import
  if (options.import !== false && result.validationReport?.passed && result.reconciliationReport?.passed) {
    result.importResult = importBatch(batchId, options.skipValidationOnImport);
  }

  // Refresh batch
  result.batch = getBatch(batchId)!;

  return result;
}

export function processBatchFromFile(
  filePath: string,
  name: string,
  batchNumber?: number,
  options: BatchProcessingOptions = {}
): BatchProcessingResult {
  const questions = loadBatchFromFile('', filePath);
  const batch = createBatchFromQuestions(name, questions, batchNumber);
  const savedPath = saveBatchToFile(batch.id, questions);
  console.log(`Batch saved to: ${savedPath}`);

  // Add questions to batch (in-memory, they'll be imported later)
  const questionIds = questions.map((_, i) => `temp-${batch.id}-${i}`);
  // Note: Actual question IDs will be assigned during import

  return processBatch(batch.id, options);
}

export function generateBatchReport(report: BatchValidationReport): string {
  const lines: string[] = [];
  lines.push(`Batch: ${report.batchName || 'Unknown'}`);
  lines.push(`Status: ${report.passed ? 'PASSED' : 'FAILED'}`);
  lines.push('');
  lines.push(`Total Questions: ${report.totalQuestions}`);
  lines.push(`Valid Questions: ${report.validQuestions}`);
  lines.push(`Invalid Questions: ${report.invalidQuestions}`);
  lines.push(`Blocking Errors: ${report.errors}`);
  lines.push(`Warnings: ${report.warnings}`);
  lines.push('');

  lines.push('Categories:');
  Object.entries(report.distribution.categories).forEach(([cat, count]) => {
    lines.push(`  ${cat}: ${count}`);
  });
  lines.push('');

  lines.push('Difficulties:');
  Object.entries(report.distribution.difficulties).forEach(([diff, count]) => {
    lines.push(`  ${diff}: ${count}`);
  });
  lines.push('');

  lines.push('Correct Index Distribution:');
  Object.entries(report.distribution.correctIdx).forEach(([idx, count]) => {
    lines.push(`  ${idx}: ${count}`);
  });
  lines.push('');

  lines.push('Validation Checks:');
  lines.push(`  Exact Duplicates: ${report.duplicateChecks.exactDuplicates}`);
  lines.push(`  Hash Duplicates: ${report.duplicateChecks.hashDuplicates}`);
  lines.push(`  Legacy Collisions: ${report.duplicateChecks.legacyCollisions}`);
  lines.push(`  Pilot Collisions: ${report.duplicateChecks.pilotCollisions}`);
  lines.push(`  Previous Batch Collisions: ${report.duplicateChecks.previousBatchCollisions}`);
  lines.push('');

  lines.push(`Template Repetition: ${report.templateRepetition.status} (${report.templateRepetition.flaggedCount} flagged)`);
  lines.push('');

  lines.push(`Arabic Quality: ${report.arabicQuality.warnings} warnings across ${report.arabicQuality.questionsWithWarnings} questions`);
  Object.entries(report.arabicQuality.byRule).forEach(([rule, count]) => {
    lines.push(`  ${rule}: ${count}`);
  });
  lines.push('');

  lines.push(`Correct Answer Binding: ${report.correctAnswerBinding.passed}/${report.correctAnswerBinding.checked} passed`);
  if (report.correctAnswerBinding.failed > 0) {
    lines.push(`  FAILURES: ${report.correctAnswerBinding.failed}`);
    report.correctAnswerBinding.failures.forEach((f: { index: number; correctAnswer: string; correctIdx: number; actualChoice: string }) => {
      lines.push(`    Q${f.index}: correct_answer="${f.correctAnswer}" vs choices[${f.correctIdx}]="${f.actualChoice}"`);
    });
  }
  lines.push('');

  if (report.errors > 0) {
    lines.push('BLOCKING ERRORS:');
    report.issues.filter((i: { severity: string }) => i.severity === 'ERROR').forEach((issue: { code: string; questionIndex?: number; field?: string; message: string }) => {
      lines.push(`  [${issue.code}] Q${issue.questionIndex ?? 'N/A'} ${issue.field ? `[${issue.field}]` : ''}: ${issue.message}`);
    });
    lines.push('');
  }

  if (report.warnings > 0) {
    lines.push('WARNINGS:');
    report.issues.filter((i: { severity: string }) => i.severity === 'WARNING').slice(0, 20).forEach((issue: { code: string; questionIndex?: number; field?: string; message: string }) => {
      lines.push(`  [${issue.code}] Q${issue.questionIndex ?? 'N/A'} ${issue.field ? `[${issue.field}]` : ''}: ${issue.message}`);
    });
    if (report.warnings > 20) {
      lines.push(`  ... and ${report.warnings - 20} more warnings`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function printBatchReport(report: BatchValidationReport): void {
  console.log(generateBatchReport(report));
}