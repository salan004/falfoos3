import fs from 'fs';
import path from 'path';
import { computeQuestionHash } from './lib/trivia-hash';

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

function tokenizeArabic(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[،؛؟!.:؛،]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function getNGrams(tokens: string[], n: number): Set<string> {
  const grams = new Set<string>();
  for (let i = 0; i <= tokens.length - n; i++) {
    grams.add(tokens.slice(i, i + n).join(' '));
  }
  return grams;
}

function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

function computeQuestionSignature(q: PreparedQuestion): {
  questionTokens: string[];
  questionBigrams: Set<string>;
  choiceBigrams: Set<string>;
  structure: string;
} {
  const qTokens = tokenizeArabic(q.normalized.question);
  const qBigrams = getNGrams(qTokens, 2);
  
  const allChoiceTokens = q.normalized.choices.flatMap(tokenizeArabic);
  const choiceBigrams = getNGrams(allChoiceTokens, 2);

  const structure = q.normalized.choices.map((_, i) => `C${i}`).join('-');

  return {
    questionTokens: qTokens,
    questionBigrams: qBigrams,
    choiceBigrams: choiceBigrams,
    structure,
  };
}

function main(): void {
  console.log('=== Semantic Duplicate Check (FALLBACK MODE) ===\n');
  console.log('SEMANTIC CHECK MODE: FALLBACK');
  console.log('MANUAL REVIEW REQUIRED\n');

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

  console.log(`Analyzing ${questions.length} questions for semantic similarity...\n`);

  const signatures = questions.map(computeQuestionSignature);
  const flags: Array<{
    indexA: number;
    indexB: number;
    questionA: string;
    questionB: string;
    questionSim: number;
    choiceSim: number;
    structureMatch: boolean;
  }> = [];

  const QUESTION_SIM_THRESHOLD = 0.65;
  const CHOICE_SIM_THRESHOLD = 0.55;

  for (let i = 0; i < questions.length; i++) {
    for (let j = i + 1; j < questions.length; j++) {
      const qSim = jaccardSimilarity(signatures[i].questionBigrams, signatures[j].questionBigrams);
      const cSim = jaccardSimilarity(signatures[i].choiceBigrams, signatures[j].choiceBigrams);
      const structMatch = signatures[i].structure === signatures[j].structure;

      if (qSim >= QUESTION_SIM_THRESHOLD || (cSim >= CHOICE_SIM_THRESHOLD && structMatch)) {
        flags.push({
          indexA: i,
          indexB: j,
          questionA: questions[i].question.substring(0, 80),
          questionB: questions[j].question.substring(0, 80),
          questionSim: Math.round(qSim * 100) / 100,
          choiceSim: Math.round(cSim * 100) / 100,
          structureMatch: structMatch,
        });
      }
    }
  }

  console.log(`Found ${flags.length} potentially similar pairs (thresholds: question≥${QUESTION_SIM_THRESHOLD}, choice≥${CHOICE_SIM_THRESHOLD}):\n`);

  flags.forEach((f, idx) => {
    console.log(`Flag ${idx + 1}:`);
    console.log(`  [${f.indexA}] "${f.questionA}..."`);
    console.log(`  [${f.indexB}] "${f.questionB}..."`);
    console.log(`  Question similarity: ${f.questionSim}`);
    console.log(`  Choice similarity: ${f.choiceSim}`);
    console.log(`  Structure match: ${f.structureMatch}`);
    console.log('');
  });

  if (flags.length === 0) {
    console.log('No semantic similarity flags detected.\n');
  }

  console.log('REMINDER: This is a LIGHTWEIGHT FALLBACK using n-gram overlap.');
  console.log('It is NOT equivalent to embedding-based semantic similarity.');
  console.log('ALL FLAGS REQUIRE MANUAL REVIEW.\n');

  const result = {
    mode: 'FALLBACK',
    thresholds: {
      questionBigrams: QUESTION_SIM_THRESHOLD,
      choiceBigrams: CHOICE_SIM_THRESHOLD,
    },
    totalQuestions: questions.length,
    flagsCount: flags.length,
    flags,
    disclaimer: 'SEMANTIC CHECK MODE: FALLBACK - MANUAL REVIEW REQUIRED',
  };

  const reportPath = path.resolve('scripts/trivia-pilot/output/semantic-check-result.json');
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`Semantic check result written to: ${reportPath}`);
}

main();