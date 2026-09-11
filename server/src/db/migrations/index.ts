export { migration0001Init } from './0001_init';
export { migration0002GuestChannel } from './0002_guest_channel';
export { migration0003MatchResults } from './0003_match_results';
export { migration0004PlayerAchievements } from './0004_player_achievements';
export { migration0005TriviaQuestions } from './0005_trivia_questions';
export { migration0006TriviaQuestionUsage } from './0006_trivia_question_usage';
export { migration0007TriviaBatches } from './0007_trivia_batches';
export { migration0008TriviaQuestionsBatch } from './0008_trivia_questions_batch';
export { migration0009TriviaCategories } from './0009_trivia_categories';
export { migration0010TriviaQuestionsCategoryId } from './0010_trivia_questions_category_id';

import { migration0001Init } from './0001_init';
import { migration0002GuestChannel } from './0002_guest_channel';
import { migration0003MatchResults } from './0003_match_results';
import { migration0004PlayerAchievements } from './0004_player_achievements';
import { migration0005TriviaQuestions } from './0005_trivia_questions';
import { migration0006TriviaQuestionUsage } from './0006_trivia_question_usage';
import { migration0007TriviaBatches } from './0007_trivia_batches';
import { migration0008TriviaQuestionsBatch } from './0008_trivia_questions_batch';
import { migration0009TriviaCategories } from './0009_trivia_categories';
import { migration0010TriviaQuestionsCategoryId } from './0010_trivia_questions_category_id';

/**
 * Ordered migration registry. New migrations are appended here in order —
 * never edit an already-shipped migration.
 */
export const migrations: { id: string; sql: string }[] = [
  migration0001Init,
  migration0002GuestChannel,
  migration0003MatchResults,
  migration0004PlayerAchievements,
  migration0005TriviaQuestions,
  migration0006TriviaQuestionUsage,
  migration0007TriviaBatches,
  migration0008TriviaQuestionsBatch,
  migration0009TriviaCategories,
  migration0010TriviaQuestionsCategoryId,
];
