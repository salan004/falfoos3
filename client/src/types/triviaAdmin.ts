export interface TriviaQuestionAdmin {
  id: string;
  question: string;
  choices: string[];
  correct_idx: number;
  category: string;
  difficulty: string;
  tags: string[];
  source: string | null;
  verified: number;
  language: string;
  hash: string;
  created_at: number;
  updated_at: number;
  usage_count?: number;
  last_used_at?: number | null;
  last_match_id?: string | null;
}

export interface TriviaQuestionsListParams {
  page: number;
  pageSize: number;
  search?: string;
  category?: string;
  difficulty?: string;
  verified?: number;
  language?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface TriviaQuestionsListResponse {
  questions: TriviaQuestionAdmin[];
  total: number;
  page: number;
  pageSize: number;
}

export type ImportRowStatus = 'valid_new' | 'duplicate' | 'invalid' | 'warning';

export interface ImportRowPreview {
  index: number;
  status: ImportRowStatus;
  question: string;
  choices: string[];
  correct_idx: number;
  category: string;
  difficulty: string;
  tags?: string[];
  source?: string;
  verified?: number;
  language?: string;
  errors?: string[];
  existingId?: string;
  hash: string;
}

export interface ImportPreviewResult {
  rows: ImportRowPreview[];
  summary: {
    valid: number;
    duplicate: number;
    invalid: number;
    warning: number;
  };
}

export interface ImportCommitResult {
  imported: number;
  skipped: number;
  rejected: number;
}

export interface CreateQuestionInput {
  question: string;
  choices: string[];
  correct_idx: number;
  category: string;
  difficulty: string;
  tags?: string[];
  source?: string;
  verified?: number;
  language?: string;
}

export interface UpdateQuestionInput {
  question?: string;
  choices?: string[];
  correct_idx?: number;
  category?: string;
  difficulty?: string;
  tags?: string[];
  source?: string;
  verified?: number;
  language?: string;
}