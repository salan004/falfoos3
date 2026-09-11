export interface SoftBounds {
  category: Record<string, { min: number; max: number }>;
  difficulty?: Record<string, { min: number; max: number }>;
  correctIdx?: Record<number, { min: number; max: number }>;
}

export interface ValidationIssue {
  code: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
  questionIndex?: number;
  field?: string;
  value?: string;
}

export interface QuestionValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  hash?: string;
}

export interface BatchValidationReport {
  batchId: string;
  batchName: string;
  totalQuestions: number;
  validQuestions: number;
  invalidQuestions: number;
  warnings: number;
  errors: number;
  distribution: {
    categories: Record<string, number>;
    difficulties: Record<string, number>;
    correctIdx: Record<number, number>;
  };
  duplicateChecks: {
    exactDuplicates: number;
    hashDuplicates: number;
    legacyCollisions: number;
    pilotCollisions: number;
    previousBatchCollisions: number;
  };
  templateRepetition: {
    status: 'PASS' | 'WARNING' | 'ERROR';
    flaggedCount: number;
    signatures: Array<{
      signature: string;
      count: number;
      indices: number[];
    }>;
  };
  arabicQuality: {
    warnings: number;
    questionsWithWarnings: number;
    byRule: Record<string, number>;
  };
  correctAnswerBinding: {
    checked: number;
    passed: number;
    failed: number;
    failures: Array<{
      index: number;
      correctAnswer: string;
      correctIdx: number;
      actualChoice: string;
    }>;
  };
  issues: ValidationIssue[];
  passed: boolean;
}

export interface ValidatedQuestion {
  question: string;
  choices: string[];
  correct_idx: number;
  correct_answer: string;
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

export interface BatchValidationInput {
  batchId: string;
  questions: Array<{
    question: string;
    choices: string[];
    correct_idx: number;
    correct_answer: string;
    category: string;
    difficulty: string;
    language?: string;
    tags?: string[];
    source?: string;
    verified?: boolean;
  }>;
  options?: {
    legacyHashes?: Set<string>;
    pilotHashes?: Set<string>;
    previousBatchHashes?: Set<string>;
    allowedCategories?: string[];
    allowedDifficulties?: string[];
    softBounds?: SoftBounds;
  };
}

export interface ValidationPipelineOptions {
  legacyHashes?: Set<string>;
  pilotHashes?: Set<string>;
  previousBatchHashes?: Set<string>;
  softBounds?: SoftBounds;
  allowedCategories?: string[];
  allowedDifficulties?: string[];
}