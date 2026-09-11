import { ValidationIssue, ValidatedQuestion } from './types';
import { normalizeForHash } from '../QuestionPoolService';

/**
 * Common Arabic interrogative/template words that should be discounted
 * when computing structural signatures.
 */
const ARABIC_TEMPLATE_WORDS = new Set([
  // Interrogatives
  'ما', 'من', 'متى', 'أين', 'كيف', 'كم', 'هل', 'الذي', 'التي', 'الذين', 'اللواتي',
  'أي', 'أين', 'أينما', 'كيفما', 'مهما', 'متى', 'أيان', 'هل', 'أ', 'آ',
  // Pronouns and demonstratives
  'هو', 'هي', 'هما', 'هم', 'هن', 'أنت', 'أنتما', 'أنتم', 'أنتن', 'أنا', 'نحن',
  'هذا', 'هذه', 'هذان', 'هذين', 'أولئك', 'ذلك', 'تلك', 'ذي', 'تي',
  // Common particles and prepositions
  'في', 'على', 'إلى', 'من', 'عن', 'مع', 'ب', 'ك', 'ل', 'ال', 'و', 'ف', 'ثم',
  'حتى', 'منذ', 'منذُ', 'مذ', 'منذما', 'حيث', 'حيثما', 'كي', 'لكي', 'أن', 'إن',
  'أنّ', 'لكن', 'غير', 'سوى', 'عدا', 'خلا', 'حاشا', 'كأن', 'ليت', 'لعل', 'عسى',
  // Common verbs that appear in templates
  'كان', 'كانت', 'كانا', 'كانوا', 'كن', 'يكون', 'تكون', 'يكونوا', 'تكونوا',
  'صار', 'أصبح', 'أضحى', 'ليس', 'ما', 'لا', 'لم', 'لن', 'إن', 'أن',
]);

export interface TemplateSignature {
  signature: string;
  count: number;
  indices: number[];
  questions: string[];
}

export interface TemplateRepetitionResult {
  status: 'PASS' | 'WARNING' | 'ERROR';
  signatures: TemplateSignature[];
  flaggedCount: number;
  totalQuestions: number;
}

function normalizeForTemplate(text: string): string {
  return normalizeForHash(text);
}

function tokenizeArabic(text: string): string[] {
  return text
    .replace(/[،؛؟!.:؛،()\[\]{}"']/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0);
}

function filterTemplateWords(tokens: string[]): string[] {
  return tokens.filter(t => !ARABIC_TEMPLATE_WORDS.has(t));
}

function extractInterrogativePattern(tokens: string[]): string {
  for (const token of tokens) {
    if (!ARABIC_TEMPLATE_WORDS.has(token)) {
      return token;
    }
  }
  return 'UNKNOWN';
}

function buildTemplateSignature(q: ValidatedQuestion): string {
  const normQuestion = q.normalized.question;
  const tokens = tokenizeArabic(normQuestion);
  const filteredTokens = filterTemplateWords(tokens);

  // Interrogative pattern: first meaningful content token after filtering
  const interrogativePattern = extractInterrogativePattern(tokens);

  // Token count bucket (based on filtered tokens)
  let lengthBucket: string;
  if (filteredTokens.length <= 5) lengthBucket = 'S';
  else if (filteredTokens.length <= 10) lengthBucket = 'M';
  else if (filteredTokens.length <= 20) lengthBucket = 'L';
  else lengthBucket = 'XL';

  // Punctuation structure
  const punctuation = normQuestion
    .replace(/[^؟?!.,،؛:]/g, '')
    .substring(0, 10);

  // Choice structure: length pattern of choices
  const choiceLengths = q.normalized.choices.map(c => c.length);
  const choicePattern = choiceLengths.map(len => {
    if (len <= 5) return 'XS';
    if (len <= 15) return 'S';
    if (len <= 30) return 'M';
    if (len <= 50) return 'L';
    return 'XL';
  }).join('-');

  // Signature WITHOUT category/difficulty to detect cross-category templates
  return `${interrogativePattern}|${lengthBucket}|${punctuation}|${choicePattern}`;
}

export function analyzeTemplateRepetition(
  questions: ValidatedQuestion[],
  options: { maxAllowedPerTemplate?: number } = {}
): TemplateRepetitionResult {
  const { maxAllowedPerTemplate = 3 } = options;
  const signatureMap = new Map<string, { indices: number[]; questions: string[] }>();

  questions.forEach((q, index) => {
    const signature = buildTemplateSignature(q);
    if (!signatureMap.has(signature)) {
      signatureMap.set(signature, { indices: [], questions: [] });
    }
    const entry = signatureMap.get(signature)!;
    entry.indices.push(index);
    entry.questions.push(q.question);
  });

  const signatures: TemplateSignature[] = [];
  let flaggedCount = 0;

  signatureMap.forEach((entry, signature) => {
    const count = entry.indices.length;
    if (count > maxAllowedPerTemplate) {
      flaggedCount += count;
      signatures.push({
        signature,
        count,
        indices: entry.indices,
        questions: entry.questions,
      });
    }
  });

  // Sort by count descending
  signatures.sort((a, b) => b.count - a.count);

  // Status: ERROR if any template exceeds maxAllowedPerTemplate (blocking for batch)
  const status = flaggedCount > 0 ? 'ERROR' : 'PASS';

  return {
    status,
    signatures,
    flaggedCount,
    totalQuestions: questions.length,
  };
}

export function checkTemplateRepetition(
  questions: ValidatedQuestion[],
  options: { maxAllowedPerTemplate?: number } = {}
): { issues: ValidationIssue[]; result: TemplateRepetitionResult } {
  const result = analyzeTemplateRepetition(questions, options);
  const issues: ValidationIssue[] = [];

  if (result.status === 'ERROR') {
    result.signatures.forEach(sig => {
      sig.indices.forEach(idx => {
        issues.push({
          code: 'TEMPLATE_REPETITION',
          severity: 'ERROR',
          message: `Template "${sig.signature}" used ${sig.count} times (max allowed: ${options.maxAllowedPerTemplate ?? 3})`,
          questionIndex: idx,
          field: 'template',
        });
      });
    });
  }

  return { issues, result };
}