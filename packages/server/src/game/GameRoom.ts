import { EventEmitter } from 'events';
import {
  Board,
  GameOverState,
  GameState,
  PlayerInfo,
  PieceState,
  RoomState,
  TURN_SECONDS,
} from '@tetris/shared';
import {
  SPAWN_X,
  SPAWN_Y,
  createEmptyBoard,
  ghostY,
  isValid,
  lockPiece,
  scoreForLines,
} from './Board';
import { PieceQueue } from './PieceQueue';

const NEXT_PREVIEW = 3;

export interface GameRoomEvents {
  roomState: (roomCode: string, state: RoomState) => void;
  gameState: (roomCode: string, state: GameState) => void;
  pieceUpdate: (roomCode: string, piece: PieceState) => void;
  timerTick: (roomCode: string, seconds: number) => void;
  gameOver: (roomCode: string, state: GameOverState) => void;
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

  // turn timer
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private timerSeconds = TURN_SECONDS;

  // gravity
  private gravityInterval: ReturnType<typeof setInterval> | null = null;

  constructor(roomCode: string, hostId: string, hostName: string) {
    super();
    this.roomCode = roomCode;
    this.hostId = hostId;
    this.players.set(hostId, { id: hostId, name: hostName, score: 0, isConnected: true });
  }

  // ─── Lobby ──────────────────────────────────────────────────────────────────

  addPlayer(id: string, name: string): boolean {
    if (this.status !== 'lobby') return false;
    if (this.players.size >= 4) return false;
    this.players.set(id, { id, name, score: 0, isConnected: true });
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
      // if the active player disconnects, advance the turn
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
    this.turnIndex = 0;

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
    // TODO: SRS wall kicks can be added here for advanced rotation handling
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
      // Even at spawn it collides → game over
      this.endGame('board_full');
    }
  }

  private lockCurrentPiece() {
    this.stopTurnTimer();
    this.stopGravity();

    const { board, linesCleared } = lockPiece(this.board, this.currentPiece);
    this.board = board;
    this.linesCleared += linesCleared;

    const activePlayer = this.activePlayers()[this.turnIndex];
    if (activePlayer) {
      const p = this.players.get(activePlayer.id)!;
      p.score += scoreForLines(linesCleared) + 10;
      this.players.set(activePlayer.id, p);
    }

    this.advanceTurn();
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
  }

  private startTurnTimer() {
    this.stopTurnTimer();
    this.timerSeconds = TURN_SECONDS;
    this.timerInterval = setInterval(() => {
      this.timerSeconds--;
      this.emit('timerTick', this.roomCode, this.timerSeconds);
      if (this.timerSeconds <= 0) {
        // Auto-lock: drop the piece to ghost position and lock
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
        // Piece has landed — lock it and end the turn
        this.lockCurrentPiece();
      }
    }, 1000);
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
    const gs = this.buildGameState();
    this.emit('gameState', this.roomCode, gs);
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
