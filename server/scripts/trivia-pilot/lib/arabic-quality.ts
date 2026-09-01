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

/**
 * Check for Unicode normalization anomalies.
 * Detects text that changes under NFC normalization.
 */
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

/**
 * Check for leading whitespace.
 */
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

/**
 * Check for trailing whitespace.
 */
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

/**
 * Check for multiple consecutive spaces.
 */
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

/**
 * Check for suspicious repeated punctuation.
 * e.g., "??", "!!", "،،", "؛؛"
 */
function checkSuspiciousPunctuation(text: string, index: number, field: string): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  // Check for repeated punctuation marks (2 or more same punctuation in a row)
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

/**
 * Check for English punctuation used unnaturally in Arabic text.
 * e.g., using "?" instead of "؟", ":" instead of "؛"
 */
function checkEnglishPunctuationInArabic(text: string, index: number, field: string): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  // Only flag if text appears to be primarily Arabic (contains Arabic letters)
  const hasArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
  if (hasArabic) {
    // Check for English question mark instead of Arabic
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
    // Check for English semicolon instead of Arabic
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
    // Check for English comma instead of Arabic
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

/**
 * Check for suspicious Arabic/Latin script mixing.
 * Flags if Latin letters appear in what should be Arabic text.
 */
function checkMixedScript(text: string, index: number, field: string): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  const hasArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
  const hasLatin = /[A-Za-z]/.test(text);
  
  if (hasArabic && hasLatin) {
    // Allow common acceptable cases: numbers, units, proper nouns
    // Flag if there are Latin words (sequences of letters) mixed with Arabic
    const latinWords = text.match(/[A-Za-z]{2,}/g);
    if (latinWords && latinWords.length > 0) {
      // Filter out common acceptable abbreviations/units
      const acceptable = new Set(['GTA', 'RPG', 'NES', 'SNES', 'CPU', 'GPU', 'RAM', 'SSD', 'HDD', 'USB', 'HDMI', 'AI', 'API', 'URL', 'HTML', 'CSS', 'JS', 'TS', 'SQL', 'Fe', 'Au', 'Ag', 'DNA', 'RNA', 'ATP', 'NASA', 'UN', 'EU', 'UK', 'USA', 'UAE']);
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

/**
 * Check for suspicious standalone Latin digits in Arabic text.
 * e.g., "123" instead of "١٢٣" in Arabic context.
 * This is a soft check - digits are often acceptable.
 */
function checkLatinDigits(text: string, index: number, field: string): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  const hasArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
  if (hasArabic) {
    // Check for standalone Latin digits (not part of a known abbreviation)
    const digitMatches = text.match(/\b\d+\b/g);
    if (digitMatches && digitMatches.length > 0) {
      // This is often acceptable (years, numbers in choices), so we only warn
      // if there are many digits or they seem out of place
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

/**
 * Check for repeated word patterns.
 * e.g., "ما ما", "في في", "ال العاب ال العاب"
 */
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
      break; // Only report once per field
    }
  }
  return warnings;
}

/**
 * Check for invisible or empty-looking Unicode characters.
 * Zero-width spaces, zero-width joiners, etc.
 */
function checkInvisibleCharacters(text: string, index: number, field: string): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  // Check for zero-width characters, BOM, etc.
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

/**
 * Check for duplicate choices after normalization.
 */
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

/**
 * Check for suspicious choice length imbalance.
 * Flags if one choice is dramatically longer/shorter than others.
 * This could unintentionally reveal the correct answer.
 */
function checkChoiceLengthImbalance(choices: string[], index: number): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  const lengths = choices.map(c => c.trim().length);
  const minLen = Math.min(...lengths);
  const maxLen = Math.max(...lengths);
  const avgLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  
  // Flag if max is more than 3x min AND max is more than 2x average
  // This is a conservative threshold to avoid false positives
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

/**
 * Check for excessive punctuation.
 * More than 3 punctuation marks in a short text might be suspicious.
 */
function checkExcessivePunctuation(text: string, index: number, field: string): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  const punctuationCount = (text.match(/[؟?!.,،؛:]/g) || []).length;
  const charCount = text.length;
  // Flag if punctuation density is very high (>15% and >3 marks)
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

/**
 * Run all Arabic quality checks on a question set.
 */
export function analyzeArabicQuality(questions: PreparedQuestion[]): ArabicQualityResult {
  const allWarnings: QualityWarning[] = [];
  
  questions.forEach((q, index) => {
    // Check question text
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
    
    // Check each choice
    q.choices.forEach((choice, choiceIdx) => {
      const field = `choices[${choiceIdx}]`;
      questionChecks.forEach(check => {
        allWarnings.push(...check(choice, index, field));
      });
    });
    
    // Check choices for duplicates and length imbalance
    allWarnings.push(...checkDuplicateChoices(q.choices, index));
    allWarnings.push(...checkChoiceLengthImbalance(q.choices, index));
    
    // Check category and difficulty
    [q.category, q.difficulty].forEach((val, i) => {
      const field = i === 0 ? 'category' : 'difficulty';
      allWarnings.push(...checkNormalizationAnomalies(val, index, field));
      allWarnings.push(...checkLeadingWhitespace(val, index, field));
      allWarnings.push(...checkTrailingWhitespace(val, index, field));
      allWarnings.push(...checkMultipleSpaces(val, index, field));
      allWarnings.push(...checkInvisibleCharacters(val, index, field));
    });
  });
  
  // Count unique questions with warnings
  const questionsWithWarnings = new Set(allWarnings.map(w => w.questionIndex)).size;
  
  return {
    warnings: allWarnings,
    totalQuestions: questions.length,
    questionsWithWarnings,
  };
}

/**
 * Generate a summary string for the report.
 */
export function formatQualitySummary(result: ArabicQualityResult): string {
  const lines: string[] = [];
  lines.push('## Arabic Quality Heuristic Analysis');
  lines.push('');
  lines.push(`**Total Questions Analyzed:** ${result.totalQuestions}`);
  lines.push(`**Questions With Warnings:** ${result.questionsWithWarnings}`);
  lines.push(`**Total Warnings:** ${result.warnings.length}`);
  lines.push('');
  
  if (result.warnings.length === 0) {
    lines.push('No quality warnings detected.');
    lines.push('');
  } else {
    // Group by rule
    const byRule = new Map<string, QualityWarning[]>();
    result.warnings.forEach(w => {
      if (!byRule.has(w.rule)) byRule.set(w.rule, []);
      byRule.get(w.rule)!.push(w);
    });
    
    byRule.forEach((warnings, rule) => {
      lines.push(`### ${rule} (${warnings.length})`);
      lines.push('');
      warnings.slice(0, 10).forEach(w => {
        lines.push(`- **Q${w.questionIndex}** [${w.field}]: ${w.message}`);
        lines.push(`  - Value: ${w.value.substring(0, 100)}${w.value.length > 100 ? '...' : ''}`);
      });
      if (warnings.length > 10) {
        lines.push(`- ... and ${warnings.length - 10} more`);
      }
      lines.push('');
    });
  }
  
  lines.push('---');
  lines.push('');
  lines.push('**IMPORTANT:** AUTOMATED ARABIC QUALITY CHECKS ARE HEURISTIC ONLY.');
  lines.push('HUMAN REVIEW IS STILL REQUIRED.');
  lines.push('');
  
  return lines.join('\n');
}