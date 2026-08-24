import { BaseGame, GameConfig, ChatMessage, GamePhase, GameSettingDefinition, GameSettingsSchema, PlayerIdentity } from '../core/BaseGame';
import { normalizeChatCommand } from '../core/chatCommands';
import { Server as SocketIOServer } from "socket.io";

type Role = "mafia" | "doctor" | "detective" | "citizen";

interface MafiaPlayer {
  id: string;
  displayName: string;
  avatarUrl?: string;
  role: Role;
  isAlive: boolean;
  hasVoted: boolean;
  nightAction: NightAction | null;
}

interface NightAction {
  type: "kill" | "heal" | "investigate";
  targetId: string;
}

interface Vote {
  voterId: string;
  targetId: string;
}

interface MafiaState {
  phase: GamePhase;
  players: MafiaPlayer[];
  nightPhase: boolean;
  eliminatedToday: string | null;
  nightActions: Map<string, NightAction>;
  votes: Vote[];
  dayStartTime: number;
  votingStartTime: number;
  nightStartTime: number;
  winner: "mafia" | "citizens" | null;
  round: number;
  timerDuration: number;
  phaseTimer: NodeJS.Timeout | null;
  gameStartTime: number;
}

interface PlayerSocketMap {
  [playerId: string]: string;
}

function getRoleDistribution(playerCount: number): Role[] {
  const roles: Role[] = [];
  
  if (playerCount >= 15) {
    roles.push("mafia", "mafia", "mafia", "doctor", "detective");
  } else if (playerCount >= 12) {
    roles.push("mafia", "mafia", "doctor", "detective");
  } else if (playerCount >= 9) {
    roles.push("mafia", "mafia", "detective");
  } else if (playerCount >= 7) {
    roles.push("mafia", "doctor", "detective");
  } else if (playerCount >= 5) {
    roles.push("mafia", "detective");
  } else {
    roles.push("mafia");
  }
  
  while (roles.length < playerCount) {
    roles.push("citizen");
  }
  
  return roles;
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const MAFIA_SETTINGS_SCHEMA: GameSettingsSchema = {
  gameId: "mafia",
  settings: [
    {
      key: "minPlayers",
      label: "Minimum Players",
      labelAr: "الحد الأدنى للاعبين",
      type: "number",
      default: 4,
      min: 4,
      max: 20,
      step: 1,
    },
    {
      key: "maxPlayers",
      label: "Maximum Players",
      labelAr: "الحد الأقصى للاعبين",
      type: "number",
      default: 20,
      min: 4,
      max: 20,
      step: 1,
    },
    {
      key: "nightDuration",
      label: "Night Duration",
      labelAr: "مدة الليل",
      type: "number",
      default: 30,
      min: 10,
      max: 120,
      step: 5,
    },
    {
      key: "dayDuration",
      label: "Discussion Duration",
      labelAr: "مدة النقاش",
      type: "number",
      default: 45,
      min: 15,
      max: 180,
      step: 5,
    },
    {
      key: "votingDuration",
      label: "Voting Duration",
      labelAr: "مدة التصويت",
      type: "number",
      default: 30,
      min: 10,
      max: 120,
      step: 5,
    },
  ],
};

export class MafiaGame extends BaseGame {
  readonly config: GameConfig = {
    id: "mafia",
    name: "مافيا",
    description: "اكتب !انضم للانضمام. يتم توزيع الأدوار سراً. صوّت لإقصاء المشتبه بهم في مرحلة النهار.",
    minPlayers: 4,
    maxPlayers: 20,
    settingsSchema: MAFIA_SETTINGS_SCHEMA,
  };

  state: MafiaState = this.initialState();
  private gameManagerRef: { updateScore: (pid: string, name: string, delta: number) => void } | null = null;
  private timers: NodeJS.Timeout[] = [];
  private io: SocketIOServer | null = null;
  private playerSocketMap: PlayerSocketMap = {};

  constructor(gameManager: { updateScore: (pid: string, name: string, delta: number) => void }, io?: SocketIOServer) {
    super();
    this.gameManagerRef = gameManager;
    this.io = io ?? null;
    this.setEditableSettings({
      minPlayers: 4,
      maxPlayers: 20,
      nightDuration: 30,
      dayDuration: 45,
      votingDuration: 30,
    });
  }

  setSocketServer(io: SocketIOServer): void {
    this.io = io;
  }

  private registerPlayerSocket(playerId: string, socketId: string): void {
    this.playerSocketMap[playerId] = socketId;
  }

  private getPlayerSocketId(playerId: string): string | undefined {
    return this.playerSocketMap[playerId];
  }

  private initialState(): MafiaState {
    return {
      phase: "idle",
      players: [],
      nightPhase: false,
      eliminatedToday: null,
      nightActions: new Map(),
      votes: [],
      dayStartTime: 0,
      votingStartTime: 0,
      nightStartTime: 0,
      winner: null,
      round: 0,
      timerDuration: 0,
      phaseTimer: null,
      gameStartTime: 0,
    };
  }

  init(): void {
    this.newSessionId();
    this.reset();
    this.broadcastGameState();
  }

  start(): void {
    if (this.state.phase !== "idle") return;
    this.state.phase = "lobby";
    this.state.gameStartTime = Date.now();
    this.broadcast({ type: "mafia:lobbyOpened", payload: {}, timestamp: Date.now() });
    this.broadcastGameState();
  }

  stop(): void {
    this.clearAllTimers();
    this.state.phase = "idle";
    this.broadcastGameState();
  }

  reset(): void {
    this.clearAllTimers();
    this.clearMatchSettings();
    this.state = this.initialState();
  }

  handleChatMessage(msg: ChatMessage): void {
    const player = this.state.players.find(p => p.id === msg.authorId);

    if (this.state.phase !== "playing") return;
    if (!player) return;
    if (!player.isAlive) return;

    if (this.state.nightPhase) {
      this.handleNightAction(msg, player);
    } else {
      this.handleVote(msg, player);
    }
  }

  handleAdminCommand(command: string, payload?: unknown): void {
    switch (command) {
      case "mafia:start":
        if (this.state.phase === "idle") {
          this.start();
        } else if (this.state.phase === "lobby") {
          this.startGame();
        }
        break;
      case "mafia:updateSettings":
        if (this.state.phase === "idle" || this.state.phase === "lobby") {
          this.updateSettings(payload as Record<string, unknown>);
        }
        break;
      case "mafia:nextPhase":
        this.advancePhase();
        break;
      case "mafia:reset":
        this.reset();
        this.init();
        break;
      case "mafia:forceEnd":
        this.endGame();
        break;
    }
  }

  private updateSettings(settings: Record<string, unknown>): void {
    if (this.state.phase === "playing") {
      return;
    }

    const schema = this.getSettingsSchema();
    const errors: string[] = [];

    for (const [key, value] of Object.entries(settings)) {
      const settingDef = schema.settings.find(s => s.key === key);
      if (!settingDef) continue;

      if (settingDef.type === "number" && typeof value === "number") {
        if (settingDef.min !== undefined && value < settingDef.min) {
          errors.push(settingDef.labelAr + ": يجب أن تكون القيمة " + settingDef.min + " أو أكبر");
        }
        if (settingDef.max !== undefined && value > settingDef.max) {
          errors.push(settingDef.labelAr + ": يجب أن تكون القيمة " + settingDef.max + " أو أقل");
        }
      }

      if (settingDef.validation) {
        const currentSettings = { ...this.getEditableSettings(), ...settings };
        const error = settingDef.validation(value, currentSettings);
        if (error) errors.push(error);
      }
    }

    if (errors.length > 0) {
      this.broadcast({
        type: "mafia:settingsError",
        payload: { errors },
        timestamp: Date.now(),
      });
      return;
    }

    this.setEditableSettings({ ...this.getEditableSettings(), ...settings });

    this.broadcast({
      type: "mafia:settingsUpdated",
      payload: { settings: this.getEditableSettings() },
      timestamp: Date.now(),
    });
  }

  private rejectJoin(
    identity: { authorId: string; displayName: string },
    reason: "gameInProgress" | "lobbyFull",
    message: string
  ): void {
    this.broadcast({
      type: "game:joinRejected",
      payload: {
        gameId: this.config.id,
        playerId: identity.authorId,
        displayName: identity.displayName,
        reason,
        message,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * Global !انضم entry point (routed by GameManager).
   * Root-cause fix retained: Mafia sits in "idle" right after becoming the
   * active game (switchGame -> init -> reset) while the lobby UI already
   * invites viewers to join — so the first !انضم opens the lobby automatically.
   * Admin mafia:start still works exactly as before.
   */
  handleJoinCommand(identity: PlayerIdentity): void {
    if (this.state.phase === "idle") {
      this.start();
    }

    if (this.state.phase !== "lobby") {
      this.rejectJoin(identity, "gameInProgress", "اللعبة بدأت بالفعل، لا يمكن الانضمام الآن.");
      return;
    }

    const maxPlayers = this.getEffectiveSetting("maxPlayers") as number;

    const existing = this.state.players.find(p => p.id === identity.authorId);
    if (existing) {
      this.sendPrivateMessage(identity.authorId, "أنت منضم بالفعل للعبة.");
      return;
    }

    if (this.state.players.length >= maxPlayers) {
      this.sendPrivateMessage(identity.authorId, "اللعبة ممتلئة، لا يمكن الانضمام حالياً.");
      this.rejectJoin(identity, "lobbyFull", "اللعبة ممتلئة، لا يمكن الانضمام حالياً.");
      return;
    }

    const newPlayer: MafiaPlayer = {
      id: identity.authorId,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      role: "citizen",
      isAlive: true,
      hasVoted: false,
      nightAction: null,
    };

    this.state.players.push(newPlayer);

    if (identity.socketId) {
      this.registerPlayerSocket(identity.authorId, identity.socketId);
    }

    this.broadcast({
      type: "game:playerJoined",
      payload: {
        gameId: this.config.id,
        playerId: identity.authorId,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        playerCount: this.state.players.length,
      },
      timestamp: Date.now(),
    });

    this.broadcastGameState();
  }

  private startGame(): void {
    if (this.state.phase !== "lobby") return;

    const alivePlayers = this.state.players.filter(p => p.isAlive);
    const minPlayers = this.getEffectiveSetting("minPlayers") as number;
    if (alivePlayers.length < minPlayers) {
      this.broadcast({
        type: "mafia:notEnoughPlayers",
        payload: { count: alivePlayers.length, required: minPlayers },
        timestamp: Date.now(),
      });
      return;
    }

    this.setMatchSettings(this.getEditableSettings());

    this.assignRoles();
    this.state.phase = "playing";
    this.state.round = 1;
    this.startNightPhase();
  }

  private assignRoles(): void {
    const alivePlayers = this.state.players.filter(p => p.isAlive);
    const roles = getRoleDistribution(alivePlayers.length);
    const shuffledRoles = shuffleArray(roles);

    alivePlayers.forEach((player, index) => {
      player.role = shuffledRoles[index];
      player.nightAction = null;
    });

    this.broadcast({
      type: "mafia:rolesAssigned",
      payload: { 
        playerCount: alivePlayers.length,
        mafiaCount: roles.filter(r => r === "mafia").length,
        hasDoctor: roles.includes("doctor"),
        hasDetective: roles.includes("detective"),
      },
      timestamp: Date.now(),
    });

    this.sendRoleReveals();
  }

  private sendRoleReveals(): void {
    for (const player of this.state.players) {
      if (!player.isAlive) continue;
      
      const roleNames: Record<Role, string> = {
        mafia: "مافيا",
        doctor: "طبيب",
        detective: "محقق",
        citizen: "مواطن",
      };

      const roleDesc: Record<Role, string> = {
        mafia: "أنت من المافيا. في الليل، اكتب !اقتل <اسم> لإقصاء لاعب.",
        doctor: "أنت الطبيب. في الليل، اكتب !اشف <اسم> لحماية لاعب.",
        detective: "أنت المحقق. في الليل، اكتب !تحقق <اسم> لمعرفة ما إذا كان مافيا.",
        citizen: "أنت مواطن بريء. ليس لديك إجراء ليلي.",
      };

      this.sendPrivateMessage(player.id, "دورك: " + roleNames[player.role] + ". " + roleDesc[player.role]);
    }

    const mafiaPlayers = this.state.players.filter(p => p.role === "mafia" && p.isAlive);
    if (mafiaPlayers.length > 1) {
      const mafiaNames = mafiaPlayers.map(p => p.displayName).join("، ");
      for (const mafia of mafiaPlayers) {
        this.sendPrivateMessage(mafia.id, "زملاؤك في المافيا: " + mafiaNames);
      }
    }
  }

  private startNightPhase(): void {
    this.state.nightPhase = true;
    this.state.nightActions.clear();
    this.state.votes = [];
    this.state.votingStartTime = 0;
    this.state.eliminatedToday = null;
    this.state.nightStartTime = Date.now();

    const nightDuration = (this.getEffectiveSetting("nightDuration") as number) * 1000;
    this.state.timerDuration = nightDuration;

    for (const player of this.state.players) {
      if (player.isAlive) {
        player.hasVoted = false;
        player.nightAction = null;
      }
    }

    this.broadcast({
      type: "mafia:nightStarted",
      payload: { 
        round: this.state.round,
        duration: nightDuration,
        alivePlayers: this.getAlivePlayerInfos(),
      },
      timestamp: Date.now(),
    });

    this.broadcastGameState();

    this.state.phaseTimer = this.scheduleTimer(() => {
      this.resolveNightPhase();
    }, nightDuration);
  }

  private handleNightAction(msg: ChatMessage, player: MafiaPlayer): void {
    if (!this.state.nightPhase) return;

    const text = normalizeChatCommand(msg.message);
    let action: NightAction | null = null;

    if (player.role === "mafia") {
      const killMatch = text.match(/^!\s*(?:اقتل|kill)\s+(.+)$/i);
      if (killMatch) {
        const targetName = killMatch[1].trim();
        const target = this.findPlayerByName(targetName);
        if (target && target.isAlive && target.id !== player.id) {
          action = { type: "kill", targetId: target.id };
        }
      }
    } else if (player.role === "doctor") {
      const healMatch = text.match(/^!\s*(?:اشف|heal)\s+(.+)$/i);
      if (healMatch) {
        const targetName = healMatch[1].trim();
        const target = this.findPlayerByName(targetName);
        if (target && target.isAlive) {
          action = { type: "heal", targetId: target.id };
        }
      }
    } else if (player.role === "detective") {
      const checkMatch = text.match(/^!\s*(?:تحقق|check)\s+(.+)$/i);
      if (checkMatch) {
        const targetName = checkMatch[1].trim();
        const target = this.findPlayerByName(targetName);
        if (target && target.isAlive && target.id !== player.id) {
          action = { type: "investigate", targetId: target.id };
        }
      }
    }

    if (!action) {
      this.sendPrivateMessage(player.id, "أمر غير صحيح أو هدف غير صالح. تأكد من الصيغة والهدف.");
      return;
    }

    if (this.state.nightActions.has(player.id)) {
      this.sendPrivateMessage(player.id, "لقد قمت بإجراء ليلي بالفعل.");
      return;
    }

    this.state.nightActions.set(player.id, action);
    player.nightAction = action;

    const actionNames: Record<NightAction["type"], string> = {
      kill: "قتل",
      heal: "شفاء",
      investigate: "تحقيق",
    };

    this.sendPrivateMessage(player.id, "تم تسجيل إجراءك: " + actionNames[action.type] + " " + this.getPlayerName(action.targetId));

    this.checkNightActionsComplete();
  }

  private checkNightActionsComplete(): void {
    const aliveSpecialRoles = this.state.players.filter(
      p => p.isAlive && ["mafia", "doctor", "detective"].includes(p.role)
    );

    const requiredActions = aliveSpecialRoles.length;
    const completedActions = this.state.nightActions.size;

    if (completedActions >= requiredActions) {
      this.resolveNightPhase();
    }
  }

  private resolveNightPhase(): void {
    if (this.state.phaseTimer) {
      clearTimeout(this.state.phaseTimer);
      this.state.phaseTimer = null;
    }

    const actions = Array.from(this.state.nightActions.values());
    const killAction = actions.find(a => a.type === "kill");
    const healAction = actions.find(a => a.type === "heal");
    const investigateAction = actions.find(a => a.type === "investigate");

    let eliminatedPlayer: MafiaPlayer | null = null;
    let protectedPlayer: MafiaPlayer | null = null;

    if (healAction) {
      protectedPlayer = this.state.players.find(p => p.id === healAction.targetId) || null;
    }

    if (killAction) {
      const target = this.state.players.find(p => p.id === killAction.targetId);
      if (target && target.isAlive) {
        if (protectedPlayer && protectedPlayer.id === target.id) {
          this.broadcast({
            type: "mafia:nightResult",
            payload: { 
              eliminated: null,
              protected: protectedPlayer.displayName,
              message: "تم حماية اللاعب المستهدف من قبل الطبيب!",
            },
            timestamp: Date.now(),
          });
        } else {
          target.isAlive = false;
          eliminatedPlayer = target;
          this.state.eliminatedToday = target.id;
        }
      }
    }

    if (investigateAction) {
      const target = this.state.players.find(p => p.id === investigateAction.targetId);
      const detective = this.state.players.find(p => p.role === "detective" && p.nightAction?.type === "investigate");
      if (target && detective) {
        const isMafia = target.role === "mafia";
        this.sendPrivateMessage(detective.id, "نتيجة التحقيق: " + target.displayName + " " + (isMafia ? "مافيا" : "ليس مافيا") + ".");
      }
    }

    if (eliminatedPlayer && !protectedPlayer) {
      this.broadcast({
        type: "mafia:nightResult",
        payload: { 
          eliminated: eliminatedPlayer.displayName,
          protected: null,
          message: "تم إقصاء " + eliminatedPlayer.displayName + " خلال الليل!",
        },
        timestamp: Date.now(),
      });
    }

    this.checkWinCondition();
    
    if (this.state.winner === null) {
      this.startDayPhase();
    } else {
      this.endGame();
    }
  }

  private startDayPhase(): void {
    this.state.nightPhase = false;
    this.state.dayStartTime = Date.now();

    const dayDuration = (this.getEffectiveSetting("dayDuration") as number) * 1000;
    this.state.timerDuration = dayDuration;

    for (const player of this.state.players) {
      if (player.isAlive) {
        player.hasVoted = false;
      }
    }

    this.broadcast({
      type: "mafia:dayStarted",
      payload: { 
        round: this.state.round,
        eliminated: this.state.eliminatedToday ? this.getPlayerName(this.state.eliminatedToday) : null,
        alivePlayers: this.getAlivePlayerInfos(),
        duration: dayDuration,
      },
      timestamp: Date.now(),
    });

    this.broadcastGameState();

    this.state.phaseTimer = this.scheduleTimer(() => {
      this.startVotingPhase();
    }, dayDuration);
  }

  private startVotingPhase(): void {
    this.state.votingStartTime = Date.now();

    const votingDuration = (this.getEffectiveSetting("votingDuration") as number) * 1000;
    this.state.timerDuration = votingDuration;
    this.state.votes = [];

    for (const player of this.state.players) {
      if (player.isAlive) {
        player.hasVoted = false;
      }
    }

    this.broadcast({
      type: "mafia:votingStarted",
      payload: { 
        round: this.state.round,
        alivePlayers: this.getAlivePlayerInfos(),
        duration: votingDuration,
      },
      timestamp: Date.now(),
    });

    this.broadcastGameState();

    this.state.phaseTimer = this.scheduleTimer(() => {
      this.resolveVoting();
    }, votingDuration);
  }

  private handleVote(msg: ChatMessage, player: MafiaPlayer): void {
    if (this.state.nightPhase) return;
    // votingStartTime stays > 0 after its segment ends (it is only reset at night),
    // so recency against the other phase timestamps — not zero-ness — identifies
    // whether the voting segment is currently active.
    if (!this.isVotingSegmentActive()) {
      this.sendPrivateMessage(player.id, "مرحلة التصويت لم تبدأ بعد.");
      return;
    }
    if (player.hasVoted) {
      this.sendPrivateMessage(player.id, "لقد صوتت بالفعل في هذه الجولة.");
      return;
    }

    const voteMatch = normalizeChatCommand(msg.message).match(/^!\s*(?:صوت|vote)\s+(.+)$/i);
    if (!voteMatch) return;

    const targetName = voteMatch[1].trim();
    const target = this.findPlayerByName(targetName);

    if (!target) {
      this.sendPrivateMessage(player.id, "لم يتم العثور على اللاعب.");
      return;
    }

    if (!target.isAlive) {
      this.sendPrivateMessage(player.id, "لا يمكنك التصويت للاعب ميت.");
      return;
    }

    if (target.id === player.id) {
      this.sendPrivateMessage(player.id, "لا يمكنك التصويت لنفسك.");
      return;
    }

    player.hasVoted = true;
    this.state.votes.push({ voterId: player.id, targetId: target.id });

    this.sendPrivateMessage(player.id, "تم تسجيل تصويتك لـ " + target.displayName + ".");
    this.broadcastGameState();

    this.checkVotingComplete();
  }

  private checkVotingComplete(): void {
    const alivePlayers = this.state.players.filter(p => p.isAlive);
    const votedCount = alivePlayers.filter(p => p.hasVoted).length;

    if (votedCount >= alivePlayers.length) {
      this.resolveVoting();
    }
  }

  private resolveVoting(): void {
    if (this.state.phaseTimer) {
      clearTimeout(this.state.phaseTimer);
      this.state.phaseTimer = null;
    }

    const voteCounts = new Map<string, number>();
    for (const vote of this.state.votes) {
      voteCounts.set(vote.targetId, (voteCounts.get(vote.targetId) || 0) + 1);
    }

    let maxVotes = 0;
    let eliminatedId: string | null = null;
    let isTie = false;

    for (const [playerId, count] of voteCounts) {
      if (count > maxVotes) {
        maxVotes = count;
        eliminatedId = playerId;
        isTie = false;
      } else if (count === maxVotes) {
        isTie = true;
      }
    }

    let eliminatedPlayer: MafiaPlayer | null = null;

    if (eliminatedId && !isTie) {
      eliminatedPlayer = this.state.players.find(p => p.id === eliminatedId) || null;
      if (eliminatedPlayer) {
        eliminatedPlayer.isAlive = false;
      }
    }

    this.broadcast({
      type: "mafia:votingResult",
      payload: { 
        votes: Array.from(voteCounts.entries()).map(([id, count]) => ({
          playerId: id,
          playerName: this.getPlayerName(id),
          votes: count,
        })),
        eliminated: eliminatedPlayer?.displayName || null,
        tie: isTie,
        message: isTie 
          ? "تعادل في الأصوات! لم يتم إقصاء أحد."
          : eliminatedPlayer 
            ? "تم إقصاء " + eliminatedPlayer.displayName + " بالتصويت!"
            : "لم يتم إقصاء أحد.",
      },
      timestamp: Date.now(),
    });

    this.checkWinCondition();
    
    if (this.state.winner === null) {
      this.state.round++;
      this.startNightPhase();
    } else {
      this.endGame();
    }
  }

  private checkWinCondition(): void {
    const alivePlayers = this.state.players.filter(p => p.isAlive);
    const aliveMafia = alivePlayers.filter(p => p.role === "mafia").length;
    const aliveNonMafia = alivePlayers.filter(p => p.role !== "mafia").length;

    if (alivePlayers.length === 0) {
      return;
    }

    if (aliveMafia === 0) {
      this.state.winner = "citizens";
    } else if (aliveMafia >= aliveNonMafia) {
      this.state.winner = "mafia";
    }
  }

  private endGame(): void {
    this.clearAllTimers();
    this.state.phase = "finished";

    const winnerTeam =
      this.state.winner === "mafia"
        ? "المافيا"
        : this.state.winner === "citizens"
          ? "المواطنون"
          : null;
    const roleReveals = this.state.players.map(p => ({
      id: p.id,
      displayName: p.displayName,
      role: p.role,
      isAlive: p.isAlive,
    }));

    this.broadcast({
      type: "mafia:gameOver",
      payload: { 
        winner: this.state.winner,
        winnerTeam,
        roles: roleReveals,
        round: this.state.round,
      },
      timestamp: Date.now(),
    });

    // Phase 12A — full-match victory goes to the members of the winning side
    // who are STILL ALIVE when the match ends (locked decision: eliminated
    // members are not counted as match winners).
    if (this.state.winner) {
      const aliveWinners = this.state.players
        .filter(p =>
          p.isAlive &&
          (this.state.winner === "mafia" ? p.role === "mafia" : p.role !== "mafia")
        )
        .map(p => p.id);
      this.announceWinners(aliveWinners, "match");
    }

    this.broadcastGameState();
  }

  private advancePhase(): void {
    if (this.state.phase !== "playing") return;
    
    if (this.state.phaseTimer) {
      clearTimeout(this.state.phaseTimer);
      this.state.phaseTimer = null;
    }

    if (this.state.nightPhase) {
      this.resolveNightPhase();
    } else if (this.isVotingSegmentActive()) {
      this.resolveVoting();
    } else {
      this.startVotingPhase();
    }
  }

  private findPlayerByName(name: string): MafiaPlayer | null {
    const normalizedName = name.toLowerCase();
    return this.state.players.find(p => p.displayName.toLowerCase() === normalizedName) || null;
  }

  /**
   * True only while the current playing segment is "voting": the voting segment
   * must be more recent than both the day and night segments of this round.
   * Fixes stale-votingStartTime bugs where votes were accepted during the day
   * discussion and admin next-phase resolved old votes instead of starting voting.
   */
  private isVotingSegmentActive(): boolean {
    return (
      this.state.votingStartTime > 0 &&
      this.state.votingStartTime > this.state.dayStartTime &&
      this.state.votingStartTime > this.state.nightStartTime
    );
  }

  private getPlayerName(id: string): string {
    return this.state.players.find(p => p.id === id)?.displayName || "غير معروف";
  }

  private getAlivePlayerInfos() {
    return this.state.players
      .filter(p => p.isAlive)
      .map(p => ({ id: p.id, displayName: p.displayName }));
  }

  private sendPrivateMessage(playerId: string, message: string): void {
    const socketId = this.getPlayerSocketId(playerId);
    if (this.io && socketId) {
      this.io.to(socketId).emit("game:event", {
        type: "mafia:privateMessage",
        payload: { playerId, message },
        timestamp: Date.now(),
      });
    } else {
      this.broadcast({
        type: "mafia:privateMessage",
        payload: { playerId, message },
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Schedules a phase timer that removes itself from the timers registry once
   * fired, so long matches don't accumulate dead handles.
   */
  private scheduleTimer(fn: () => void, ms: number): NodeJS.Timeout {
    const timer = setTimeout(() => {
      this.timers = this.timers.filter(t => t !== timer);
      fn();
    }, ms);
    this.timers.push(timer);
    return timer;
  }

  private clearAllTimers(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers = [];
    if (this.state.phaseTimer) {
      clearTimeout(this.state.phaseTimer);
      this.state.phaseTimer = null;
    }
  }

  /**
   * Public, serializable snapshot of the game state (no Maps, no timers).
   * Used both for broadcasts and for the initial state sent to newly
   * connected clients.
   */
  getPublicState(): Record<string, unknown> {
    const publicPlayers = this.state.players.map(p => {
      // Phase 9E: alive/dead always public; winner only after the game's own
      // rules reveal roles (phase "finished"). Derived ONLY from information
      // that is already public at that point — no secret exposure.
      let status = p.isAlive ? "alive" : "dead";
      if (this.state.phase === "finished" && this.state.winner) {
        const playerWon =
          (this.state.winner === "mafia" && p.role === "mafia") ||
          (this.state.winner === "citizens" && p.role !== "mafia");
        if (playerWon) status = "winner";
      }
      return {
        id: p.id,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        role: this.state.phase === "finished" ? p.role : (p.isAlive ? "مجهول" : p.role),
        isAlive: p.isAlive,
        status,
      };
    });

    const alivePlayers = this.state.players.filter(p => p.isAlive);

    return {
      gameId: this.config.id,
      sessionId: this.sessionId,
      phase: this.state.phase,
      players: publicPlayers,
      nightPhase: this.state.nightPhase,
      eliminatedToday: this.state.eliminatedToday,
      round: this.state.round,
      timerDuration: this.state.timerDuration,
      winner: this.state.winner,
      gameStartTime: this.state.gameStartTime,
      votingStartTime: this.state.votingStartTime,
      dayStartTime: this.state.dayStartTime,
      nightStartTime: this.state.nightStartTime,
      votedCount: alivePlayers.filter(p => p.hasVoted).length,
      aliveCount: alivePlayers.length,
      activeSettings: this.hasMatchSettings() ? this.getMatchSettings() : this.getEditableSettings(),
    };
  }

  private broadcastGameState(): void {
    this.broadcast({
      type: "game:state",
      payload: this.getPublicState(),
      timestamp: Date.now(),
    });
  }
}
