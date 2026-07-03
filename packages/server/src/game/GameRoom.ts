import { EventEmitter } from 'events';
import {
  Board,
  GameOverState,
  GameState,
  PlayerInfo,
  PieceState,
  RouletteEventType,
  RoomState,
  TURN_SECONDS,
} from '@tetris/shared';
import {
  SPAWN_X,
  SPAWN_Y,
  addGarbageRows,
  createEmptyBoard,
  ghostY,
  isValid,
  lockPiece,
  nukeBottomRows,
  scoreForLines,
} from './Board';
import { PieceQueue } from './PieceQueue';

const NEXT_PREVIEW = 3;

const GRAVITY_MS = [1000, 900, 780, 660, 550, 440, 340, 260, 190, 140, 100];

function gravityForLevel(level: number): number {
  return GRAVITY_MS[Math.min(level, GRAVITY_MS.length - 1)];
}

function rollRouletteEvent(linesCleared: number): RouletteEventType | null {
  if (linesCleared === 0) return null;

  if (linesCleared >= 4) {
    // Tetris: always triggers an event, pool includes the big ones
    const pool: RouletteEventType[] = ['lucky_clear', 'garbage_3', 'garbage_3', 'blindfold'];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  if (linesCleared >= 2) {
    if (Math.random() > 0.65) return null;
    const pool: RouletteEventType[] = ['lucky_clear', 'garbage_2', 'blindfold'];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Single line: 40% chance, no lucky_clear (must earn it)
  if (Math.random() > 0.4) return null;
  const pool: RouletteEventType[] = ['garbage_2', 'blindfold'];
  return pool[Math.floor(Math.random() * pool.length)];
}

function emptyPlayer(id: string, name: string): PlayerInfo {
  return { id, name, score: 0, isConnected: true, isBlindfolded: false };
}

export interface GameRoomEvents {
  roomState: (roomCode: string, state: RoomState) => void;
  gameState: (roomCode: string, state: GameState) => void;
  pieceUpdate: (roomCode: string, piece: PieceState) => void;
  timerTick: (roomCode: string, seconds: number) => void;
  gameOver: (roomCode: string, state: GameOverState) => void;
  rouletteEvent: (
    roomCode: string,
    type: RouletteEventType,
    triggeringPlayerId: string,
    targetId: string,
  ) => void;
}

declare interface GameRoom {
  on<K extends keyof GameRoomEvents>(event: K, listener: GameRoomEvents[K]): this;
  emit<K extends keyof GameRoomEvents>(event: K, ...args: Parameters<GameRoomEvents[K]>): boolean;
}

class GameRoom extends EventEmitter {
  readonly roomCode: string;
  private players: Map<string, PlayerInfo> = new Map();
  private hostId: string;
  private status: 'lobby' | 'playing' | 'gameover' = 'lobby';

  // game state
  private board: Board = createEmptyBoard();
  private queue = new PieceQueue();
  private currentPiece!: PieceState;
  private turnIndex = 0;
  private linesCleared = 0;
  private lastLinesCleared = 0;
  private level = 0;
  private totalLinesForLevel = 0;

  // turn timer
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private timerSeconds = TURN_SECONDS;

  // gravity
  private gravityInterval: ReturnType<typeof setInterval> | null = null;

  constructor(roomCode: string, hostId: string, hostName: string) {
    super();
    this.roomCode = roomCode;
    this.hostId = hostId;
    this.players.set(hostId, emptyPlayer(hostId, hostName));
  }

  // ─── Lobby ──────────────────────────────────────────────────────────────────

  addPlayer(id: string, name: string): boolean {
    if (this.status !== 'lobby') return false;
    if (this.players.size >= 4) return false;
    this.players.set(id, emptyPlayer(id, name));
    this.emitRoomState();
    return true;
  }

  removePlayer(id: string) {
    const player = this.players.get(id);
    if (!player) return;

    if (this.status === 'lobby') {
      this.players.delete(id);
      if (id === this.hostId && this.players.size > 0) {
        this.hostId = this.players.keys().next().value!;
      }
      this.emitRoomState();
    } else {
      player.isConnected = false;
      this.players.set(id, player);
      if (this.activePlayers()[this.turnIndex]?.id === id) {
        this.advanceTurn();
      }
      if (this.activePlayers().length === 0) {
        this.endGame('all_disconnected');
      }
    }
  }

  get playerCount() {
    return this.players.size;
  }

  // ─── Game start ─────────────────────────────────────────────────────────────

  startGame(requesterId: string): boolean {
    if (requesterId !== this.hostId) return false;
    if (this.status !== 'lobby') return false;
    if (this.players.size < 1) return false;

    this.status = 'playing';
    this.board = createEmptyBoard();
    this.queue = new PieceQueue();
    this.linesCleared = 0;
    this.lastLinesCleared = 0;
    this.level = 0;
    this.totalLinesForLevel = 0;
    this.turnIndex = 0;

    for (const [id, p] of this.players) {
      this.players.set(id, { ...p, score: 0, isBlindfolded: false });
    }

    this.spawnPiece();
    this.startTurnTimer();
    this.startGravity();
    this.emitGameState();
    return true;
  }

  // ─── Player inputs ──────────────────────────────────────────────────────────

  handleMove(playerId: string, direction: 'left' | 'right') {
    if (!this.isActiveTurn(playerId)) return;
    const delta = direction === 'left' ? -1 : 1;
    const moved = { ...this.currentPiece, x: this.currentPiece.x + delta };
    if (isValid(this.board, moved)) {
      this.currentPiece = moved;
      this.broadcastPieceUpdate();
    }
  }

  handleRotate(playerId: string, direction: 'cw' | 'ccw') {
    if (!this.isActiveTurn(playerId)) return;
    const delta = direction === 'cw' ? 1 : 3;
    const rotated = { ...this.currentPiece, rotation: (this.currentPiece.rotation + delta) % 4 };
    if (isValid(this.board, rotated)) {
      this.currentPiece = rotated;
      this.broadcastPieceUpdate();
    }
  }

  handleSoftDrop(playerId: string) {
    if (!this.isActiveTurn(playerId)) return;
    const dropped = { ...this.currentPiece, y: this.currentPiece.y + 1 };
    if (isValid(this.board, dropped)) {
      this.currentPiece = dropped;
      this.broadcastPieceUpdate();
    } else {
      this.lockCurrentPiece();
    }
  }

  handleHardDrop(playerId: string) {
    if (!this.isActiveTurn(playerId)) return;
    this.currentPiece = { ...this.currentPiece, y: ghostY(this.board, this.currentPiece) };
    this.lockCurrentPiece();
  }

  // ─── Internal turn logic ────────────────────────────────────────────────────

  private isActiveTurn(playerId: string): boolean {
    return (
      this.status === 'playing' &&
      this.activePlayers()[this.turnIndex]?.id === playerId
    );
  }

  private activePlayers(): PlayerInfo[] {
    return [...this.players.values()].filter(p => p.isConnected);
  }

  private spawnPiece() {
    const type = this.queue.next();
    this.currentPiece = { type, rotation: 0, x: SPAWN_X, y: SPAWN_Y };

    if (!isValid(this.board, this.currentPiece)) {
      this.endGame('board_full');
    }
  }

  private lockCurrentPiece() {
    this.stopTurnTimer();
    this.stopGravity();

    const { board, linesCleared } = lockPiece(this.board, this.currentPiece);
    this.board = board;
    this.lastLinesCleared = linesCleared;
    this.linesCleared += linesCleared;
    this.totalLinesForLevel += linesCleared;
    this.level = Math.min(
      Math.floor(this.totalLinesForLevel / 5),
      GRAVITY_MS.length - 1,
    );

    const activePlayer = this.activePlayers()[this.turnIndex];
    if (activePlayer) {
      const p = this.players.get(activePlayer.id)!;
      p.score += scoreForLines(linesCleared) + 10;
      p.isBlindfolded = false; // clear their own debuff after turn ends
      this.players.set(activePlayer.id, p);
    }

    // Roll roulette event on line clears
    const event = rollRouletteEvent(linesCleared);
    if (event) {
      this.applyRouletteEvent(event, activePlayer?.id ?? '');
    }

    this.advanceTurn();
  }

  private applyRouletteEvent(type: RouletteEventType, triggeringPlayerId: string) {
    const active = this.activePlayers();
    // In multiplayer, target the NEXT player; in solo, target self
    const nextIdx = active.length > 1
      ? (this.turnIndex + 1) % active.length
      : this.turnIndex;
    const targetPlayer = active[nextIdx];

    switch (type) {
      case 'lucky_clear':
        this.board = nukeBottomRows(this.board, 2);
        break;
      case 'garbage_2':
        this.board = addGarbageRows(this.board, 2);
        break;
      case 'garbage_3':
        this.board = addGarbageRows(this.board, 3);
        break;
      case 'blindfold':
        if (targetPlayer) {
          const target = this.players.get(targetPlayer.id)!;
          target.isBlindfolded = true;
          this.players.set(targetPlayer.id, target);
        }
        break;
    }

    this.emit(
      'rouletteEvent',
      this.roomCode,
      type,
      triggeringPlayerId,
      targetPlayer?.id ?? '',
    );
  }

  private advanceTurn() {
    const active = this.activePlayers();
    if (active.length === 0) {
      this.endGame('all_disconnected');
      return;
    }
    this.turnIndex = (this.turnIndex + 1) % active.length;
    this.spawnPiece();
    if (this.status !== 'playing') return;
    this.startTurnTimer();
    this.startGravity();
    this.emitGameState();
    this.lastLinesCleared = 0;
  }

  private startTurnTimer() {
    this.stopTurnTimer();
    this.timerSeconds = TURN_SECONDS;
    this.timerInterval = setInterval(() => {
      this.timerSeconds--;
      this.emit('timerTick', this.roomCode, this.timerSeconds);
      if (this.timerSeconds <= 0) {
        this.currentPiece = { ...this.currentPiece, y: ghostY(this.board, this.currentPiece) };
        this.lockCurrentPiece();
      }
    }, 1000);
  }

  private stopTurnTimer() {
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private startGravity() {
    this.stopGravity();
    this.gravityInterval = setInterval(() => {
      if (this.status !== 'playing') return;
      const fallen = { ...this.currentPiece, y: this.currentPiece.y + 1 };
      if (isValid(this.board, fallen)) {
        this.currentPiece = fallen;
        this.broadcastPieceUpdate();
      } else {
        this.lockCurrentPiece();
      }
    }, gravityForLevel(this.level));
  }

  private stopGravity() {
    if (this.gravityInterval !== null) {
      clearInterval(this.gravityInterval);
      this.gravityInterval = null;
    }
  }

  private endGame(reason: GameOverState['reason']) {
    this.stopTurnTimer();
    this.stopGravity();
    this.status = 'gameover';
    this.emit('gameOver', this.roomCode, {
      players: [...this.players.values()],
      linesCleared: this.linesCleared,
      reason,
    });
  }

  // ─── State snapshots ─────────────────────────────────────────────────────────

  private broadcastPieceUpdate() {
    this.emit('pieceUpdate', this.roomCode, this.currentPiece);
  }

  private emitGameState() {
    this.emit('gameState', this.roomCode, this.buildGameState());
  }

  buildGameState(): GameState {
    return {
      board: this.board.map(r => [...r]),
      currentPiece: { ...this.currentPiece },
      nextPieces: this.queue.peek(NEXT_PREVIEW),
      currentPlayerId: this.activePlayers()[this.turnIndex]?.id ?? '',
      timerSeconds: this.timerSeconds,
      players: [...this.players.values()],
      linesCleared: this.linesCleared,
      level: this.level,
      lastLinesCleared: this.lastLinesCleared,
    };
  }

  buildRoomState(): RoomState {
    return {
      roomCode: this.roomCode,
      players: [...this.players.values()],
      hostId: this.hostId,
      status: this.status,
    };
  }

  private emitRoomState() {
    this.emit('roomState', this.roomCode, this.buildRoomState());
  }
}

export default GameRoom;
