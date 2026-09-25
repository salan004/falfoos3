/**
 * Phase 4C — BracketService tests: sizes, byes, randomization, lock, graph.
 * Run: `npm -w server run test`.
 */

import { cleanupTestDb, testDbPath } from './testDb';
import { getDb, initDatabase } from '../db/db';
import {
  cleanCompetitive,
  cleanTournaments,
  seedGame,
  seedPlayer,
  seedTournament,
  seedTournamentParticipant,
  seedUser,
} from './competitiveTestSeed';
import {
  BracketError,
  buildSeedOrder,
  generateBracket,
  getTournamentBracket,
  hasBracket,
  nextPowerOfTwo,
  roundNameForPlayers,
} from './BracketService';
import { assertEqual, assertNull, assertThrows, assertTrue, summarize, test } from './testHarness';

initDatabase();
assertEqual(getDb().name, testDbPath, 'isolated test database is active');

const ADMIN = 'admin-user-1';
const DG = 'game-dg';
const RL = 'game-rl';
seedUser(ADMIN);
seedGame(DG, 'dueling_grounds');
seedGame(RL, 'rocket_league');
cleanCompetitive();
cleanTournaments();

let counter = 0;
function setupTournament(gameId: string, playerCount: number, status: 'open' | 'draft' = 'open'): {
  tournamentId: string;
  players: string[];
} {
  counter += 1;
  const tournamentId = `t-${counter}`;
  seedTournament({ id: tournamentId, gameId, status, createdBy: ADMIN });
  const players: string[] = [];
  for (let i = 0; i < playerCount; i++) {
    const pid = `p-${counter}-${String(i + 1).padStart(3, '0')}`;
    seedPlayer(pid, `Player ${i + 1}`);
    seedTournamentParticipant(tournamentId, pid);
    players.push(pid);
  }
  return { tournamentId, players };
}

function allBracketParticipants(tournamentId: string): { playerId: string | null; slot: number; roundNo: number }[] {
  const bracket = getTournamentBracket(tournamentId)!;
  const out: { playerId: string | null; slot: number; roundNo: number }[] = [];
  for (const round of bracket.rounds) {
    for (const match of round.matches) {
      for (const p of match.participants) {
        out.push({ playerId: p.playerId, slot: p.slot, roundNo: round.roundNo });
      }
    }
  }
  return out;
}

console.log('=== BracketService ===');

test('nextPowerOfTwo maps counts to the smallest fitting power of two', () => {
  assertEqual(nextPowerOfTwo(1), 1, '1');
  assertEqual(nextPowerOfTwo(2), 2, '2');
  assertEqual(nextPowerOfTwo(3), 4, '3');
  assertEqual(nextPowerOfTwo(4), 4, '4');
  assertEqual(nextPowerOfTwo(5), 8, '5');
  assertEqual(nextPowerOfTwo(6), 8, '6');
  assertEqual(nextPowerOfTwo(7), 8, '7');
  assertEqual(nextPowerOfTwo(8), 8, '8');
  assertEqual(nextPowerOfTwo(9), 16, '9');
  assertEqual(nextPowerOfTwo(10), 16, '10');
  assertEqual(nextPowerOfTwo(12), 16, '12');
  assertEqual(nextPowerOfTwo(16), 16, '16');
});

test('buildSeedOrder produces the standard bracket order', () => {
  assertEqual(JSON.stringify(buildSeedOrder(2)), JSON.stringify([1, 2]), 'size 2');
  assertEqual(JSON.stringify(buildSeedOrder(4)), JSON.stringify([1, 4, 2, 3]), 'size 4');
  assertEqual(JSON.stringify(buildSeedOrder(8)), JSON.stringify([1, 8, 4, 5, 2, 7, 3, 6]), 'size 8');
});

test('round names are derived from bracket size', () => {
  assertEqual(roundNameForPlayers(2).en, 'Final', 'final');
  assertEqual(roundNameForPlayers(4).en, 'Semi Final', 'semi');
  assertEqual(roundNameForPlayers(8).en, 'Quarter Final', 'quarter');
  assertEqual(roundNameForPlayers(16).en, 'Round of 16', 'r16');
  assertEqual(roundNameForPlayers(32).en, 'Round of 32', 'r32');
});

test('power-of-two brackets have the exact expected shape', () => {
  const cases: { n: number; rounds: number[] }[] = [
    { n: 2, rounds: [1] },
    { n: 4, rounds: [2, 1] },
    { n: 8, rounds: [4, 2, 1] },
    { n: 16, rounds: [8, 4, 2, 1] },
  ];
  for (const { n, rounds } of cases) {
    const { tournamentId } = setupTournament(DG, n);
    const result = generateBracket(tournamentId);
    assertEqual(result.bracketSize, n, `bracket size for ${n}`);
    assertEqual(result.totalRounds, rounds.length, `rounds for ${n}`);
    assertEqual(result.byes, 0, `no byes for ${n}`);
    const bracket = getTournamentBracket(tournamentId)!;
    assertEqual(
      JSON.stringify(bracket.rounds.map((r) => r.matches.length)),
      JSON.stringify(rounds),
      `matches per round for ${n}`
    );
    assertEqual(result.matchCount, n - 1, `match count for ${n}`);
    // No first-round byes: every match has two participants.
    for (const match of bracket.rounds[0].matches) {
      assertEqual(match.participants.length, 2, `round-1 match has 2 players (${n})`);
    }
  }
});

test('non-power-of-two brackets use byes without fake matches', () => {
  for (const n of [3, 5, 6, 7, 10, 12]) {
    const { tournamentId, players } = setupTournament(DG, n);
    const result = generateBracket(tournamentId);
    const bracket = getTournamentBracket(tournamentId)!;

    const expectedSize = nextPowerOfTwo(n);
    assertEqual(result.bracketSize, expectedSize, `bracket size ${n}`);
    assertEqual(result.byes, expectedSize - n, `byes ${n}`);
    assertEqual(result.matchCount, expectedSize - 1 - (expectedSize - n), `match count ${n}`);

    // Every first-round match is a real 2-player match (no Player vs BYE).
    for (const match of bracket.rounds[0].matches) {
      assertEqual(match.participants.length, 2, `round-1 match real (${n})`);
    }

    // Every player appears exactly once across the whole generated bracket.
    const appearances = allBracketParticipants(tournamentId);
    const seen = appearances.map((a) => a.playerId).sort();
    assertEqual(JSON.stringify(seen), JSON.stringify([...players].sort()), `all players once (${n})`);
    assertEqual(new Set(seen).size, n, `no duplicates (${n})`);

    // Byes are pre-placed in round 2 (no results yet) and equal the bye count.
    const round2 = bracket.rounds[1]?.matches ?? [];
    const prePlaced = round2.reduce((sum, m) => sum + m.participants.length, 0);
    assertEqual(prePlaced, result.byes, `pre-placed byes (${n})`);

    // No match ever exceeds two participants (two bye-advancers may legitimately
    // meet in round 2, but nothing else may be injected).
    for (const match of round2) {
      assertTrue(match.participants.length <= 2, `round-2 match at most two players (${n})`);
      for (const p of match.participants) {
        assertTrue(players.includes(p.playerId ?? ''), `round-2 participant is a real player (${n})`);
      }
    }
  }
});

test('seeding is randomized, persisted, and locked', () => {
  const { tournamentId, players } = setupTournament(DG, 8);
  assertTrue(!hasBracket(tournamentId), 'no bracket before generation');
  const result = generateBracket(tournamentId);
  assertTrue(result.matchCount > 0, 'matches generated');
  assertTrue(hasBracket(tournamentId), 'bracket exists after generation');

  const first = allBracketParticipants(tournamentId);
  const second = allBracketParticipants(tournamentId);
  assertEqual(JSON.stringify(first), JSON.stringify(second), 'bracket is stable across reads');

  const seen = first.map((a) => a.playerId).sort();
  assertEqual(JSON.stringify(seen), JSON.stringify([...players].sort()), 'all players seeded once');

  // Regeneration is blocked and does not change the bracket.
  assertThrows(() => generateBracket(tournamentId), 'regeneration blocked');
  assertEqual(JSON.stringify(allBracketParticipants(tournamentId)), JSON.stringify(first), 'bracket unchanged');
});

test('deterministic RNG injection yields reproducible seeding', () => {
  function lcg(seed: number): (max: number) => number {
    let state = seed >>> 0;
    return (max: number) => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state % max;
    };
  }
  const a = setupTournament(DG, 12);
  const b = setupTournament(DG, 12);
  // Same RNG stream per tournament.
  generateBracket(a.tournamentId, { randomInt: lcg(12345) });
  generateBracket(b.tournamentId, { randomInt: lcg(12345) });

  const seedMap = (tournamentId: string): string => {
    const bracket = getTournamentBracket(tournamentId)!;
    const entries: [string, number][] = [];
    for (const round of bracket.rounds) {
      for (const match of round.matches) {
        for (const p of match.participants) {
          if (p.seed !== null) entries.push([(p.playerId ?? '').slice(-3), p.seed]);
        }
      }
    }
    return JSON.stringify(entries.sort());
  };
  assertEqual(seedMap(a.tournamentId), seedMap(b.tournamentId), 'same RNG → same seeding');
});

test('rejects invalid generation preconditions', () => {
  const few = setupTournament(DG, 1);
  let code = '';
  try {
    generateBracket(few.tournamentId);
  } catch (err) {
    code = err instanceof BracketError ? err.code : 'unknown';
  }
  assertEqual(code, 'not_enough_participants', 'needs >= 2 participants');

  const draft = setupTournament(DG, 4, 'draft');
  let draftCode = '';
  try {
    generateBracket(draft.tournamentId);
  } catch (err) {
    draftCode = err instanceof BracketError ? err.code : 'unknown';
  }
  assertEqual(draftCode, 'invalid_tournament_state', 'must be open');

  let missingCode = '';
  try {
    generateBracket('does-not-exist');
  } catch (err) {
    missingCode = err instanceof BracketError ? err.code : 'unknown';
  }
  assertEqual(missingCode, 'tournament_not_found', 'unknown tournament');
});

test('cancelled/disqualified participants are excluded from the bracket', () => {
  const { tournamentId } = setupTournament(DG, 4);
  seedPlayer('p-extra-1');
  seedTournamentParticipant(tournamentId, 'p-extra-1', { status: 'cancelled' });
  seedPlayer('p-extra-2');
  seedTournamentParticipant(tournamentId, 'p-extra-2', { status: 'disqualified' });

  const result = generateBracket(tournamentId);
  assertEqual(result.participantCount, 4, 'only eligible participants');
  const bracket = getTournamentBracket(tournamentId)!;
  const ids = bracket.rounds.flatMap((r) => r.matches.flatMap((m) => m.participants.map((p) => p.playerId)));
  assertTrue(!ids.includes('p-extra-1') && !ids.includes('p-extra-2'), 'excluded players absent');
});

test('getTournamentBracket returns null for an unknown tournament', () => {
  assertNull(getTournamentBracket('nope'), 'unknown tournament bracket');
});

cleanupTestDb();
summarize('BracketService');
