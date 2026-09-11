import { ValidationIssue, ValidatedQuestion } from './types';
import { normalizeForHash } from '../QuestionPoolService';

export interface CorrectAnswerBindingResult {
  issues: ValidationIssue[];
  checked: number;
  passed: number;
  failed: number;
  failures: Array<{
    index: number;
    correctAnswer: string;
    correctIdx: number;
    actualChoice: string;
    normalizedCorrectAnswer: string;
    normalizedActualChoice: string;
  }>;
}

export function validateCorrectAnswerBinding(
  questions: ValidatedQuestion[]
): CorrectAnswerBindingResult {
  const issues: ValidationIssue[] = [];
  const failures: CorrectAnswerBindingResult['failures'] = [];
  let passed = 0;
  let failed = 0;

  questions.forEach((q, index) => {
    // Normalize both for comparison
    const normalizedCorrectAnswer = normalizeForHash(q.correct_answer);
    const normalizedChoices = q.choices.map(normalizeForHash);
    const normalizedActualChoice = normalizedChoices[q.correct_idx] ?? '';

    const matches = normalizedCorrectAnswer === normalizedActualChoice;

    if (matches) {
      passed++;
    } else {
      failed++;
      failures.push({
        index,
        correctAnswer: q.correct_answer,
        correctIdx: q.correct_idx,
        actualChoice: q.choices[q.correct_idx] ?? '',
        normalizedCorrectAnswer,
        normalizedActualChoice,
      });

      issues.push({
        code: 'CORRECT_ANSWER_IDX_MISMATCH',
        severity: 'ERROR',
        message: `correct_answer "${q.correct_answer}" does not match choices[${q.correct_idx}] "${q.choices[q.correct_idx]}"`,
        questionIndex: index,
        field: 'correct_idx',
        value: `correct_answer: "${q.correct_answer}", choices[${q.correct_idx}]: "${q.choices[q.correct_idx]}"`,
      });
    }
  });

  return {
    issues,
    checked: questions.length,
    passed,
    failed,
    failures,
  };
}