import { Router, type Request, type Response, type NextFunction } from 'express';
import { env } from '../config/env';
import {
  isTimestampFresh,
  parseSignatureHeader,
  verifyHmacSignatureWithSecret,
} from '../middleware/verifyBotWebhook';
import {
  getTournamentsWithGameInfo,
  getTournamentWithGameInfo,
  type TournamentWithGame,
} from '../games/TournamentService';

/**
 * R4.1 — bot-authenticated website tournament discovery.
 *
 * The website is the tournament authority. This is a READ-ONLY surface the bot
 * uses to populate its ticket-product wizard (name/game/price/capacity/status).
 * It is NOT public: every request must carry a fresh inbound HMAC signed with
 * the shared `WEBSITE_INTEGRATION_SECRET` over `timestamp.rawBody`, exactly like
 * the existing website -> bot contract (reversed direction).
 *
 * No tournament creation/update, no Loyalty balance, no product ids, no
 * transaction ids are ever exposed here.
 */

export const websiteTournamentRoutes = Router();

const VALID_STATUSES = ['draft', 'open', 'active', 'completed', 'cancelled'];
const DEFAULT_STATUS = 'open';

/**
 * Verifies the bot's inbound request signature using WEBSITE_INTEGRATION_SECRET.
 * A GET has no body, so the signed payload is `timestamp.` + '' — matching the
 * shared `timestamp.rawBody` construction used across the integration.
 */
function verifyWebsiteBotRead(req: Request, res: Response, next: NextFunction): void {
  const parsed = parseSignatureHeader(req.headers['x-falfoos-signature'] as string | undefined);
  if (!parsed) {
    res.status(400).json({ error: 'invalid_signature_header', message: 'Missing or malformed X-FalFoos-Signature header' });
    return;
  }
  if (!isTimestampFresh(parsed.timestamp)) {
    res.status(400).json({ error: 'stale_timestamp', message: 'Request timestamp outside allowed window' });
    return;
  }

  const raw = (req as { rawBody?: Buffer | string }).rawBody;
  const rawBody = raw instanceof Buffer ? raw : typeof raw === 'string' ? raw : '';
  if (!verifyHmacSignatureWithSecret(rawBody, parsed.timestamp, parsed.signature, env.WEBSITE_INTEGRATION_SECRET)) {
    res.status(401).json({ error: 'invalid_signature', message: 'HMAC signature verification failed' });
    return;
  }

  next();
}

/** Stable discovery representation: identity + game + price + roster/capacity. */
function toDiscoveryDto(t: TournamentWithGame) {
  return {
    tournament_id: t.id,
    name_ar: t.name_ar,
    game_id: t.game_id,
    game_name_ar: t.game_name_ar,
    description_ar: t.description_ar,
    status: t.status,
    max_participants: t.max_participants,
    participant_count: t.participant_count,
    ticket_cost: t.ticket_cost,
    starts_at: t.starts_at,
    ends_at: t.ends_at,
  };
}

websiteTournamentRoutes.get('/tournaments', verifyWebsiteBotRead, (req: Request, res: Response) => {
  const rawStatus = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  const status = rawStatus || DEFAULT_STATUS;
  if (!VALID_STATUSES.includes(status)) {
    res.status(400).json({ error: 'invalid_status' });
    return;
  }
  const gameId = typeof req.query.gameId === 'string' ? req.query.gameId.trim() : '';

  let tournaments = getTournamentsWithGameInfo().filter((t) => t.status === status);
  if (gameId) tournaments = tournaments.filter((t) => t.game_id === gameId);

  res.json({ tournaments: tournaments.map(toDiscoveryDto) });
});

websiteTournamentRoutes.get('/tournaments/:tournamentId', verifyWebsiteBotRead, (req: Request, res: Response) => {
  const tournament = getTournamentWithGameInfo(req.params.tournamentId);
  if (!tournament) {
    res.status(404).json({ error: 'tournament_not_found' });
    return;
  }
  res.json({ tournament: toDiscoveryDto(tournament) });
});
