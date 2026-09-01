import fs from 'fs';
import path from 'path';
import { computeQuestionHash } from './lib/trivia-hash';

interface SourceQuestion {
  question: string;
  choices: string[];
  correct_idx: number;
  category: string;
  difficulty: string;
  language: string;
  tags?: string[];
  source?: string;
  verified?: boolean;
}

interface PreparedQuestion extends SourceQuestion {
  hash: string;
  normalized: {
    question: string;
    choices: string[];
    category: string;
    difficulty: string;
  };
}

const SOURCE_PATH = path.resolve('scripts/trivia-pilot/questions/questions-source.json');
const OUTPUT_PATH = path.resolve('scripts/trivia-pilot/output/prepared-questions.json');

const VALID_CATEGORIES = ['تاريخ', 'جغرافيا', 'علوم', 'ثقافة عامة', 'ألعاب فيديو'] as const;
const VALID_DIFFICULTIES = ['سهل', 'متوسط', 'صعب'] as const;
const VALID_LANGUAGE = 'ar';

function normalizeForHash(text: string): string {
  return text.trim().replace(/\s+/g, ' ').normalize('NFC');
}

function validateQuestion(q: any, index: number): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (typeof q.question !== 'string' || !q.question.trim()) {
    errors.push(`Question ${index}: 'question' is required and must be a non-empty string`);
  } else if (q.question.length < 10 || q.question.length > 200) {
    errors.push(`Question ${index}: 'question' length must be 10-200 characters (got ${q.question.length})`);
  }

  if (!Array.isArray(q.choices) || q.choices.length !== 4) {
    errors.push(`Question ${index}: 'choices' must be an array of exactly 4 strings`);
  } else {
    q.choices.forEach((c: any, ci: number) => {
      if (typeof c !== 'string' || !c.trim()) {
        errors.push(`Question ${index}: choice ${ci + 1} is required and must be a non-empty string`);
      } else if (c.length > 80) {
        errors.push(`Question ${index}: choice ${ci + 1} exceeds 80 characters`);
      }
    });
    const uniqueChoices = new Set(q.choices.map((c: string) => c.trim()));
    if (uniqueChoices.size !== 4) {
      errors.push(`Question ${index}: all 4 choices must be distinct`);
    }
  }

  if (!Number.isInteger(q.correct_idx) || q.correct_idx < 0 || q.correct_idx > 3) {
    errors.push(`Question ${index}: 'correct_idx' must be an integer 0-3`);
  }

  if (!VALID_CATEGORIES.includes(q.category)) {
    errors.push(`Question ${index}: 'category' must be one of: ${VALID_CATEGORIES.join(', ')} (got '${q.category}')`);
  }

  if (!VALID_DIFFICULTIES.includes(q.difficulty)) {
    errors.push(`Question ${index}: 'difficulty' must be one of: ${VALID_DIFFICULTIES.join(', ')} (got '${q.difficulty}')`);
  }

  if (q.language !== VALID_LANGUAGE) {
    errors.push(`Question ${index}: 'language' must be 'ar' (got '${q.language}')`);
  }

  return { valid: errors.length === 0, errors };
}

function main(): void {
  console.log('=== Trivia Pilot Generate/Normalize ===\n');
  console.log(`Source: ${SOURCE_PATH}\n`);

  if (!fs.existsSync(SOURCE_PATH)) {
    console.log('DATASET NOT PROVIDED');
    console.log(`\nExpected dataset at: ${SOURCE_PATH}`);
    console.log('Place the real 100-question pilot dataset there.');
    process.exit(0);
  }

  let sourceData: SourceQuestion[];
  try {
    const raw = fs.readFileSync(SOURCE_PATH, 'utf-8');
    sourceData = JSON.parse(raw);
  } catch (e) {
    console.error('ERROR: Failed to parse source JSON:', e);
    process.exit(1);
  }

  if (!Array.isArray(sourceData)) {
    console.error('ERROR: Source data must be a JSON array');
    process.exit(1);
  }

  console.log(`Loaded ${sourceData.length} questions from source.\n`);

  if (sourceData.length < 100) {
    console.log(`WARNING: Only ${sourceData.length} questions found (minimum 100 required for pilot).`);
    console.log('DATASET NOT PROVIDED');
    process.exit(0);
  }

  const prepared: PreparedQuestion[] = [];
  const allErrors: string[] = [];

  for (let i = 0; i < sourceData.length; i++) {
    const q = sourceData[i];
    const validation = validateQuestion(q, i + 1);

    if (!validation.valid) {
      allErrors.push(...validation.errors);
      continue;
    }

    const normalized = {
      question: normalizeForHash(q.question),
      choices: q.choices.map(normalizeForHash),
      category: normalizeForHash(q.category),
      difficulty: normalizeForHash(q.difficulty),
    };

    const hash = computeQuestionHash(
      q.question,
      q.choices,
      q.category,
      q.difficulty
    );

    prepared.push({
      ...q,
      hash,
      normalized,
    });
  }

  if (allErrors.length > 0) {
    console.log('\nVALIDATION ERRORS:');
    allErrors.forEach(e => console.log('  - ' + e));
    console.log('\nFix errors in source file before proceeding.');
    process.exit(1);
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(prepared, null, 2), 'utf-8');
  console.log(`\nPrepared ${prepared.length} questions written to: ${OUTPUT_PATH}`);
  console.log('Next step: run validate-pilot.ts');
}

main();