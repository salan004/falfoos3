import { ValidationIssue, QuestionValidationResult, ValidatedQuestion, BatchValidationInput } from './types';
import { computeQuestionHash, normalizeForHash } from '../QuestionPoolService';

const VALID_DIFFICULTIES = ['سهل', 'متوسط', 'صعب'] as const;
const VALID_LANGUAGES = ['ar'] as const;
const DEFAULT_ALLOWED_CATEGORIES = ['تاريخ', 'جغرافيا', 'علوم', 'فنون وآداب', 'رياضة', 'تقنية وفضاء', 'ألعاب فيديو', 'ثقافة عامة', 'ألعاب'];

export function validateSchema(
  questions: BatchValidationInput['questions'],
  options: { allowedCategories?: string[]; allowedDifficulties?: string[] } = {}
): { results: QuestionValidationResult[]; validated: ValidatedQuestion[] } {
  const allowedCategories = options.allowedCategories ?? DEFAULT_ALLOWED_CATEGORIES;
  const allowedDifficulties = options.allowedDifficulties ?? VALID_DIFFICULTIES;

  const results: QuestionValidationResult[] = [];
  const validated: ValidatedQuestion[] = [];

  questions.forEach((q, index) => {
    const issues: ValidationIssue[] = [];

    // Question text
    if (!q.question || !q.question.trim()) {
      issues.push({ code: 'MISSING_QUESTION', severity: 'ERROR', message: 'Question text is required', questionIndex: index, field: 'question' });
    } else if (q.question.length < 10 || q.question.length > 200) {
      issues.push({ code: 'QUESTION_LENGTH', severity: 'ERROR', message: `Question length must be 10-200 characters (got ${q.question.length})`, questionIndex: index, field: 'question' });
    }

    // Choices
    if (!Array.isArray(q.choices) || q.choices.length !== 4) {
      issues.push({ code: 'INVALID_CHOICES_COUNT', severity: 'ERROR', message: 'Exactly 4 choices are required', questionIndex: index, field: 'choices' });
    } else {
      q.choices.forEach((choice, ci) => {
        if (!choice || !choice.trim()) {
          issues.push({ code: 'EMPTY_CHOICE', severity: 'ERROR', message: `Choice ${ci + 1} is required`, questionIndex: index, field: `choices[${ci}]` });
        } else if (choice.length > 80) {
          issues.push({ code: 'CHOICE_TOO_LONG', severity: 'ERROR', message: `Choice ${ci + 1} exceeds 80 characters`, questionIndex: index, field: `choices[${ci}]` });
        }
      });

      // Check for distinct choices (after normalization)
      const normalizedChoices = q.choices.map(normalizeForHash);
      const uniqueChoices = new Set(normalizedChoices);
      if (uniqueChoices.size !== 4) {
        issues.push({ code: 'DUPLICATE_CHOICES', severity: 'ERROR', message: 'All 4 choices must be distinct after normalization', questionIndex: index, field: 'choices' });
      }
    }

    // correct_idx
    if (!Number.isInteger(q.correct_idx) || q.correct_idx < 0 || q.correct_idx > 3) {
      issues.push({ code: 'INVALID_CORRECT_IDX', severity: 'ERROR', message: 'correct_idx must be an integer between 0 and 3', questionIndex: index, field: 'correct_idx' });
    }

    // correct_answer
    if (!q.correct_answer || !q.correct_answer.trim()) {
      issues.push({ code: 'MISSING_CORRECT_ANSWER', severity: 'ERROR', message: 'correct_answer is required', questionIndex: index, field: 'correct_answer' });
    }

    // Category
    if (!q.category || !q.category.trim()) {
      issues.push({ code: 'MISSING_CATEGORY', severity: 'ERROR', message: 'Category is required', questionIndex: index, field: 'category' });
    } else if (!allowedCategories.includes(q.category)) {
      issues.push({ code: 'INVALID_CATEGORY', severity: 'ERROR', message: `Category must be one of: ${allowedCategories.join(', ')} (got '${q.category}')`, questionIndex: index, field: 'category' });
    }

    // Difficulty
    if (!q.difficulty || !q.difficulty.trim()) {
      issues.push({ code: 'MISSING_DIFFICULTY', severity: 'ERROR', message: 'Difficulty is required', questionIndex: index, field: 'difficulty' });
    } else if (!allowedDifficulties.includes(q.difficulty as typeof VALID_DIFFICULTIES[number])) {
      issues.push({ code: 'INVALID_DIFFICULTY', severity: 'ERROR', message: `Difficulty must be one of: ${allowedDifficulties.join(', ')} (got '${q.difficulty}')`, questionIndex: index, field: 'difficulty' });
    }

    // Language
    const language = q.language ?? 'ar';
    if (!VALID_LANGUAGES.includes(language as typeof VALID_LANGUAGES[number])) {
      issues.push({ code: 'INVALID_LANGUAGE', severity: 'ERROR', message: `Language must be one of: ${VALID_LANGUAGES.join(', ')} (got '${language}')`, questionIndex: index, field: 'language' });
    }

    // Compute hash
    const hash = computeQuestionHash(q.question, q.choices, q.category, q.difficulty);

    // Build normalized version
    const normalized = {
      question: normalizeForHash(q.question),
      choices: q.choices.map(normalizeForHash),
      category: normalizeForHash(q.category),
      difficulty: normalizeForHash(q.difficulty),
    };

    const valid = issues.filter(i => i.severity === 'ERROR').length === 0;

    results.push({
      valid,
      issues,
      hash: valid ? hash : undefined,
    });

    if (valid) {
      validated.push({
        question: q.question,
        choices: q.choices,
        correct_idx: q.correct_idx,
        correct_answer: q.correct_answer,
        category: q.category,
        difficulty: q.difficulty,
        language,
        tags: q.tags ?? [],
        source: q.source,
        verified: q.verified ?? false,
        hash,
        normalized,
      });
    }
  });

  return { results, validated };
}