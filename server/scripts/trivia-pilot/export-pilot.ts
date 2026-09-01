import fs from 'fs';
import path from 'path';

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
const VALIDATION_PATH = path.resolve('scripts/trivia-pilot/output/validation-result.json');
const OUTPUT_PATH = path.resolve('scripts/trivia-pilot/output/questions-output.json');

interface ExportRecord {
  question: string;
  choices: string[];
  correct_idx: number;
  category: string;
  difficulty: string;
  language: string;
  tags: string[];
  source: string | null;
  verified: number;
  hash: string;
}

function main(): void {
  console.log('=== Trivia Pilot Export ===\n');

  if (!fs.existsSync(PREPARED_PATH)) {
    console.log('ERROR: Prepared questions not found. Run generate-pilot.ts first.');
    process.exit(1);
  }

  if (!fs.existsSync(VALIDATION_PATH)) {
    console.log('ERROR: Validation result not found. Run validate-pilot.ts first.');
    process.exit(1);
  }

  const validation = JSON.parse(fs.readFileSync(VALIDATION_PATH, 'utf-8'));
  if (!validation.passed) {
    console.log('ERROR: Validation gates not passed. Cannot export.');
    console.log('Run validate-pilot.ts to see failing gates.');
    process.exit(1);
  }

  let questions: PreparedQuestion[];
  try {
    questions = JSON.parse(fs.readFileSync(PREPARED_PATH, 'utf-8'));
  } catch (e) {
    console.error('ERROR: Failed to parse prepared questions:', e);
    process.exit(1);
  }

  console.log(`Exporting ${questions.length} validated questions...\n`);

  const exportRecords: ExportRecord[] = questions.map(q => ({
    question: q.question,
    choices: q.choices,
    correct_idx: q.correct_idx,
    category: q.category,
    difficulty: q.difficulty,
    language: q.language,
    tags: q.tags ?? [],
    source: q.source ?? null,
    verified: q.verified ? 1 : 0,
    hash: q.hash,
  }));

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(exportRecords, null, 2), 'utf-8');
  console.log(`Export written to: ${OUTPUT_PATH}`);
  console.log('\nNOTE: This file is compatible with TriviaImportService.');
  console.log('Use correct_idx (0-3), NOT correctAnswer ("1"-"4").');
  console.log('Import manually via admin API or database migration when ready.');
}

main();