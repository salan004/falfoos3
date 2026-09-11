import { getDb } from '../../../db/db';
import {
  validateSchema,
} from './schemaValidator';
import { checkDuplicates, DuplicateCheckResult } from './duplicateValidator';
import { validateDistribution, DistributionResult } from './distributionValidator';
import { validateCorrectAnswerBinding, CorrectAnswerBindingResult } from './correctAnswerValidator';
import { checkTemplateRepetition, TemplateRepetitionResult } from './templateValidator';
import { checkArabicQuality, ArabicQualityResult } from './arabicQualityValidator';
import {
  BatchValidationInput,
  BatchValidationReport,
  ValidationIssue,
  ValidatedQuestion,
  SoftBounds,
} from './types';
import { getBatch } from '../BatchService';
import { computeQuestionHash, normalizeForHash } from '../QuestionPoolService';
import { getActiveCategories, getCategoryByTextCategory } from '../CategoryService';
import fs from 'fs';
import path from 'path';

// Re-export for external use
export { BatchValidationInput, BatchValidationReport, ValidationIssue, ValidatedQuestion, SoftBounds } from './types';

// Build DEFAULT_SOFT_BOUNDS and GLOBAL_TARGETS from active categories
function buildCategoryConfig(): { softBounds: SoftBounds; globalTargets: Record<string, number> } {
  const activeCategories = getActiveCategories();
  const softBounds: SoftBounds = { category: {}, difficulty: {}, correctIdx: {} };
  const globalTargets: Record<string, number> = {};

  // Default soft bounds per category (for 50-question batch)
  const defaultCategoryBounds: Record<string, { min: number; max: number }> = {
    history: { min: 5, max: 10 },
    geography: { min: 5, max: 10 },
    science: { min: 5, max: 10 },
    arts_literature: { min: 4, max: 8 },
    sports: { min: 3, max: 7 },
    technology_space: { min: 3, max: 7 },
    video_games: { min: 4, max: 9 },
    general_knowledge: { min: 3, max: 7 },
  };

  // Global targets (for 1000 questions total)
  const defaultGlobalTargets: Record<string, number> = {
    history: 150,
    geography: 150,
    science: 150,
    arts_literature: 120,
    sports: 100,
    technology_space: 100,
    video_games: 130,
    general_knowledge: 100,
  };

  activeCategories.forEach(cat => {
    softBounds.category[cat.name_ar] = defaultCategoryBounds[cat.slug] ?? { min: 3, max: 10 };
    globalTargets[cat.name_ar] = defaultGlobalTargets[cat.slug] ?? 100;
  });

  softBounds.difficulty = {
    'سهل': { min: 12, max: 22 },
    'متوسط': { min: 18, max: 28 },
    'صعب': { min: 5, max: 15 },
  };
  softBounds.correctIdx = {
    0: { min: 8, max: 18 },
    1: { min: 8, max: 18 },
    2: { min: 8, max: 18 },
    3: { min: 8, max: 18 },
  };

  return { softBounds, globalTargets };
}

const { softBounds: DEFAULT_SOFT_BOUNDS, globalTargets: GLOBAL_TARGETS } = buildCategoryConfig();

function getLegacyHashes(): Set<string> {
  const legacyPath = path.resolve('src/data/trivia-questions.json');
  if (!fs.existsSync(legacyPath)) return new Set();
  const raw = fs.readFileSync(legacyPath, 'utf-8');
  const legacyQuestions = JSON.parse(raw);
  const hashes = new Set<string>();
  legacyQuestions.forEach((q: any) => {
    hashes.add(computeQuestionHash(q.question, q.choices, q.category, q.difficulty));
  });
  return hashes;
}

function getPilotHashes(): Set<string> {
  const pilotPath = path.resolve('scripts/trivia-pilot/questions/questions-source.json');
  if (!fs.existsSync(pilotPath)) return new Set();
  const pilotData = JSON.parse(fs.readFileSync(pilotPath, 'utf-8'));
  const hashes = new Set<string>();
  pilotData.forEach((q: any) => {
    hashes.add(computeQuestionHash(q.question, q.choices, q.category, q.difficulty));
  });
  return hashes;
}

function getPreviousBatchHashes(excludeBatchId?: string): Set<string> {
  const db = getDb();
  let sql = 'SELECT hash FROM trivia_questions WHERE batch_id IS NOT NULL';
  const params: any[] = [];
  if (excludeBatchId) {
    sql += ' AND batch_id != ?';
    params.push(excludeBatchId);
  }
  const rows = db.prepare(sql).all(...params) as { hash: string }[];
  return new Set(rows.map(r => r.hash));
}

// Get allowed categories from active canonical categories
function getAllowedCategories(): string[] {
  return getActiveCategories().map(c => c.name_ar);
}

function getAllowedDifficulties(): string[] {
  return ['سهل', 'متوسط', 'صعب'];
}

export function validateBatch(input: BatchValidationInput): BatchValidationReport {
  const {
    batchId,
    questions,
    options = {},
  } = input;

  const {
    legacyHashes = getLegacyHashes(),
    pilotHashes = getPilotHashes(),
    previousBatchHashes = getPreviousBatchHashes(batchId),
    softBounds = DEFAULT_SOFT_BOUNDS as SoftBounds,
    allowedCategories = getAllowedCategories(),
    allowedDifficulties = getAllowedDifficulties(),
  } = options;

  const allIssues: ValidationIssue[] = [];

  // 1. Schema Validation
  const { results: schemaResults, validated } = validateSchema(questions, {
    allowedCategories,
    allowedDifficulties,
  });
  schemaResults.forEach(r => allIssues.push(...r.issues));

  if (validated.length === 0) {
    return buildReport(batchId, input, allIssues, validated, {
      duplicateChecks: { exactDuplicates: 0, hashDuplicates: 0, legacyCollisions: 0, pilotCollisions: 0, previousBatchCollisions: 0 },
      templateRepetition: { status: 'PASS', signatures: [], flaggedCount: 0, totalQuestions: 0 },
      arabicQuality: { warnings: 0, questionsWithWarnings: 0, byRule: {} },
      correctAnswerBinding: { checked: 0, passed: 0, failed: 0, failures: [] },
      distribution: { categories: {}, difficulties: {}, correctIdx: {} },
    }, false);
  }

  // 2. Duplicate Detection
  const duplicateResult = checkDuplicates(validated, {
    legacyHashes,
    pilotHashes,
    previousBatchHashes,
  });
  allIssues.push(...duplicateResult.issues);

  // 3. Distribution Validation
  const distributionResult = validateDistribution(validated, {
    softBounds,
    globalTargets: GLOBAL_TARGETS,
  });
  allIssues.push(...distributionResult.issues);

  // 4. Correct Answer Binding Validation (CRITICAL)
  const correctAnswerResult = validateCorrectAnswerBinding(validated);
  allIssues.push(...correctAnswerResult.issues);

  // 5. Template Repetition
  const templateResult = checkTemplateRepetition(validated, { maxAllowedPerTemplate: 3 });
  allIssues.push(...templateResult.issues);

  // 6. Arabic Quality
  const arabicQualityResult = checkArabicQuality(validated);
  allIssues.push(...arabicQualityResult.issues);

  // 7. Category Canonical Validation - reject unknown/inactive categories
  validated.forEach((q, index) => {
    const canonicalCategory = getCategoryByTextCategory(q.category);
    if (!canonicalCategory) {
      allIssues.push({
        code: 'UNKNOWN_CATEGORY',
        severity: 'ERROR',
        message: `Category '${q.category}' is not a recognized canonical category`,
        questionIndex: index,
        field: 'category',
      });
    } else if (!canonicalCategory.is_active) {
      allIssues.push({
        code: 'INACTIVE_CATEGORY',
        severity: 'ERROR',
        message: `Category '${q.category}' is not active`,
        questionIndex: index,
        field: 'category',
      });
    }
  });

  // Determine overall pass/fail
  const blockingErrors = allIssues.filter(i => i.severity === 'ERROR').length;
  const passed = blockingErrors === 0;

  return buildReport(batchId, input, allIssues, validated, {
    duplicateChecks: {
      exactDuplicates: duplicateResult.exactDuplicates.length,
      hashDuplicates: duplicateResult.hashDuplicates.length,
      legacyCollisions: duplicateResult.legacyCollisions,
      pilotCollisions: duplicateResult.pilotCollisions,
      previousBatchCollisions: duplicateResult.previousBatchCollisions,
    },
    templateRepetition: templateResult.result,
    arabicQuality: {
      warnings: arabicQualityResult.result.warnings.length,
      questionsWithWarnings: arabicQualityResult.result.questionsWithWarnings,
      byRule: Object.fromEntries(
        Object.entries(
          arabicQualityResult.result.warnings.reduce((acc, w) => {
            acc[w.rule] = (acc[w.rule] || 0) + 1;
            return acc;
          }, {} as Record<string, number>)
        )
      ),
    },
    correctAnswerBinding: {
      checked: correctAnswerResult.checked,
      passed: correctAnswerResult.passed,
      failed: correctAnswerResult.failed,
      failures: correctAnswerResult.failures,
    },
    distribution: distributionResult.distribution,
  }, passed);
}

function buildReport(
  batchId: string,
  input: BatchValidationInput,
  allIssues: ValidationIssue[],
  validated: ValidatedQuestion[],
  checks: {
    duplicateChecks: BatchValidationReport['duplicateChecks'];
    templateRepetition: TemplateRepetitionResult;
    arabicQuality: BatchValidationReport['arabicQuality'];
    correctAnswerBinding: BatchValidationReport['correctAnswerBinding'];
    distribution: BatchValidationReport['distribution'];
  },
  passed: boolean
): BatchValidationReport {
  const errors = allIssues.filter(i => i.severity === 'ERROR').length;
  const warnings = allIssues.filter(i => i.severity === 'WARNING').length;

  return {
    batchId,
    batchName: '', // Will be filled by caller
    totalQuestions: input.questions.length,
    validQuestions: validated.length,
    invalidQuestions: input.questions.length - validated.length,
    warnings,
    errors,
    distribution: checks.distribution,
    duplicateChecks: checks.duplicateChecks,
    templateRepetition: checks.templateRepetition,
    arabicQuality: checks.arabicQuality,
    correctAnswerBinding: checks.correctAnswerBinding,
    issues: allIssues,
    passed,
  };
}

export interface ValidationPipelineOptions {
  legacyHashes?: Set<string>;
  pilotHashes?: Set<string>;
  previousBatchHashes?: Set<string>;
  softBounds?: SoftBounds;
  allowedCategories?: string[];
  allowedDifficulties?: string[];
}

export function runValidationPipeline(
  batchId: string,
  questions: BatchValidationInput['questions'],
  options: ValidationPipelineOptions = {}
): BatchValidationReport {
  const batch = getBatch(batchId);
  const report = validateBatch({
    batchId,
    questions,
    options,
  });
  if (batch) {
    report.batchName = batch.name;
  }
  return report;
}