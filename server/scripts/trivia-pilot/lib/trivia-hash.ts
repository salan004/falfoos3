import crypto from 'crypto';

/**
 * Normalizes text for hash computation.
 * Exact replica of production implementation in QuestionPoolService.ts
 * Trims whitespace, collapses internal whitespace, preserves Arabic text meaning.
 */
export function normalizeForHash(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFC');
}

/**
 * Computes a deterministic SHA-256 hash for a question.
 * Exact replica of production implementation in QuestionPoolService.ts
 * Used for duplicate detection.
 * Hash is based on: normalized question + normalized choices + normalized category + normalized difficulty
 * Does NOT include correct_idx.
 */
export function computeQuestionHash(
  question: string,
  choices: string[],
  category: string,
  difficulty: string
): string {
  const normalizedQuestion = normalizeForHash(question);
  const normalizedChoices = choices.map(normalizeForHash).join('|');
  const normalizedCategory = normalizeForHash(category);
  const normalizedDifficulty = normalizeForHash(difficulty);

  const content = `${normalizedQuestion}|${normalizedChoices}|${normalizedCategory}|${normalizedDifficulty}`;
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Verifies that the pilot hash implementation matches the production implementation.
 * Tests against multiple known cases.
 */
export function verifyHashCompatibility(productionComputeHash: typeof computeQuestionHash): {
  passed: boolean;
  details: Array<{ test: string; pilot: string; production: string; match: boolean }>;
} {
  const testCases = [
    {
      test: 'Simple Arabic question',
      question: 'ما هي عاصمة فرنسا؟',
      choices: ['باريس', 'ليون', 'مرسيليا', 'نيس'],
      category: 'جغرافيا',
      difficulty: 'سهل',
    },
    {
      test: 'Question with extra whitespace',
      question: '  ما   هو   أكبر   كوكب  ؟  ',
      choices: ['  زحل  ', '  نبتون  ', '  المشتري  ', '  أورانوس  '],
      category: '  علوم  ',
      difficulty: '  متوسط  ',
    },
    {
      test: 'Mixed punctuation and numbers',
      question: 'في أي سنة انتهى الحرب العالمية الثانية؟',
      choices: ['1944', '1945', '1946', '1947'],
      category: 'تاريخ',
      difficulty: 'سهل',
    },
    {
      test: 'English text with special chars',
      question: 'What is the capital of Japan?',
      choices: ['Tokyo', 'Osaka', 'Kyoto', 'Nagoya'],
      category: 'General',
      difficulty: 'Easy',
    },
    {
      test: 'Unicode normalization test',
      question: 'ما هِيْ عَاصِمَةُ الْيَابَانِ؟',
      choices: ['طُوكْيُو', 'أُوسَاكَا', 'كْيُوتُو', 'نَاغوِيَا'],
      category: 'جُغْرَافِيَا',
      difficulty: 'سَهْل',
    },
  ];

  const details = testCases.map(({ test, question, choices, category, difficulty }) => {
    const pilotHash = computeQuestionHash(question, choices, category, difficulty);
    const productionHash = productionComputeHash(question, choices, category, difficulty);
    return {
      test,
      pilot: pilotHash,
      production: productionHash,
      match: pilotHash === productionHash,
    };
  });

  const passed = details.every(d => d.match);

  return { passed, details };
}