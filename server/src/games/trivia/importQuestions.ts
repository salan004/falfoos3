import { importQuestions } from './QuestionPoolService';
import questionsData from '../../data/trivia-questions.json';

/**
 * Phase B3.1 — Import existing trivia questions from JSON to SQLite.
 * Idempotent: safe to run multiple times.
 */

interface JsonTriviaQuestion {
  category: string;
  question: string;
  choices: string[];
  correctAnswer: string;  // "1" | "2" | "3" | "4"
  difficulty: string;
}

function convertJsonToImport(q: JsonTriviaQuestion) {
  return {
    question: q.question,
    choices: q.choices,
    correct_idx: parseInt(q.correctAnswer, 10) - 1,  // Convert "1"-"4" to 0-3
    category: q.category,
    difficulty: q.difficulty,
    tags: [],
    source: 'legacy-json',
    verified: 0,
    language: 'ar',
  };
}

function main() {
  console.log('═══════════════════════════════════');
  console.log('  TRIVIA QUESTION IMPORT');
  console.log('═══════════════════════════════════\n');

  const jsonQuestions = questionsData as JsonTriviaQuestion[];
  console.log(`Found ${jsonQuestions.length} questions in JSON`);

  const toImport = jsonQuestions.map(convertJsonToImport);

  console.log('Importing questions...');
  const result = importQuestions(toImport);

  console.log('\n═══════════════════════════════════');
  console.log('  IMPORT RESULT');
  console.log('═══════════════════════════════════');
  console.log(`Imported: ${result.imported}`);
  console.log(`Skipped (duplicates): ${result.skipped}`);
  console.log(`Rejected: ${result.rejected}`);
  console.log(`Total processed: ${result.imported + result.skipped + result.rejected}`);
  console.log('═══════════════════════════════════\n');

  if (result.rejected > 0) {
    console.log('⚠️  Some questions were rejected. Check validation logic.');
    process.exit(1);
  }

  console.log('✅ Import completed successfully');
}

main();