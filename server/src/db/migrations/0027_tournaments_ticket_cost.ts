/**
 * R4.1 — website tournament ticket cost (additive).
 *
 * The website is the tournament authority, including the optional configured
 * ticket price in Streamlabs Loyalty points. The bot still performs the actual
 * Loyalty debit; this column only records what the website expects the bot to
 * charge for a website-originated purchase.
 *
 * Nullable and defaultless: every existing tournament keeps `ticket_cost = NULL`,
 * which means "legacy / bot default pricing" (NOT free). The website only asserts
 * the bot's returned amount when a cost is configured. No data rewrite.
 */
export const migration0027TournamentsTicketCost = {
  id: '0027_tournaments_ticket_cost',
  sql: `
ALTER TABLE tournaments
ADD COLUMN ticket_cost INTEGER
CHECK (ticket_cost IS NULL OR ticket_cost >= 1);
`,
};
