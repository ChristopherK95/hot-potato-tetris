// ─── Piece definitions ───────────────────────────────────────────────────────

export type PieceType = 'I' | 'J' | 'L' | 'O' | 'S' | 'T' | 'Z';

/** [row, col] offsets from the top-left of a 4×4 bounding box */
export const PIECE_ROTATIONS: Record<PieceType, Array<Array<[number, number]>>> = {
  I: [
    [[1,0],[1,1],[1,2],[1,3]],
    [[0,2],[1,2],[2,2],[3,2]],
    [[2,0],[2,1],[2,2],[2,3]],
    [[0,1],[1,1],[2,1],[3,1]],
  ],
  J: [
    [[0,0],[1,0],[1,1],[1,2]],
    [[0,1],[0,2],[1,1],[2,1]],
    [[1,0],[1,1],[1,2],[2,2]],
    [[0,1],[1,1],[2,0],[2,1]],
  ],
  L: [
    [[0,2],[1,0],[1,1],[1,2]],
    [[0,0],[0,1],[1,0],[2,0]],
    [[1,0],[1,1],[1,2],[2,0]],
    [[0,1],[1,1],[2,1],[2,2]],
  ],
  O: [
    [[0,1],[0,2],[1,1],[1,2]],
    [[0,1],[0,2],[1,1],[1,2]],
    [[0,1],[0,2],[1,1],[1,2]],
    [[0,1],[0,2],[1,1],[1,2]],
  ],
  S: [
    [[0,1],[0,2],[1,0],[1,1]],
    [[0,0],[1,0],[1,1],[2,1]],
    [[1,1],[1,2],[2,0],[2,1]],
    [[0,1],[1,0],[1,1],[2,0]],
  ],
  T: [
    [[0,1],[1,0],[1,1],[1,2]],
    [[0,1],[1,1],[1,2],[2,1]],
    [[1,0],[1,1],[1,2],[2,1]],
    [[0,1],[1,0],[1,1],[2,1]],
  ],
  Z: [
    [[0,0],[0,1],[1,1],[1,2]],
    [[0,2],[1,1],[1,2],[2,1]],
    [[1,0],[1,1],[2,1],[2,2]],
    [[0,1],[1,0],[1,1],[2,0]],
  ],
};

export const PIECE_COLORS: Record<PieceType, number> = {
  I: 0x00f0f0,
  J: 0x2020f0,
  L: 0xf0a000,
  O: 0xf0f000,
  S: 0x00f000,
  T: 0xa000f0,
  Z: 0xf00000,
};

export const ALL_PIECES: PieceType[] = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

// ─── Board ───────────────────────────────────────────────────────────────────

export const BOARD_COLS = 10;
export const BOARD_ROWS = 20;
export const TURN_SECONDS = 7;

/** Garbage rows use a special sentinel that renders as dark grey */
export type GarbageType = 'G';

/** null = empty, PieceType = locked piece cell, 'G' = garbage row cell */
export type CellState = PieceType | GarbageType | null;
export type Board = CellState[][];

// ─── Power-ups ───────────────────────────────────────────────────────────────

export type PowerUpType = 'nuke' | 'garbage' | 'blindfold';

// ─── Game / Room state ───────────────────────────────────────────────────────

export interface PieceState {
  type: PieceType;
  rotation: number;
  /** top-left column of the 4×4 bounding box */
  x: number;
  /** top-left row of the 4×4 bounding box */
  y: number;
}

export interface PlayerInfo {
  id: string;
  name: string;
  score: number;
  isConnected: boolean;
  powerUps: PowerUpType[];
  isBlindfolded: boolean;
}

export type RoomStatus = 'lobby' | 'playing' | 'gameover';

export interface RoomState {
  roomCode: string;
  players: PlayerInfo[];
  hostId: string;
  status: RoomStatus;
}

export interface GameState {
  board: Board;
  currentPiece: PieceState;
  nextPieces: PieceType[];
  currentPlayerId: string;
  timerSeconds: number;
  players: PlayerInfo[];
  linesCleared: number;
  level: number;
  lastLinesCleared: number;
}

export interface GameOverState {
  players: PlayerInfo[];
  linesCleared: number;
  reason: 'board_full' | 'all_disconnected';
}

// ─── Socket.io event maps ────────────────────────────────────────────────────

export interface ClientToServerEvents {
  'room:create': (playerName: string, cb: (roomCode: string) => void) => void;
  'room:join': (
    roomCode: string,
    playerName: string,
    cb: (ok: boolean, error?: string) => void,
  ) => void;
  'room:start': () => void;
  'game:move': (direction: 'left' | 'right') => void;
  'game:rotate': (direction: 'cw' | 'ccw') => void;
  'game:softDrop': () => void;
  'game:hardDrop': () => void;
  'game:usePowerUp': (slot: 0 | 1) => void;
  'game:leave': () => void;
}

export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  'game:state': (state: GameState) => void;
  'game:pieceUpdate': (piece: PieceState) => void;
  'game:timerTick': (seconds: number) => void;
  'game:over': (state: GameOverState) => void;
  'game:powerUpUsed': (playerId: string, type: PowerUpType, targetId: string) => void;
  error: (message: string) => void;
}
