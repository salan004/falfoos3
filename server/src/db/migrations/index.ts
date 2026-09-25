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
export { migration0011Games } from './0011_games';
export { migration0012Tournaments } from './0012_tournaments';
export { migration0013TournamentParticipants } from './0013_tournament_participants';
export { migration0014BotWebhookEvents } from './0014_bot_webhook_events';
export { migration0015TournamentsParticipantCount } from './0015_tournaments_participant_count';
export { migration0016BotWebhookEventsStatus } from './0016_bot_webhook_events_status';
export { migration0017CompetitiveProfiles } from './0017_competitive_profiles';
export { migration0018LpTransactions } from './0018_lp_transactions';
export { migration0019EloTransactions } from './0019_elo_transactions';
export { migration0020TournamentMatches } from './0020_tournament_matches';
export { migration0021TournamentMatchParticipants } from './0021_tournament_match_participants';
export { migration0022MatchResultCorrections } from './0022_match_result_corrections';
export { migration0023CompetitiveProgression } from './0023_competitive_progression';
export { migration0024WebsiteIntegration } from './0024_website_integration';
export { migration0025GuestsClaimedUnique } from './0025_guests_claimed_unique';
export { migration0026LinkIntentsOperation } from './0026_link_intents_operation';
export { migration0027TournamentsTicketCost } from './0027_tournaments_ticket_cost';
export { migration0028TournamentsHiddenAt } from './0028_tournaments_hidden_at';
export { migration0029TournamentTeams } from './0029_tournament_teams';

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
import { migration0011Games } from './0011_games';
import { migration0012Tournaments } from './0012_tournaments';
import { migration0013TournamentParticipants } from './0013_tournament_participants';
import { migration0014BotWebhookEvents } from './0014_bot_webhook_events';
import { migration0015TournamentsParticipantCount } from './0015_tournaments_participant_count';
import { migration0016BotWebhookEventsStatus } from './0016_bot_webhook_events_status';
import { migration0017CompetitiveProfiles } from './0017_competitive_profiles';
import { migration0018LpTransactions } from './0018_lp_transactions';
import { migration0019EloTransactions } from './0019_elo_transactions';
import { migration0020TournamentMatches } from './0020_tournament_matches';
import { migration0021TournamentMatchParticipants } from './0021_tournament_match_participants';
import { migration0022MatchResultCorrections } from './0022_match_result_corrections';
import { migration0023CompetitiveProgression } from './0023_competitive_progression';
import { migration0024WebsiteIntegration } from './0024_website_integration';
import { migration0025GuestsClaimedUnique } from './0025_guests_claimed_unique';
import { migration0026LinkIntentsOperation } from './0026_link_intents_operation';
import { migration0027TournamentsTicketCost } from './0027_tournaments_ticket_cost';
import { migration0028TournamentsHiddenAt } from './0028_tournaments_hidden_at';
import { migration0029TournamentTeams } from './0029_tournament_teams';

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
  migration0011Games,
  migration0012Tournaments,
  migration0013TournamentParticipants,
  migration0014BotWebhookEvents,
  migration0015TournamentsParticipantCount,
  migration0016BotWebhookEventsStatus,
  migration0017CompetitiveProfiles,
  migration0018LpTransactions,
  migration0019EloTransactions,
  migration0020TournamentMatches,
  migration0021TournamentMatchParticipants,
  migration0022MatchResultCorrections,
  migration0023CompetitiveProgression,
  migration0024WebsiteIntegration,
  migration0025GuestsClaimedUnique,
  migration0026LinkIntentsOperation,
  migration0027TournamentsTicketCost,
  migration0028TournamentsHiddenAt,
  migration0029TournamentTeams,
];
