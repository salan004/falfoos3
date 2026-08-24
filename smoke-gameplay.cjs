/* Temporary Phase-3 runtime suite: full gameplay loops for ALL six games (deleted after use). */
const { io } = require('C:/Users/la-su/OneDrive/سطح المكتب/Falfoos Gaming/falfoos3/node_modules/socket.io-client');

const URL = 'http://localhost:4000';
const results = [];
const ok = (name, cond) => {
  results.push([name, !!cond]);
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = io(URL, { transports: ['websocket'] });
const v1 = io(URL, { transports: ['websocket'] });
const v2 = io(URL, { transports: ['websocket'] });

const ev = [];            // ordered [{type,payload}]
let lb = [];              // latest leaderboard entries
const states = {};

function wire(sock, tag) {
  sock.on('game:event', (e) => {
    ev.push({ tag, ...e });
    if (e.type === 'leaderboard:update') lb = e.payload.entries || [];
    if (e.type === 'game:state') states[e.payload.gameId] = e.payload;
  });
}
wire(v1, 'v1'); wire(v2, 'v2');
const last = (type) => [...ev].reverse().find((e) => e.type === type);
const all = (type) => ev.filter((e) => e.type === type);

function chat(author, id, msg, img) {
  v1.emit('chat:message', { author, authorId: id, message: msg, authorImageUrl: img });
}
async function switchGame(id) {
  admin.emit('admin:command', { command: 'switchGame', payload: id });
  await sleep(700);
}
async function main() {
  const AV = 'https://yt3.ggpht.com/avatar-x.jpg';
  // ============================== TRIVIA ==============================
  await switchGame('trivia');
  chat('Sara', 't-sara', '\u200E! انضم', AV);
  chat('Omar', 't-omar', '!انضم');
  chat('Lina', 't-lina', '!انضم');
  chat('Ziad', 't-ziad', '!انضم');
  await sleep(500);
  ok('TRIVIA: roster joined with avatars', (states.trivia?.players || []).length === 4 && states.trivia.players[0].avatarUrl === AV);
  admin.emit('admin:command', { command: 'trivia:setRounds', payload: 2 });
  admin.emit('admin:command', { command: 'trivia:setTimer', payload: 2 });
  admin.emit('admin:command', { command: 'trivia:start', payload: 'all' });
  // Round 1: wait through 5s show phase, then cover all four choices
  await sleep(5800);
  const q1Open = last('trivia:answerOpen');
  ok('TRIVIA: answer phase opened with ticking timer', !!q1Open && typeof states.trivia.timeLeft === 'number');
  chat('Sara', 't-sara', '1'); chat('Omar', 't-omar', '2'); chat('Lina', 't-lina', '3'); chat('Ziad', 't-ziad', '4');
  // Timer ticks down (2s) -> reveal
  await sleep(2600);
  const rev1 = last('trivia:answerRevealed');
  ok('TRIVIA: reveal fired with correctAnswer', !!rev1 && !!rev1.payload.correctAnswer);
  const correctIdx1 = parseInt(rev1?.payload?.correctAnswer || '0', 10);
  const scorers1 = ['t-sara', 't-omar', 't-lina', 't-ziad'][correctIdx1 - 1];
  await sleep(200);
  const scorerEntry = lb.find((x) => x.playerId === scorers1);
  ok('TRIVIA: correct answerer scored 100+ pts, others did not', !!scorerEntry && scorerEntry.score >= 100 && lb.filter((x) => x.score > 0).length === 1);
  // Round 2 runs automatically (~5s show + 2s answer + 5s pause) -> finish
  await sleep(16500);
  ok('TRIVIA: second round played and game finished', !!last('trivia:finished') && states.trivia.phase === 'finished');

  // ========================== MUSICAL CHAIRS ==========================
  await switchGame('musical_chairs');
  chat('Ava', 'mc-a', '!انضم', AV);
  chat('Ben', 'mc-b', '!دخول');
  chat('Cid', 'mc-c', '!انضم');
  await sleep(600);
  admin.emit('admin:command', { command: 'mc:closeLobby' });
  await sleep(400);
  ok('MC: lobby closed -> playing, chairs=n-1', states.musical_chairs.phase === 'playing' && states.musical_chairs.chairsAvailable === 2 && states.musical_chairs.currentRound === 1);
  admin.emit('admin:command', { command: 'mc:startSeating' });
  await sleep(300);
  ok('MC: music stopped event', !!last('mc:musicStopped'));
  chat('Ava', 'mc-a', '!جلوس'); await sleep(250);
  chat('Ben', 'mc-b', '!جلوس'); await sleep(1600); // fill 2/2 -> 1s grace fires endSeating
  const re1 = last('mc:roundEnded');
  ok('MC: unfilled player eliminated exactly once', !!re1 && re1.payload.eliminated.length === 1 && re1.payload.eliminated[0].displayName === 'Cid');
  ok('MC: round advanced to 2 with 1 chair', states.musical_chairs.currentRound === 2 && states.musical_chairs.chairsAvailable === 1);
  // Race regression: fast fill must not double-eliminate
  admin.emit('admin:command', { command: 'mc:startSeating' });
  await sleep(300);
  chat('Ava', 'mc-a', '!جلوس');
  await sleep(1800);
  ok('MC: RACE FIX — single elimination decided winner (no double run)', states.musical_chairs.phase === 'finished' && states.musical_chairs.winner === 'mc-a' && states.musical_chairs.players.filter((p) => p.eliminated).length === 2);
  ok('MC: gameOver broadcast', !!last('mc:gameOver'));

  // =============================== MAFIA ===============================
  await switchGame('mafia');
  admin.emit('admin:command', { command: 'mafia:updateSettings', payload: { nightDuration: 10, dayDuration: 10, votingDuration: 10 } });
  await sleep(300);
  for (const n of ['Ala', 'Bil', 'Cis', 'Dan', 'Edo']) chat(n, 'mf-' + n.toLowerCase(), '!انضم');
  await sleep(600);
  admin.emit('admin:command', { command: 'mafia:start' }); // open lobby->? already lobby? idle->start opens; second needed to begin
  await sleep(300);
  admin.emit('admin:command', { command: 'mafia:start' });
  await sleep(500);
  const ra = last('mafia:rolesAssigned');
  ok('MAFIA: roles assigned (5p: 1 mafia + detective)', !!ra && ra.payload.playerCount === 5 && ra.payload.hasDetective === true);
  ok('MAFIA: night 1 started, roles hidden from public state', states.mafia.phase === 'playing' && states.mafia.nightPhase === true && states.mafia.players.every((p) => p.role === 'مجهول'));
  // STALE-VOTING regression: a !صوت during Night must NOT register a vote
  chat('Bil', 'mf-bil', '!صوت Ala');
  await sleep(300);
  ok('MAFIA: vote during Night rejected (stale-voting fix holds)', (states.mafia.votedCount || 0) === 0);
  admin.emit('admin:command', { command: 'mafia:nextPhase' }); // resolve empty night -> Day
  await sleep(300);
  ok('MAFIA: night resolved -> day 1, nobody eliminated', states.mafia.nightPhase === false && !!last('mafia:dayStarted'));
  admin.emit('admin:command', { command: 'mafia:nextPhase' }); // start voting
  await sleep(300);
  ok('MAFIA: voting opened', !!last('mafia:votingStarted') && states.mafia.votingStartTime > 0);
  chat('Bil', 'mf-bil', '!صوت Ala'); chat('Cis', 'mf-cis', '!صوت Ala'); chat('Dan', 'mf-dan', '! صوت ala'); chat('Edo', 'mf-edo', '!صوت Bil');
  await sleep(500);
  if (states.mafia.votedCount !== 4) {
    console.log('DEBUG mafia state:', JSON.stringify(states.mafia, null, 1).slice(0, 900));
    console.log('DEBUG vote-related events:', JSON.stringify(ev.filter((e) => e.type.includes('mafia')).slice(-8), null, 1).slice(0, 1200));
  }
  ok('MAFIA: votes registered live (votedCount=4)', states.mafia.votedCount === 4);
  admin.emit('admin:command', { command: 'mafia:nextPhase' }); // resolve voting
  await sleep(400);
  const vr1 = last('mafia:votingResult');
  ok('MAFIA: vote result — Ala eliminated with 3 votes', !!vr1 && vr1.payload.eliminated === 'Ala' && !vr1.payload.tie);
  // Ala was mafia OR citizen; either way win-check runs. Loop rounds via nextPhase until gameOver (cap 6 phases).
  let guard = 0;
  while (states.mafia.phase !== 'finished' && guard++ < 8) {
    admin.emit('admin:command', { command: 'mafia:nextPhase' });
    await sleep(350);
    // During any night, ensure stray votes never count (fix regression sweep)
    if (states.mafia.nightPhase) { chat('Bil', 'mf-bil', '!صوت Cis'); await sleep(120); }
  }
  const go = last('mafia:gameOver');
  ok('MAFIA: reached Game Over with winner declared', states.mafia.phase === 'finished' && !!go && ['mafia', 'citizens'].includes(go.payload.winner));
  ok('MAFIA: roles fully revealed at game over', states.mafia.players.length === 5 && states.mafia.players.every((p) => p.role !== 'مجهول'));

  // ============================= GUESSING =============================
  await switchGame('guessing');
  chat('Sara', 'g-sara', '!انضم', AV);
  await sleep(400);
  admin.emit('admin:command', { command: 'guessing:setAnswer', payload: 'cairo' });
  await sleep(400);
  ok('GUESSING: setAnswer auto-starts; secret hidden from clients', states.guessing.phase === 'playing' && states.guessing.answer === '');
  chat('Omar', 'g-omar', '!guess beirut');
  await sleep(300);
  ok('GUESSING: wrong guess ignored (still secret)', !states.guessing.winner && states.guessing.answer === '');
  chat('Sara', 'g-sara', '! guess CAIRO ');
  await sleep(400);
  if (!(!!last('guessing:winner') && states.guessing.winner === 'Sara' && states.guessing.answer === 'cairo' && lb.find((x) => x.playerId === 'g-sara')?.score === 200)) {
    console.log('DEBUG guessing state:', JSON.stringify(states.guessing));
    console.log('DEBUG guessing events:', JSON.stringify(ev.filter((e) => e.type.startsWith('guessing')).slice(-5)));
    console.log('DEBUG lb:', JSON.stringify(lb.filter((x) => x.score > 0)));
  }
  ok('GUESSING: correct guess wins, answer revealed, scored 200', !!last('guessing:winner') && states.guessing.winner === 'Sara' && states.guessing.answer === 'cairo' && lb.find((x) => x.playerId === 'g-sara')?.score === 200);

  // ============================= DRAWING =============================
  await switchGame('drawing');
  chat('Dana', 'dr-dana', '!انضم', AV);
  await sleep(400);
  admin.emit('admin:command', { command: 'drawing:setWord', payload: 'tiger' });
  await sleep(400);
  ok('DRAWING: setWord auto-starts; word hidden from clients', states.drawing.phase === 'playing' && states.drawing.currentWord === '');
  chat('Dana', 'dr-dana', '!draw B5 red');
  await sleep(300);
  const px = last('drawing:pixelUpdate');
  ok('DRAWING: pixel painted + drawer auto-registered', !!px && px.payload.row === 4 && px.payload.col === 1 && px.payload.color === 'red' && (states.drawing.participants || []).some((p) => p.id === 'dr-dana' && p.avatarUrl === AV));
  chat('Evan', 'dr-evan', '!guess cat');
  await sleep(300);
  ok('DRAWING: wrong word guess ignored (word still hidden)', !states.drawing.wordAnswered && states.drawing.currentWord === '');
  chat('Evan', 'dr-evan', '!guess TIGER');
  await sleep(400);
  const wg = last('drawing:wordGuessed');
  ok('DRAWING: correct guess -> winner + revealed word + 150 pts', !!wg && states.drawing.wordAnswered === true && states.drawing.currentWord === 'tiger' && states.drawing.wordWinner === 'Evan' && lb.find((x) => x.playerId === 'dr-evan')?.score === 150);

  // ============================ HIDE AND SEEK ============================
  await switchGame('hide_and_seek');
  chat('Poe', 'hs-poe', '!انضم', AV);
  chat('Quinn', 'hs-quinn', '!انضم');
  await sleep(500);
  ok('H&S: lobby auto-opened, Arabic name served', states.hide_and_seek.phase === 'lobby' && states.hide_and_seek.players.length === 2);
  chat('Poe', 'hs-poe', '!hide A1');
  chat('Quinn', 'hs-quinn', '!hide B2');
  await sleep(400);
  ok('H&S: both hidden in zones', all('hs:playerHidden').length >= 2 && states.hide_and_seek.players.filter((p) => p.zone).length === 2);
  admin.emit('admin:command', { command: 'hs:searchZone', payload: 'c3' });
  await sleep(300);
  ok('H&S: empty-zone search reports safe', last('hs:zoneSearched').payload.zone === 'C3' && last('hs:zoneSearched').payload.caught.length === 0);
  admin.emit('admin:command', { command: 'hs:searchZone', payload: 'A1' });
  await sleep(300);
  ok('H&S: hit search catches the hider', last('hs:zoneSearched').payload.caught.includes('Poe') && states.hide_and_seek.players.find((p) => p.id === 'hs-poe').isCaught === true);
  admin.emit('admin:command', { command: 'hs:searchZone', payload: 'A1' });
  await sleep(300);
  ok('H&S: duplicate search deduped', states.hide_and_seek.searchedZones.filter((z) => z === 'A1').length === 1);
  chat('Rami', 'hs-rami', '!hide D4'); // never joined
  await sleep(300);
  ok('H&S: hide-before-join rejected with hint', all('game:joinRejected').some((j) => j.payload.reason === 'notJoined' && j.payload.gameId === 'hide_and_seek'));

  const passed = results.filter((x) => x[1]).length;
  console.log('\nSUMMARY: ' + passed + '/' + results.length + ' checks passed');
  [admin, v1, v2].forEach((s) => s.close());
  process.exit(passed === results.length ? 0 : 1);
}

setTimeout(() => { console.error('TIMEOUT'); process.exit(3); }, 150000);
main();
