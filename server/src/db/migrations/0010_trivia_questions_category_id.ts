/**
 * Phase T2.3 — Trivia Question Category Association (additive).
 *
 * Adds category_id foreign key to trivia_questions for canonical category association.
 * Maps existing questions to canonical categories.
 * Does NOT drop the existing category text column.
 */
export const migration0010TriviaQuestionsCategoryId = {
  id: '0010_trivia_questions_category_id',
  sql: `
-- Add category_id column for canonical category association
ALTER TABLE trivia_questions ADD COLUMN category_id TEXT REFERENCES trivia_categories(id) ON DELETE RESTRICT;

-- Index for category queries
CREATE INDEX IF NOT EXISTS idx_trivia_questions_category_id ON trivia_questions(category_id);

-- Map existing categories to canonical categories
-- We use the slug as the id for canonical categories

-- تاريخ → history
UPDATE trivia_questions SET category_id = 'history' WHERE category = 'تاريخ';

-- جغرافيا → geography
UPDATE trivia_questions SET category_id = 'geography' WHERE category = 'جغرافيا';

-- علوم → science
UPDATE trivia_questions SET category_id = 'science' WHERE category = 'علوم';

-- فنون وآداب → arts_literature
UPDATE trivia_questions SET category_id = 'arts_literature' WHERE category = 'فنون وآداب';

-- رياضة → sports
UPDATE trivia_questions SET category_id = 'sports' WHERE category = 'رياضة';

-- تقنية وفضاء → technology_space
UPDATE trivia_questions SET category_id = 'technology_space' WHERE category = 'تقنية وفضاء';

-- ألعاب فيديو → video_games
UPDATE trivia_questions SET category_id = 'video_games' WHERE category = 'ألعاب فيديو';

-- ثقافة عامة → general_knowledge
UPDATE trivia_questions SET category_id = 'general_knowledge' WHERE category = 'ثقافة عامة';

-- Legacy migration: ألعاب → video_games (canonical)
UPDATE trivia_questions SET category_id = 'video_games' WHERE category = 'ألعاب' AND category_id IS NULL;

-- Fallback: any remaining unmapped questions go to general_knowledge
UPDATE trivia_questions SET category_id = 'general_knowledge' WHERE category_id IS NULL;
`,
};