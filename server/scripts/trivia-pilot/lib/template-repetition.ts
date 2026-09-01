import { normalizeForHash } from './trivia-hash';

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

export interface TemplateSignature {
  signature: string;
  count: number;
  indices: number[];
  questions: string[];
}

export interface TemplateRepetitionResult {
  status: 'PASS' | 'WARNING';
  signatures: TemplateSignature[];
  flaggedCount: number;
  totalQuestions: number;
}

/**
 * Common Arabic interrogative/template words that should be discounted
 * when computing structural signatures.
 * Includes interrogatives, pronouns, particles, and common function words.
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

/**
 * Normalize Arabic text for template analysis.
 * - Unicode NFC normalization
 * - Trim whitespace
 * - Collapse repeated whitespace
 */
export function normalizeForTemplate(text: string): string {
  return normalizeForHash(text);
}

/**
 * Tokenize Arabic text into meaningful tokens.
 * Splits on whitespace and punctuation, preserves Arabic words.
 */
export function tokenizeArabic(text: string): string[] {
  return text
    .replace(/[،؛؟!.:؛،()\[\]{}"']/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0);
}

/**
 * Remove common template words from token list.
 * This helps identify the core structural pattern.
 */
export function filterTemplateWords(tokens: string[]): string[] {
  return tokens.filter(t => !ARABIC_TEMPLATE_WORDS.has(t));
}

/**
 * Extract the interrogative pattern from a question.
 * Returns the first non-template word that indicates the question type.
 */
function extractInterrogativePattern(tokens: string[]): string {
  for (const token of tokens) {
    if (!ARABIC_TEMPLATE_WORDS.has(token)) {
      return token;
    }
  }
  return 'UNKNOWN';
}

/**
 * Build a structural signature for a question.
 * The signature captures:
 * 1. Interrogative pattern (first meaningful content word indicating question type)
 * 2. Token count bucket (short/medium/long)
 * 3. Question punctuation structure
 * 4. Choice structure pattern
 * 
 * Category and difficulty are intentionally EXCLUDED to detect cross-category template reuse.
 */
export function buildTemplateSignature(q: PreparedQuestion): string {
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

/**
 * Analyze template repetition across a set of questions.
 * Groups questions by structural signature and flags templates used > 3 times.
 */
export function analyzeTemplateRepetition(questions: PreparedQuestion[]): TemplateRepetitionResult {
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
    if (count > 3) {
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
  
  return {
    status: flaggedCount > 0 ? 'WARNING' : 'PASS',
    signatures,
    flaggedCount,
    totalQuestions: questions.length,
  };
}

/**
 * Generate a human-readable description of a template signature.
 */
export function describeSignature(signature: string): string {
  const parts = signature.split('|');
  if (parts.length < 4) return signature;
  
  const [interrogativePattern, lengthBucket, punctuation, choicePattern] = parts;
  
  const lengthLabels: Record<string, string> = {
    'S': 'Short (≤5 tokens)',
    'M': 'Medium (6-10 tokens)',
    'L': 'Long (11-20 tokens)',
    'XL': 'Very Long (>20 tokens)',
  };
  
  return `Interrogative: "${interrogativePattern}", Length: ${lengthLabels[lengthBucket] || lengthBucket}, Punctuation: "${punctuation}", Choices: ${choicePattern}`;
}