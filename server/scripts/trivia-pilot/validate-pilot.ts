import fs from 'fs';
import path from 'path';
import { computeQuestionHash } from './lib/trivia-hash';
import { readLegacyQuestions, computeLegacyHashes } from './lib/legacy-utils';
import { analyzeTemplateRepetition, TemplateRepetitionResult } from './lib/template-repetition';
import { analyzeArabicQuality, ArabicQualityResult } from './lib/arabic-quality';

interface PreparedQuestion {
  question: string;
  choices: string[];
  correct_idx: number;
  category: string;
  difficulty: string;
  language: string;
  tags?: string[];
  source?: string;
  verified?: boolean;
  hash: string;
  normalized: {
    question: string;
    choices: string[];
    category: string;
    difficulty: string;
  };
}

const PREPARED_PATH = path.resolve('scripts/trivia-pilot/output/prepared-questions.json');
const LEGACY_PATH = path.resolve('src/data/trivia-questions.json');
const TEMPLATE_REPORT_PATH = path.resolve('scripts/trivia-pilot/output/template-repetition-report.json');
const ARABIC_QUALITY_REPORT_PATH = path.resolve('scripts/trivia-pilot/output/arabic-quality-report.json');

interface ValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    total: number;
    categories: Record<string, number>;
    difficulties: Record<string, number>;
    correctIdx: Record<number, number>;
    exactDuplicates: number;
    hashDuplicates: number;
    legacyCollisions: number;
  };
  templateRepetition: TemplateRepetitionResult;
  arabicQuality: ArabicQualityResult;
}

function validateDistribution(stats: ValidationResult['stats']): string[] {
  const errors: string[] = [];

  if (stats.total !== 100) {
    errors.push(`Total questions: ${stats.total} (required: 100)`);
  }

  const requiredCategories = {
    'تاريخ': 20,
    'جغرافيا': 20,
    'علوم': 20,
    'ثقافة عامة': 20,
    'ألعاب فيديو': 20,
  };

  for (const [cat, required] of Object.entries(requiredCategories)) {
    const actual = stats.categories[cat] || 0;
    if (actual !== required) {
      errors.push(`Category '${cat}': ${actual} (required: ${required})`);
    }
  }

  const requiredDifficulties = {
    'سهل': 35,
    'متوسط': 45,
    'صعب': 20,
  };

  for (const [diff, required] of Object.entries(requiredDifficulties)) {
    const actual = stats.difficulties[diff] || 0;
    if (actual !== required) {
      errors.push(`Difficulty '${diff}': ${actual} (required: ${required})`);
    }
  }

  for (let i = 0; i <= 3; i++) {
    const actual = stats.correctIdx[i] || 0;
    if (actual < 20 || actual > 30) {
      errors.push(`correct_idx ${i}: ${actual} (required: 20-30)`);
    }
  }

  if (stats.exactDuplicates > 0) {
    errors.push(`Exact duplicate questions: ${stats.exactDuplicates}`);
  }

  if (stats.hashDuplicates > 0) {
    errors.push(`Hash duplicates within pilot: ${stats.hashDuplicates}`);
  }

  if (stats.legacyCollisions > 0) {
    errors.push(`Hash collisions with legacy dataset: ${stats.legacyCollisions}`);
  }

  return errors;
}

function checkExactDuplicates(questions: PreparedQuestion[]): Array<{ indices: number[]; question: string }> {
  const seen = new Map<string, number[]>();
  questions.forEach((q, i) => {
    const key = `${q.question}|${q.choices.join('|')}|${q.category}|${q.difficulty}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key)!.push(i);
  });
  const duplicates: Array<{ indices: number[]; question: string }> = [];
  seen.forEach((indices, key) => {
    if (indices.length > 1) {
      duplicates.push({ indices, question: questions[indices[0]].question });
    }
  });
  return duplicates;
}

function checkHashDuplicates(questions: PreparedQuestion[]): Array<{ hash: string; indices: number[] }> {
  const seen = new Map<string, number[]>();
  questions.forEach((q, i) => {
    if (!seen.has(q.hash)) seen.set(q.hash, []);
    seen.get(q.hash)!.push(i);
  });
  const duplicates: Array<{ hash: string; indices: number[] }> = [];
  seen.forEach((indices, hash) => {
    if (indices.length > 1) {
      duplicates.push({ hash, indices });
    }
  });
  return duplicates;
}

function checkLegacyCollisions(questions: PreparedQuestion[], legacyHashes: Set<string>): number {
  let collisions = 0;
  questions.forEach(q => {
    if (legacyHashes.has(q.hash)) collisions++;
  });
  return collisions;
}

function main(): void {
  console.log('=== Trivia Pilot Validation ===\n');

  if (!fs.existsSync(PREPARED_PATH)) {
    console.log('ERROR: Prepared questions not found. Run generate-pilot.ts first.');
    process.exit(1);
  }

  let questions: PreparedQuestion[];
  try {
    questions = JSON.parse(fs.readFileSync(PREPARED_PATH, 'utf-8'));
  } catch (e) {
    console.error('ERROR: Failed to parse prepared questions:', e);
    process.exit(1);
  }

  console.log(`Validating ${questions.length} questions...\n`);

  const stats = {
    total: questions.length,
    categories: {} as Record<string, number>,
    difficulties: {} as Record<string, number>,
    correctIdx: {} as Record<number, number>,
    exactDuplicates: 0,
    hashDuplicates: 0,
    legacyCollisions: 0,
  };

  questions.forEach(q => {
    stats.categories[q.category] = (stats.categories[q.category] || 0) + 1;
    stats.difficulties[q.difficulty] = (stats.difficulties[q.difficulty] || 0) + 1;
    stats.correctIdx[q.correct_idx] = (stats.correctIdx[q.correct_idx] || 0) + 1;
  });

  const exactDups = checkExactDuplicates(questions);
  stats.exactDuplicates = exactDups.length;

  const hashDups = checkHashDuplicates(questions);
  stats.hashDuplicates = hashDups.length;

  const legacyQuestions = readLegacyQuestions();
  const legacyHashes = computeLegacyHashes(legacyQuestions);
  stats.legacyCollisions = checkLegacyCollisions(questions, legacyHashes);

  console.log('--- Distribution ---');
  console.log(`Total: ${stats.total}`);
  console.log('Categories:', stats.categories);
  console.log('Difficulties:', stats.difficulties);
  console.log('Correct idx:', stats.correctIdx);
  console.log(`\nExact duplicates: ${stats.exactDuplicates}`);
  console.log(`Hash duplicates (intra-pilot): ${stats.hashDuplicates}`);
  console.log(`Legacy collisions: ${stats.legacyCollisions}`);

  // Template Repetition Detection
  console.log('\n--- Template Repetition Analysis ---');
  const templateResult = analyzeTemplateRepetition(questions);
  console.log(`Status: ${templateResult.status}`);
  console.log(`Total signatures: ${new Set(questions.map(q => {
    const tokens = q.normalized.question.split(/\s+/).filter(t => t.length > 0);
    return tokens.slice(0, 3).join('|');
  })).size}`);
  console.log(`Flagged templates (>3 uses): ${templateResult.signatures.length}`);
  console.log(`Questions in flagged templates: ${templateResult.flaggedCount}`);

  if (templateResult.signatures.length > 0) {
    templateResult.signatures.forEach((sig, idx) => {
      console.log(`\n  Flag ${idx + 1}: ${sig.count} uses`);
      console.log(`    Signature: ${sig.signature}`);
      console.log(`    Indices: ${sig.indices.join(', ')}`);
      sig.questions.forEach((q, qi) => {
        console.log(`    [${sig.indices[qi]}] "${q.substring(0, 80)}..."`);
      });
    });
  } else {
    console.log('No template repetition warnings (all templates used ≤ 3 times).');
  }

  // Arabic Quality Heuristics
  console.log('\n--- Arabic Quality Heuristic Analysis ---');
  const arabicQualityResult = analyzeArabicQuality(questions);
  console.log(`Total warnings: ${arabicQualityResult.warnings.length}`);
  console.log(`Questions with warnings: ${arabicQualityResult.questionsWithWarnings}/${arabicQualityResult.totalQuestions}`);

  if (arabicQualityResult.warnings.length > 0) {
    const byRule = new Map<string, typeof arabicQualityResult.warnings[0][]>();
    arabicQualityResult.warnings.forEach(w => {
      if (!byRule.has(w.rule)) byRule.set(w.rule, []);
      byRule.get(w.rule)!.push(w);
    });
    byRule.forEach((warnings, rule) => {
      console.log(`  ${rule}: ${warnings.length} warning(s)`);
      warnings.slice(0, 5).forEach(w => {
        console.log(`    Q${w.questionIndex} [${w.field}]: ${w.message}`);
      });
      if (warnings.length > 5) {
        console.log(`    ... and ${warnings.length - 5} more`);
      }
    });
  } else {
    console.log('No Arabic quality warnings detected.');
  }

  console.log('\nREMINDER: Arabic quality checks are HEURISTIC ONLY. Human review required.');

  const errors = validateDistribution(stats);
  const warnings: string[] = [];

  if (exactDups.length > 0) {
    console.log('\n--- Exact Duplicates ---');
    exactDups.forEach(d => {
      console.log(`  Indices: ${d.indices.join(', ')} | "${d.question.substring(0, 60)}..."`);
    });
  }

  if (hashDups.length > 0) {
    console.log('\n--- Hash Duplicates ---');
    hashDups.forEach(d => {
      console.log(`  Hash: ${d.hash.substring(0, 16)}... | Indices: ${d.indices.join(', ')}`);
    });
  }

  if (stats.legacyCollisions > 0) {
    console.log('\n--- Legacy Collisions ---');
    questions.forEach((q, i) => {
      if (legacyHashes.has(q.hash)) {
        console.log(`  Index ${i}: "${q.question.substring(0, 60)}..."`);
      }
    });
  }

  // Add template repetition warnings to warnings array (non-blocking)
  if (templateResult.status === 'WARNING') {
    templateResult.signatures.forEach(sig => {
      warnings.push(`Template repetition: "${sig.signature}" used ${sig.count} times (indices: ${sig.indices.join(', ')})`);
    });
  }

  // Add Arabic quality warnings to warnings array (non-blocking)
  arabicQualityResult.warnings.forEach(w => {
    warnings.push(`Arabic quality [${w.rule}]: Q${w.questionIndex} [${w.field}] - ${w.message}`);
  });

  console.log('\n=== VALIDATION RESULT ===');
  if (errors.length === 0) {
    console.log('PASSED: All blocking gates satisfied.');
  } else {
    console.log('FAILED: Blocking gates not satisfied:');
    errors.forEach(e => console.log('  - ' + e));
  }

  if (warnings.length > 0) {
    console.log(`\nWARNINGS (${warnings.length}):`);
    warnings.slice(0, 20).forEach(w => console.log('  - ' + w));
    if (warnings.length > 20) {
      console.log(`  ... and ${warnings.length - 20} more warnings`);
    }
  }

  const result: ValidationResult = {
    passed: errors.length === 0,
    errors,
    warnings,
    stats,
    templateRepetition: templateResult,
    arabicQuality: arabicQualityResult,
  };

  const reportPath = path.resolve('scripts/trivia-pilot/output/validation-result.json');
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`\nValidation result written to: ${reportPath}`);

  // Write detailed template repetition report
  fs.writeFileSync(TEMPLATE_REPORT_PATH, JSON.stringify(templateResult, null, 2), 'utf-8');
  console.log(`Template repetition report written to: ${TEMPLATE_REPORT_PATH}`);

  // Write detailed Arabic quality report
  fs.writeFileSync(ARABIC_QUALITY_REPORT_PATH, JSON.stringify(arabicQualityResult, null, 2), 'utf-8');
  console.log(`Arabic quality report written to: ${ARABIC_QUALITY_REPORT_PATH}`);

  if (!result.passed) {
    process.exit(1);
  }
}

main();