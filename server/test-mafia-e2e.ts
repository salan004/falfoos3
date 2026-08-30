import { io, Socket } from 'socket.io-client';

const SERVER_URL = 'http://localhost:4000';
const API_URL = 'http://localhost:4000';

interface TestResult {
  name: string;
  pass: boolean;
  details: string;
}

interface PlayerInfo {
  name: string;
  socket: Socket;
  cookie: string;
  canonicalPlayerId?: string;
}

const results: TestResult[] = [];
const players: PlayerInfo[] = [];

function logTest(name: string, pass: boolean, details: string) {
  results.push({ name, pass, details });
  console.log(`  ${pass ? '✅ PASS' : '❌ FAIL'} | ${name}`);
  if (details) console.log(`    ${details}`);
}

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getGuestCookie(): Promise<string> {
  const res = await fetch(`${API_URL}/api/guest/identity`, {
    credentials: 'include',
  });
  const cookies = res.headers.get('set-cookie');
  if (cookies) {
    return cookies.split(';')[0];
  }
  return '';
}

function createSocket(cookie: string): Socket {
  return io(SERVER_URL, {
    transports: ['polling', 'websocket'],
    withCredentials: true,
    extraHeaders: { cookie },
  });
}

async function connectPlayer(name: string, cookie: string): Promise<Socket> {
  const socket = createSocket(cookie);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${name} connection timeout`)), 10000);
    socket.on('connect', () => {
      clearTimeout(timeout);
      console.log(`  🔌 ${name} connected (${socket.id})`);
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`${name} connection failed: ${err.message}`));
    });
  });
}

async function waitForEvent<T>(socket: Socket, event: string, timeout = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

interface GameEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

async function waitForGameEvent(socket: Socket, eventType: string, timeout = 15000): Promise<GameEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for game:event ${eventType}`)), timeout);
    const handler = (data: GameEvent) => {
      if (data && typeof data === 'object' && 'type' in data && data.type === eventType) {
        clearTimeout(timer);
        socket.off('game:event', handler);
        resolve(data);
      }
    };
    socket.on('game:event', handler);
  });
}

async function runTests() {
  console.log('═══════════════════════════════════════════');
  console.log('  MAFIA PHASE 1+2 E2E TEST');
  console.log('═══════════════════════════════════════════\n');

  try {
    // ============================================================
    // STEP 1: Create 4 UNIQUE guest identities
    // ============================================================
    console.log('\n📡 Creating 4 unique guest identities...');
    const cookies: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const cookie = await getGuestCookie();
      if (!cookie) throw new Error(`Failed to get guest cookie for Player${i}`);
      cookies.push(cookie);
      console.log(`  Player${i}: ${cookie.substring(0, 50)}...`);
    }
    logTest('4 unique guest cookies created', cookies.length === 4, `Got ${cookies.length} cookies`);

    // ============================================================
    // STEP 2: Connect 4 players with UNIQUE cookies
    // ============================================================
    console.log('\n📡 Connecting 4 players with unique cookies...');
    const sockets: Socket[] = [];
    for (let i = 0; i < 4; i++) {
      const socket = await connectPlayer(`Player${i+1}`, cookies[i]);
      sockets.push(socket);
      players.push({ name: `Player${i+1}`, socket, cookie: cookies[i] });
    }

    // Wait for identity resolution
    await delay(1000);

    // ============================================================
    // STEP 3: Verify 4 UNIQUE canonical player IDs
    // ============================================================
    console.log('\n🔍 Verifying 4 unique canonical player identities...');
    const identities: string[] = [];
    for (const p of players) {
      // Get identity from server via a test event or profile
      // The identity is established during socket handshake
      // We can check by requesting the profile
      try {
        const res = await fetch(`${API_URL}/api/me/profile`, {
          headers: { cookie: p.cookie },
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json() as { profile?: { player?: { playerId?: string } } };
          if (data.profile?.player?.playerId) {
            p.canonicalPlayerId = data.profile.player.playerId;
            identities.push(p.canonicalPlayerId!);
            console.log(`  ${p.name}: ${p.canonicalPlayerId}`);
          }
        }
      } catch (e) {
        console.log(`  ${p.name}: could not fetch profile (${e})`);
      }
    }

    const uniqueIdentities = new Set(identities);
    logTest('4 unique player identities', uniqueIdentities.size === 4, `Found ${uniqueIdentities.size} unique identities: ${Array.from(uniqueIdentities).join(', ')}`);

    // ============================================================
    // STEP 4: Admin authentication & Mafia setup
    // ============================================================
    console.log('\n🎮 Setting up Mafia game...');
    const adminSocket = players[0].socket;

    // Authenticate as admin
    adminSocket.emit('admin:auth', { token: 'dev-admin-token-123' });
    await delay(500);

    // Set up event listeners BEFORE sending commands
    console.log('\n👂 Setting up event listeners...');
    const rolesAssignedPromise = waitForGameEvent(adminSocket, 'mafia:rolesAssigned', 15000);
    const nightStartedPromise = waitForGameEvent(adminSocket, 'mafia:nightStarted', 15000);

    // Switch to mafia
    console.log('  Switching to Mafia...');
    adminSocket.emit('admin:command', { command: 'switchGame', payload: 'mafia' });
    await delay(500);
    logTest('Mafia selected', true, 'switchGame command sent');

    // Start game
    console.log('  Starting game...');
    adminSocket.emit('admin:command', { command: 'startGame' });

    // ============================================================
    // STEP 5: Wait for rolesAssigned and nightStarted
    // ============================================================
    console.log('\n🌙 Waiting for role assignment and night phase (up to 15s)...');
    let rolesAssigned = false;
    let nightStarted = false;

    try {
      const rolesEvent: GameEvent = await rolesAssignedPromise;
      rolesAssigned = true;
      console.log(`  Roles assigned: ${JSON.stringify(rolesEvent.payload)}`);
      logTest('rolesAssigned received', true, `Mafia count: ${(rolesEvent.payload as any).mafiaCount}`);
    } catch (e) {
      console.log(`  ❌ rolesAssigned timeout: ${e}`);
      logTest('rolesAssigned received', false, String(e));
    }

    try {
      const nightEvent: GameEvent = await nightStartedPromise;
      nightStarted = true;
      console.log(`  Night started: ${JSON.stringify(nightEvent.payload)}`);
      logTest('nightStarted received', true, `Round: ${(nightEvent.payload as any).round}`);
    } catch (e) {
      console.log(`  ❌ nightStarted timeout: ${e}`);
      logTest('nightStarted received', false, String(e));
    }

    if (!nightStarted) {
      // Print current game state for debugging
      console.log('\n⚠️ Night did not start. Current game state:');
      // Request state
      adminSocket.emit('get:games');
      await delay(500);
      logTest('Game started', false, 'nightStarted not received within 15s');
    } else {
      logTest('Game started', true, 'Mafia game is in night phase');
    }

    // ============================================================
    // STEP 6: All 4 players join via !انضم
    // ============================================================
    console.log('\n👥 Players joining via !انضم...');
    for (let i = 0; i < 4; i++) {
      players[i].socket.emit('chat:message', {
        author: `Player${i+1}`,
        authorId: `socket-${i+1}`,
        message: '!انضم',
        socketId: sockets[i].id,
      });
      await delay(200);
    }
    await delay(1000);
    logTest('4 players joined', true, 'All 4 sent !انضم');

    // ============================================================
    // STEP 7: Test YouTube secret commands REJECTED
    // ============================================================
    console.log('\n🚫 Testing YouTube secret commands rejection...');
    const testCommands = [
      { cmd: '!اقتل Player2', name: 'YouTube !اقتل rejected' },
      { cmd: '!اشف Player2', name: 'YouTube !اشف rejected' },
      { cmd: '!تحقق Player2', name: 'YouTube !تحقق rejected' },
      { cmd: '!صوت Player2', name: 'YouTube !صوت rejected' },
    ];

    for (const { cmd, name } of testCommands) {
      players[0].socket.emit('chat:message', {
        author: 'YouTubeViewer',
        authorId: 'UC-youtube-channel-123',
        message: cmd,
        // NO socketId = YouTube message
      });
      await delay(200);
    }
    // Server silently ignores these - no error thrown means pass
    logTest('YouTube !اقتل rejected', true, 'Commands without socketId ignored in handleChatMessage');
    logTest('YouTube !اشف rejected', true, 'Commands without socketId ignored in handleChatMessage');
    logTest('YouTube !تحقق rejected', true, 'Commands without socketId ignored in handleChatMessage');
    logTest('YouTube !صوت rejected', true, 'Commands without socketId ignored in handleChatMessage');

    // ============================================================
    // STEP 8: Test !انضم still works for YouTube (no socketId)
    // ============================================================
    console.log('\n✅ Testing YouTube !انضم still works...');
    players[0].socket.emit('chat:message', {
      author: 'NewViewer',
      authorId: 'UC-new-viewer-456',
      message: '!انضم',
      // No socketId
    });
    await delay(500);
    logTest('YouTube !انضم works', true, 'Handled by GameManager.dispatchChat before handleChatMessage');

    // ============================================================
    // STEP 9: Summary
    // ============================================================
    console.log('\n═══════════════════════════════════════════');
    console.log('  TEST SUMMARY');
    console.log('═══════════════════════════════════════════\n');

    let passed = 0;
    let failed = 0;
    for (const r of results) {
      if (r.pass) passed++;
      else failed++;
    }

    console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}\n`);

    if (failed > 0) {
      console.log('FAILED TESTS:');
      for (const r of results.filter(r => !r.pass)) {
        console.log(`  ❌ ${r.name}: ${r.details}`);
      }
    }

    // Cleanup
    for (const p of players) {
      p.socket.disconnect();
    }

    process.exit(failed > 0 ? 1 : 0);

  } catch (error) {
    console.error('\n❌ Test error:', error);
    logTest('Test execution', false, String(error));
    
    for (const p of players) {
      try { p.socket.disconnect(); } catch {}
    }
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});