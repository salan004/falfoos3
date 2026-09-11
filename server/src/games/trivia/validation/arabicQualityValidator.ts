import { ValidationIssue, ValidatedQuestion } from './types';
import { normalizeForHash } from '../QuestionPoolService';

export interface QualityWarning {
  severity: 'WARNING';
  rule: string;
  questionIndex: number;
  field: string;
  message: string;
  value: string;
}

export interface ArabicQualityResult {
  warnings: QualityWarning[];
  totalQuestions: number;
  questionsWithWarnings: number;
}

function checkNormalizationAnomalies(text: string, index: number, field: string): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  const normalized = text.normalize('NFC');
  if (text !== normalized) {
    warnings.push({
      severity: 'WARNING',
      rule: 'AR_NORMALIZATION_ANOMALY',
      questionIndex: index,
      field,
      message: 'Text changes under NFC normalization - may indicate mixed normalization forms',
      value: text,
    });
  }
  return warnings;
}

function checkLeadingWhitespace(text: string, index: number, field: string): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  if (text.length > 0 && text[0] !== text.trimStart()[0]) {
    warnings.push({
      severity: 'WARNING',
      rule: 'AR_LEADING_WHITESPACE',
      questionIndex: index,
      field,
      message: 'Text has leading whitespace',
      value: JSON.stringify(text),
    });
  }
  return warnings;
}

function checkTrailingWhitespace(text: string, index: number, field: string): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  if (text.length > 0 && text[text.length - 1] !== text.trimEnd()[text.trimEnd().length - 1]) {
    warnings.push({
      severity: 'WARNING',
      rule: 'AR_TRAILING_WHITESPACE',
      questionIndex: index,
      field,
      message: 'Text has trailing whitespace',
      value: JSON.stringify(text),
    });
  }
  return warnings;
}

function checkMultipleSpaces(text: string, index: number, field: string): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  if (/\s{2,}/.test(text)) {
    warnings.push({
      severity: 'WARNING',
      rule: 'AR_MULTIPLE_SPACES',
      questionIndex: index,
      field,
      message: 'Text contains multiple consecutive spaces',
      value: text,
    });
  }
  return warnings;
}

function checkSuspiciousPunctuation(text: string, index: number, field: string): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  if (/([؟?!.,،؛:])\1/.test(text)) {
    warnings.push({
      severity: 'WARNING',
      rule: 'AR_SUSPICIOUS_PUNCTUATION',
      questionIndex: index,
      field,
      message: 'Text contains repeated punctuation marks',
      value: text,
    });
  }
  return warnings;
}

function checkEnglishPunctuationInArabic(text: string, index: number, field: string): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  const hasArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
  if (hasArabic) {
    if (text.includes('?') && !text.includes('؟')) {
      warnings.push({
        severity: 'WARNING',
        rule: 'AR_ENGLISH_PUNCTUATION',
        questionIndex: index,
        field,
        message: 'Arabic text uses English question mark (?) instead of Arabic (؟)',
        value: text,
      });
    }
    if (text.includes(';') && !text.includes('؛')) {
      warnings.push({
        severity: 'WARNING',
        rule: 'AR_ENGLISH_PUNCTUATION',
        questionIndex: index,
        field,
        message: 'Arabic text uses English semicolon (;) instead of Arabic (؛)',
        value: text,
      });
    }
    if (text.includes(',') && !text.includes('،')) {
      warnings.push({
        severity: 'WARNING',
        rule: 'AR_ENGLISH_PUNCTUATION',
        questionIndex: index,
        field,
        message: 'Arabic text uses English comma (,) instead of Arabic (،)',
        value: text,
      });
    }
  }
  return warnings;
}

function checkMixedScript(text: string, index: number, field: string): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  const hasArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
  const hasLatin = /[A-Za-z]/.test(text);

  if (hasArabic && hasLatin) {
    const latinWords = text.match(/[A-Za-z]{2,}/g);
    if (latinWords && latinWords.length > 0) {
      const acceptable = new Set(['GTA', 'RPG', 'NES', 'SNES', 'CPU', 'GPU', 'RAM', 'SSD', 'HDD', 'USB', 'HDMI', 'AI', 'API', 'URL', 'HTML', 'CSS', 'JS', 'TS', 'SQL', 'FE', 'AU', 'AG', 'DNA', 'RNA', 'ATP', 'NASA', 'UN', 'EU', 'UK', 'USA', 'UAE']);
      const suspiciousWords = latinWords.filter(w => !acceptable.has(w.toUpperCase()));
      if (suspiciousWords.length > 0) {
        warnings.push({
          severity: 'WARNING',
          rule: 'AR_MIXED_SCRIPT',
          questionIndex: index,
          field,
          message: `Arabic text contains suspicious Latin words: ${suspiciousWords.join(', ')}`,
          value: text,
        });
      }
    }
  }
  return warnings;
}

function checkLatinDigits(text: string, index: number, field: string): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  const hasArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
  if (hasArabic) {
    const digitMatches = text.match(/\b\d+\b/g);
    if (digitMatches && digitMatches.length > 0) {
      warnings.push({
        severity: 'WARNING',
        rule: 'AR_LATIN_DIGITS',
        questionIndex: index,
        field,
        message: `Arabic text contains Latin digits: ${digitMatches.join(', ')} (consider Arabic-Indic digits)`,
        value: text,
      });
    }
  }
  return warnings;
}

function checkRepeatedWords(text: string, index: number, field: string): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  const tokens = text.split(/\s+/).filter(t => t.length > 1);
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] === tokens[i + 1]) {
      warnings.push({
        severity: 'WARNING',
        rule: 'AR_REPEATED_WORD',
        questionIndex: index,
        field,
        message: `Repeated word detected: "${tokens[i]}"`,
        value: text,
      });
      break;
    }
  }
  return warnings;
}

function checkInvisibleCharacters(text: string, index: number, field: string): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  const invisibleChars = text.match(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g);
  if (invisibleChars && invisibleChars.length > 0) {
    warnings.push({
      severity: 'WARNING',
      rule: 'AR_INVISIBLE_CHARACTER',
      questionIndex: index,
      field,
      message: `Text contains invisible Unicode characters: ${invisibleChars.map(c => `U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(', ')}`,
      value: JSON.stringify(text),
    });
  }
  return warnings;
}

function checkDuplicateChoices(choices: string[], index: number): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  const normalized = choices.map(normalizeForHash);
  const seen = new Map<string, number[]>();
  normalized.forEach((c, i) => {
    if (!seen.has(c)) seen.set(c, []);
    seen.get(c)!.push(i);
  });
  seen.forEach((indices, choice) => {
    if (indices.length > 1) {
      warnings.push({
        severity: 'WARNING',
        rule: 'AR_DUPLICATE_NORMALIZED_CHOICE',
        questionIndex: index,
        field: 'choices',
        message: `Duplicate choices after normalization at positions: ${indices.map(i => i + 1).join(', ')} - "${choice}"`,
        value: JSON.stringify(choices),
      });
    }
  });
  return warnings;
}

function checkChoiceLengthImbalance(choices: string[], index: number): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  const lengths = choices.map(c => c.trim().length);
  const minLen = Math.min(...lengths);
  const maxLen = Math.max(...lengths);
  const avgLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;

  if (minLen > 0 && maxLen > minLen * 3 && maxLen > avgLen * 2) {
    const maxIdx = lengths.indexOf(maxLen);
    const minIdx = lengths.indexOf(minLen);
    warnings.push({
      severity: 'WARNING',
      rule: 'AR_CHOICE_LENGTH_IMBALANCE',
      questionIndex: index,
      field: 'choices',
      message: `Extreme choice length imbalance: choice ${maxIdx + 1} (${maxLen} chars) vs choice ${minIdx + 1} (${minLen} chars). Could reveal correct answer.`,
      value: JSON.stringify(choices.map((c, i) => `${i + 1}: "${c}" (${c.length} chars)`)),
    });
  }
  return warnings;
}

function checkExcessivePunctuation(text: string, index: number, field: string): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  const punctuationCount = (text.match(/[؟?!.,،؛:]/g) || []).length;
  const charCount = text.length;
  if (punctuationCount > 3 && punctuationCount / charCount > 0.15) {
    warnings.push({
      severity: 'WARNING',
      rule: 'AR_EXCESSIVE_PUNCTUATION',
      questionIndex: index,
      field,
      message: `Excessive punctuation density: ${punctuationCount} marks in ${charCount} characters`,
      value: text,
    });
  }
  return warnings;
}

export function analyzeArabicQuality(questions: ValidatedQuestion[]): ArabicQualityResult {
  const allWarnings: QualityWarning[] = [];

  questions.forEach((q, index) => {
    const questionChecks = [
      checkNormalizationAnomalies,
      checkLeadingWhitespace,
      checkTrailingWhitespace,
      checkMultipleSpaces,
      checkSuspiciousPunctuation,
      checkEnglishPunctuationInArabic,
      checkMixedScript,
      checkLatinDigits,
      checkRepeatedWords,
      checkInvisibleCharacters,
      checkExcessivePunctuation,
    ];

    questionChecks.forEach(check => {
      allWarnings.push(...check(q.question, index, 'question'));
    });

    q.choices.forEach((choice, choiceIdx) => {
      const field = `choices[${choiceIdx}]`;
      questionChecks.forEach(check => {
        allWarnings.push(...check(choice, index, field));
      });
    });

    allWarnings.push(...checkDuplicateChoices(q.choices, index));
    allWarnings.push(...checkChoiceLengthImbalance(q.choices, index));

    [q.category, q.difficulty].forEach((val, i) => {
      const field = i === 0 ? 'category' : 'difficulty';
      allWarnings.push(...checkNormalizationAnomalies(val, index, field));
      allWarnings.push(...checkLeadingWhitespace(val, index, field));
      allWarnings.push(...checkTrailingWhitespace(val, index, field));
      allWarnings.push(...checkMultipleSpaces(val, index, field));
      allWarnings.push(...checkInvisibleCharacters(val, index, field));
    });
  });

  const questionsWithWarnings = new Set(allWarnings.map(w => w.questionIndex)).size;

  return {
    warnings: allWarnings,
    totalQuestions: questions.length,
    questionsWithWarnings,
  };
}

export function checkArabicQuality(
  questions: ValidatedQuestion[]
): { issues: ValidationIssue[]; result: ArabicQualityResult } {
  const result = analyzeArabicQuality(questions);
  const issues: ValidationIssue[] = result.warnings.map(w => ({
    code: w.rule,
    severity: 'WARNING' as const,
    message: w.message,
    questionIndex: w.questionIndex,
    field: w.field,
    value: w.value,
  }));

  return { issues, result };
}