import { calculateRanking, fisherYatesShuffle, createInitialPlayerStats, PlayerStats } from './TriviaGame';
import { normalizeChatCommand } from '../core/chatCommands';
import crypto from 'crypto';

function createTestPlayers() {
  return [
    { id: 'p1', displayName: 'Player 1', avatarUrl: undefined },
    { id: 'p2', displayName: 'Player 2', avatarUrl: undefined },
    { id: 'p3', displayName: 'Player 3', avatarUrl: undefined },
  ];
}

function createTestStats(overrides: Record<string, Partial<PlayerStats>> = {}) {
  const stats = new Map<string, PlayerStats>();

  for (const [id, override] of Object.entries(overrides)) {
    stats.set(id, {
      score: override.score ?? 0,
      correctAnswers: override.correctAnswers ?? 0,
      wrongAnswers: override.wrongAnswers ?? 0,
      totalResponseTimeMs: override.totalResponseTimeMs ?? 0,
      answeredQuestionCount: override.answeredQuestionCount ?? 0,
    });
  }

  return stats;
}

console.log('=== Testing Ranking Logic ===\n');

// Test 1: Highest score wins
console.log('Test 1: Highest score wins');
const players1 = createTestPlayers();
const stats1 = createTestStats({
  p1: { score: 300, correctAnswers: 3, wrongAnswers: 0, totalResponseTimeMs: 5000, answeredQuestionCount: 3 },
  p2: { score: 200, correctAnswers: 2, wrongAnswers: 1, totalResponseTimeMs: 4000, answeredQuestionCount: 3 },
  p3: { score: 100, correctAnswers: 1, wrongAnswers: 2, totalResponseTimeMs: 3000, answeredQuestionCount: 3 },
});
const ranked1 = calculateRanking(players1, stats1);
console.log('Ranked:', ranked1.map((r) => `${r.displayName}: ${r.score}`).join(', '));
console.log('Winner:', ranked1[0].displayName);
console.log('PASS:', ranked1[0].id === 'p1' ? 'YES' : 'NO');
console.log();

// Test 2: Tie-break by fewer wrong answers
console.log('Test 2: Tie-break by fewer wrong answers');
const players2 = createTestPlayers();
const stats2 = createTestStats({
  p1: { score: 200, correctAnswers: 2, wrongAnswers: 2, totalResponseTimeMs: 5000, answeredQuestionCount: 4 },
  p2: { score: 200, correctAnswers: 2, wrongAnswers: 1, totalResponseTimeMs: 4000, answeredQuestionCount: 3 },
  p3: { score: 100, correctAnswers: 1, wrongAnswers: 2, totalResponseTimeMs: 3000, answeredQuestionCount: 3 },
});
const ranked2 = calculateRanking(players2, stats2);
console.log('Ranked:', ranked2.map((r) => `${r.displayName}: score=${r.score}, wrong=${r.wrongAnswers}`).join(', '));
console.log('Winner:', ranked2[0].displayName);
console.log('PASS:', ranked2[0].id === 'p2' ? 'YES' : 'NO');
console.log();

// Test 3: Tie-break by lower average response time
console.log('Test 3: Tie-break by lower average response time');
const players3 = createTestPlayers();
const stats3 = createTestStats({
  p1: { score: 200, correctAnswers: 2, wrongAnswers: 1, totalResponseTimeMs: 5000, answeredQuestionCount: 3 },
  p2: { score: 200, correctAnswers: 2, wrongAnswers: 1, totalResponseTimeMs: 3000, answeredQuestionCount: 3 },
  p3: { score: 100, correctAnswers: 1, wrongAnswers: 2, totalResponseTimeMs: 3000, answeredQuestionCount: 3 },
});
const ranked3 = calculateRanking(players3, stats3);
console.log('Ranked:', ranked3.map((r) => `${r.displayName}: score=${r.score}, wrong=${r.wrongAnswers}, avgTime=${r.avgResponseTimeMs}`).join(', '));
console.log('Winner:', ranked3[0].displayName);
console.log('PASS:', ranked3[0].id === 'p2' ? 'YES' : 'NO');
console.log();

// Test 4: Complete tie - multiple winners
console.log('Test 4: Complete tie - multiple winners');
const players4 = createTestPlayers();
const stats4 = createTestStats({
  p1: { score: 200, correctAnswers: 2, wrongAnswers: 1, totalResponseTimeMs: 4000, answeredQuestionCount: 3 },
  p2: { score: 200, correctAnswers: 2, wrongAnswers: 1, totalResponseTimeMs: 4000, answeredQuestionCount: 3 },
  p3: { score: 100, correctAnswers: 1, wrongAnswers: 2, totalResponseTimeMs: 3000, answeredQuestionCount: 3 },
});
const ranked4 = calculateRanking(players4, stats4);
console.log('Ranked:', ranked4.map((r) => `${r.displayName}: score=${r.score}`).join(', '));
const topScore = ranked4[0].score;
const winners = ranked4.filter((r) => r.score === topScore);
console.log('Winners:', winners.map((w) => w.displayName).join(', '));
console.log('PASS:', winners.length === 2 && winners.some((w) => w.id === 'p1') && winners.some((w) => w.id === 'p2') ? 'YES' : 'NO');
console.log();

// Test 5: Fisher-Yates shuffle produces different orders
console.log('Test 5: Fisher-Yates shuffle randomness');
const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
let different = false;
for (let i = 0; i < 100; i++) {
  const shuffled = fisherYatesShuffle(original);
  if (JSON.stringify(shuffled) !== JSON.stringify(original)) {
    different = true;
    break;
  }
}
console.log('Shuffle produces different order:', different ? 'YES' : 'NO');
console.log('Sample shuffle:', fisherYatesShuffle(original).join(', '));
console.log('PASS:', different ? 'YES' : 'NO');
console.log();

// Test 6: Fisher-Yates preserves all elements
console.log('Test 6: Fisher-Yates preserves all elements');
const testArray = ['a', 'b', 'c', 'd', 'e'];
const shuffled = fisherYatesShuffle(testArray);
const sorted = [...shuffled].sort();
console.log('Original:', testArray.join(', '));
console.log('Shuffled:', shuffled.join(', '));
console.log('Sorted:', sorted.join(', '));
console.log('PASS:', JSON.stringify(sorted) === JSON.stringify(testArray.sort()) ? 'YES' : 'NO');
console.log();

// Test 7: Empty array handling
console.log('Test 7: Empty array handling');
const emptyShuffled = fisherYatesShuffle([]);
console.log('Empty shuffle:', emptyShuffled);
console.log('PASS:', emptyShuffled.length === 0 ? 'YES' : 'NO');
console.log();

// Test 8: Single element
console.log('Test 8: Single element');
const singleShuffled = fisherYatesShuffle([42]);
console.log('Single shuffle:', singleShuffled);
console.log('PASS:', singleShuffled[0] === 42 ? 'YES' : 'NO');
console.log();

// Test 9: Players with no stats (should default to 0)
console.log('Test 9: Players with no stats default to 0');
const players9 = [{ id: 'p1', displayName: 'Player 1', avatarUrl: undefined }];
const stats9 = new Map<string, PlayerStats>();
const ranked9 = calculateRanking(players9, stats9);
console.log('Ranked:', ranked9.map((r) => `${r.displayName}: score=${r.score}, wrong=${r.wrongAnswers}`).join(', '));
console.log('PASS:', ranked9[0].score === 0 && ranked9[0].wrongAnswers === 0 ? 'YES' : 'NO');
console.log();

console.log('=== All Ranking Tests Complete ===\n');
console.log('=== Testing Answer Interaction Logic ===\n');

// Test 10: Valid answer formats
console.log('Test 10: Valid answer formats');
const validAnswers = ['1', '2', '3', '4', '!1', '!2', '!3', '!4', ' 1 ', ' 2', '3 ', ' !4 '];
let allValid = true;
for (const ans of validAnswers) {
  const normalized = normalizeChatCommand(ans);
  const match = normalized.match(/^!?([1-4])$/);
  if (!match || match[1] < '1' || match[1] > '4') {
    console.log(`FAIL: "${ans}" -> normalized="${normalized}"`);
    allValid = false;
  } else {
    console.log(`PASS: "${ans}" -> normalized="${normalized}", answer=${match[1]}`);
  }
}
console.log('Overall PASS:', allValid ? 'YES' : 'NO');
console.log();

// Test 11: Invalid answer formats (clearly answer attempts but out of range)
console.log('Test 11: Invalid answer formats (out of range)');
const invalidAnswers = ['0', '5', '6', '7', '8', '9', '!0', '!5', '!6', '!7', '!8', '!9', ' 0 ', ' 5 '];
let allInvalid = true;
for (const ans of invalidAnswers) {
  const normalized = normalizeChatCommand(ans);
  const validMatch = normalized.match(/^!?([1-4])$/);
  const invalidMatch = normalized.match(/^!?([05-9])$/);
  if (validMatch) {
    console.log(`FAIL: "${ans}" matched as valid: ${validMatch[1]}`);
    allInvalid = false;
  } else if (!invalidMatch) {
    console.log(`FAIL: "${ans}" not recognized as invalid attempt: normalized="${normalized}"`);
    allInvalid = false;
  } else {
    console.log(`PASS: "${ans}" -> normalized="${normalized}", invalid answer=${invalidMatch[1]}`);
  }
}
console.log('Overall PASS:', allInvalid ? 'YES' : 'NO');
console.log();

// Test 12: Regular chat messages (should NOT be treated as answer attempts)
console.log('Test 12: Regular chat messages (ignored)');
const regularChat = [
  'hello', 'hi there', '!hello', '!انضم', '!join', 'good game', 'gg', '!gg',
  'answer is 2', 'I think 3', 'what is 4', '!start', '!stop', 'trivia:start',
  'اختر 1', 'الجواب 2', 'yes', 'no', '!yes'
];
let allIgnored = true;
for (const msg of regularChat) {
  const normalized = normalizeChatCommand(msg);
  const validMatch = normalized.match(/^!?([1-4])$/);
  const invalidMatch = normalized.match(/^!?([05-9])$/);
  const isJoin = /^!\s*(انضم|join)$/.test(normalized);
  if (validMatch || invalidMatch || isJoin) {
    console.log(`FAIL: "${msg}" -> normalized="${normalized}" matched as answer/join`);
    allIgnored = false;
  } else {
    console.log(`PASS: "${msg}" -> normalized="${normalized}" ignored`);
  }
}
console.log('Overall PASS:', allIgnored ? 'YES' : 'NO');
console.log();

// Test 13: Arabic/RTL invisible characters handled
console.log('Test 13: Invisible character handling');
const withInvisible = ['\u200b1\u200b', '\u200e!2\u200f', ' \u200c 3 \u200d '];
let allClean = true;
for (const msg of withInvisible) {
  const normalized = normalizeChatCommand(msg);
  const match = normalized.match(/^!?([1-4])$/);
  if (!match) {
    console.log(`FAIL: "${msg}" -> normalized="${normalized}" not recognized`);
    allClean = false;
  } else {
    console.log(`PASS: "${msg}" -> normalized="${normalized}", answer=${match[1]}`);
  }
}
console.log('Overall PASS:', allClean ? 'YES' : 'NO');
console.log();

// Test 14: Case insensitivity (though answers are numbers)
console.log('Test 14: Case insensitivity for commands');
const caseTests = ['!JOIN', '!Join', '!انضم', '!  انضم  '];
let allCase = true;
for (const msg of caseTests) {
  const normalized = normalizeChatCommand(msg);
  const isJoin = /^!\s*(انضم|join)$/.test(normalized);
  if (!isJoin) {
    console.log(`FAIL: "${msg}" -> normalized="${normalized}" not recognized as join`);
    allCase = false;
  } else {
    console.log(`PASS: "${msg}" -> normalized="${normalized}" recognized as join`);
  }
}
console.log('Overall PASS:', allCase ? 'YES' : 'NO');
console.log();

console.log('=== All Answer Interaction Tests Complete ===\n');
console.log('=== Testing B3.2 Cross-Match Question Rotation ===\n');

// B3.2 Test imports
import { getRandomQuestions, markQuestionAsUsed, importQuestion } from './trivia/QuestionPoolService';
import { getDb } from '../db/db';

function createTestQuestion(overrides: Partial<{ category: string; difficulty: string }> = {}): { question: string; choices: string[]; correct_idx: number; category: string; difficulty: string } {
  const id = crypto.randomUUID().slice(0, 8);
  return {
    question: `Test question ${id}?`,
    choices: ['A', 'B', 'C', 'D'],
    correct_idx: 0,
    category: overrides.category ?? 'general',
    difficulty: overrides.difficulty ?? 'سهل',
  };
}

async function clearTestQuestions(): Promise<void> {
  const db = getDb();
  db.prepare('DELETE FROM trivia_question_usage').run();
  db.prepare("DELETE FROM trivia_questions WHERE question LIKE 'Test question%'").run();
}

async function seedQuestions(count: number, baseCategory = 'general', baseDifficulty = 'سهل'): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const q = createTestQuestion({ category: baseCategory, difficulty: baseDifficulty });
    const result = importQuestion(q.question, q.choices, q.correct_idx, q.category, q.difficulty, { verified: 1 });
    if (result.id) ids.push(result.id);
  }
  return ids;
}

async function runB32Tests(): Promise<void> {
  // Test 1: Never-used questions are preferred over recently-used questions
  console.log('B3.2 Test 1: Never-used questions preferred over recently-used');
  try {
    await clearTestQuestions();
    const neverUsedIds = await seedQuestions(5);
    const usedIds = await seedQuestions(3);
    const now = Date.now();
    const db = getDb();
    for (const id of usedIds) {
      db.prepare('INSERT INTO trivia_question_usage (question_id, usage_count, last_used_at, last_match_id, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?)')
        .run(id, now, 'match-1', now, now);
    }
    const questions = getRandomQuestions(5, { category: 'general', verifiedOnly: true }, []);
    const neverUsedCount = questions.filter(q => neverUsedIds.includes(q.id)).length;
    console.log(`  Selected ${questions.length} questions, ${neverUsedCount} were never-used`);
    console.log('PASS:', neverUsedCount >= Math.min(5, neverUsedIds.length) ? 'YES' : 'NO');
  } catch (e) {
    console.log('FAIL:', String(e));
  }
  console.log();

  // Test 2: Older questions preferred over recently-used questions
  console.log('B3.2 Test 2: Older questions preferred over recently-used');
  try {
    await clearTestQuestions();
    const oldIds = await seedQuestions(3);
    const recentIds = await seedQuestions(3);
    const now = Date.now();
    const db = getDb();
    for (const id of oldIds) {
      db.prepare('INSERT INTO trivia_question_usage (question_id, usage_count, last_used_at, last_match_id, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?)')
        .run(id, now - 86400000, 'match-old', now - 86400000, now - 86400000); // 1 day ago
    }
    for (const id of recentIds) {
      db.prepare('INSERT INTO trivia_question_usage (question_id, usage_count, last_used_at, last_match_id, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?)')
        .run(id, now - 1000, 'match-recent', now - 1000, now - 1000); // 1 sec ago
    }
    const questions = getRandomQuestions(3, { category: 'general', verifiedOnly: true }, []);
    const oldCount = questions.filter(q => oldIds.includes(q.id)).length;
    console.log(`  Selected ${questions.length} questions, ${oldCount} were older-used`);
    console.log('PASS:', oldCount >= Math.min(3, oldIds.length) ? 'YES' : 'NO');
  } catch (e) {
    console.log('FAIL:', String(e));
  }
  console.log();

  // Test 3: Questions used in current match are excluded
  console.log('B3.2 Test 3: Current match excludeIds works');
  try {
    await clearTestQuestions();
    const ids = await seedQuestions(5);
    const excludeIds = ids.slice(0, 2);
    const questions = getRandomQuestions(5, { category: 'general', verifiedOnly: true }, excludeIds);
    const excludedFound = questions.some(q => excludeIds.includes(q.id));
    console.log(`  Selected ${questions.length} questions, excluded found: ${excludedFound}`);
    console.log('PASS:', !excludedFound ? 'YES' : 'NO');
  } catch (e) {
    console.log('FAIL:', String(e));
  }
  console.log();

  // Test 4: Category filtering still works
  console.log('B3.2 Test 4: Category filtering works with rotation');
  try {
    await clearTestQuestions();
    await seedQuestions(3, 'science');
    await seedQuestions(3, 'history');
    const questions = getRandomQuestions(5, { category: 'science', verifiedOnly: true }, []);
    const allScience = questions.every(q => q.category === 'science');
    console.log(`  Selected ${questions.length} questions, all science: ${allScience}`);
    console.log('PASS:', allScience && questions.length > 0 ? 'YES' : 'NO');
  } catch (e) {
    console.log('FAIL:', String(e));
  }
  console.log();

  // Test 5: Difficulty filtering still works
  console.log('B3.2 Test 5: Difficulty filtering works with rotation');
  try {
    await clearTestQuestions();
    await seedQuestions(3, 'general', 'سهل');
    await seedQuestions(3, 'general', 'صعب');
    const questions = getRandomQuestions(5, { category: 'general', difficulty: 'سهل', verifiedOnly: true }, []);
    const allEasy = questions.every(q => q.difficulty === 'سهل');
    console.log(`  Selected ${questions.length} questions, all easy: ${allEasy}`);
    console.log('PASS:', allEasy && questions.length > 0 ? 'YES' : 'NO');
  } catch (e) {
    console.log('FAIL:', String(e));
  }
  console.log();

  // Test 6: Fewer eligible questions than requested - safe behavior
  console.log('B3.2 Test 6: Safe behavior when eligible < requested');
  try {
    await clearTestQuestions();
    await seedQuestions(2);
    const questions = getRandomQuestions(10, { category: 'general', verifiedOnly: true }, []);
    console.log(`  Requested 10, got ${questions.length}`);
    console.log('PASS:', questions.length === 2 ? 'YES' : 'NO');
  } catch (e) {
    console.log('FAIL:', String(e));
  }
  console.log();

  // Test 7: Two consecutive matches don't repeat same set when pool allows
  console.log('B3.2 Test 7: Consecutive matches select different questions');
  try {
    await clearTestQuestions();
    await seedQuestions(10);
    // First match
    const match1 = getRandomQuestions(3, { category: 'general', verifiedOnly: true }, []);
    for (const q of match1) markQuestionAsUsed(q.id, 'match-1');
    // Second match
    const match2 = getRandomQuestions(3, { category: 'general', verifiedOnly: true }, []);
    const overlap = match1.filter(q1 => match2.some(q2 => q2.id === q1.id)).length;
    console.log(`  Match 1: ${match1.map(q => q.id.slice(0,8)).join(', ')}`);
    console.log(`  Match 2: ${match2.map(q => q.id.slice(0,8)).join(', ')}`);
    console.log(`  Overlap: ${overlap}/3`);
    console.log('PASS:', overlap === 0 ? 'YES' : 'NO (some overlap possible with small pool)');
  } catch (e) {
    console.log('FAIL:', String(e));
  }
  console.log();

  // Test 8: Repeated selection eventually rotates through pool fairly
  console.log('B3.2 Test 8: Rotation distributes usage across pool');
  try {
    await clearTestQuestions();
    const ids = await seedQuestions(6);
    const db = getDb();
    const usageBefore: Record<string, number> = {};
    for (const id of ids) {
      usageBefore[id] = 0;
    }
    // Simulate 12 rounds (2 full cycles through 6 questions)
    for (let round = 0; round < 12; round++) {
      const questions = getRandomQuestions(1, { category: 'general', verifiedOnly: true }, []);
      if (questions.length > 0) {
        markQuestionAsUsed(questions[0].id, `match-${round}`);
        usageBefore[questions[0].id]++;
      }
    }
    const counts = Object.values(usageBefore);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    console.log(`  Usage distribution: min=${min}, max=${max}, counts=${counts.join(',')}`);
    console.log('PASS:', max - min <= 1 ? 'YES' : 'NO');
  } catch (e) {
    console.log('FAIL:', String(e));
  }
  console.log();

  // Test 9: Randomness among equal-priority questions
  console.log('B3.2 Test 9: Randomness among equal priority');
  try {
    await clearTestQuestions();
    await seedQuestions(10);
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const questions = getRandomQuestions(1, { category: 'general', verifiedOnly: true }, []);
      if (questions.length > 0) results.add(questions[0].id);
    }
    console.log(`  Unique questions selected in 20 trials: ${results.size}/10`);
    console.log('PASS:', results.size > 3 ? 'YES' : 'NO (should see variety)');
  } catch (e) {
    console.log('FAIL:', String(e));
  }
  console.log();

  // Test 10: markQuestionAsUsed UPSERT behavior
  console.log('B3.2 Test 10: markQuestionAsUsed UPSERT increments count');
  try {
    await clearTestQuestions();
    const ids = await seedQuestions(1);
    const id = ids[0];
    const db = getDb();
    markQuestionAsUsed(id, 'match-1');
    markQuestionAsUsed(id, 'match-2');
    markQuestionAsUsed(id, 'match-3');
    const row = db.prepare('SELECT usage_count, last_match_id FROM trivia_question_usage WHERE question_id = ?').get(id) as { usage_count: number; last_match_id: string } | undefined;
    console.log(`  Usage count: ${row?.usage_count}, last_match_id: ${row?.last_match_id}`);
    console.log('PASS:', row?.usage_count === 3 && row?.last_match_id === 'match-3' ? 'YES' : 'NO');
  } catch (e) {
    console.log('FAIL:', String(e));
  }
  console.log();

  console.log('=== All B3.2 Cross-Match Rotation Tests Complete ===');
}

runB32Tests().catch(err => {
  console.error('B3.2 Tests fatal error:', err);
  process.exit(1);
});