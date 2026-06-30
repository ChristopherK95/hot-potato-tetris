import {
  Board,
  BOARD_COLS,
  BOARD_ROWS,
  CellState,
  PieceState,
  PIECE_ROTATIONS,
} from '@tetris/shared';

export function createEmptyBoard(): Board {
  return Array.from({ length: BOARD_ROWS }, () => Array(BOARD_COLS).fill(null));
}

/** Absolute [row, col] positions of a piece's cells on the board */
export function getCells(piece: PieceState): Array<[number, number]> {
  return PIECE_ROTATIONS[piece.type][piece.rotation].map(([dr, dc]) => [
    piece.y + dr,
    piece.x + dc,
  ]);
}

/** True when the piece is in a valid position (no wall/floor/cell collision) */
export function isValid(board: Board, piece: PieceState): boolean {
  for (const [row, col] of getCells(piece)) {
    if (col < 0 || col >= BOARD_COLS) return false;
    if (row >= BOARD_ROWS) return false;
    if (row >= 0 && board[row][col] !== null) return false;
  }
  return true;
}

/** Lowest valid y for the current piece (ghost position) */
export function ghostY(board: Board, piece: PieceState): number {
  let p = { ...piece };
  while (isValid(board, { ...p, y: p.y + 1 })) p = { ...p, y: p.y + 1 };
  return p.y;
}

/** Lock a piece onto the board, return new board + lines cleared */
export function lockPiece(
  board: Board,
  piece: PieceState,
): { board: Board; linesCleared: number } {
  const next: Board = board.map(row => [...row]);
  for (const [row, col] of getCells(piece)) {
    if (row < 0) continue; // above visible board — rare edge case
    next[row][col] = piece.type;
  }
  return clearLines(next);
}

function clearLines(board: Board): { board: Board; linesCleared: number } {
  const remaining = board.filter(row => row.some(cell => cell === null));
  const linesCleared = BOARD_ROWS - remaining.length;
  const empty: CellState[][] = Array.from({ length: linesCleared }, () =>
    Array(BOARD_COLS).fill(null),
  );
  return { board: [...empty, ...remaining], linesCleared };
}

/** Compute score delta for clearing n lines (Tetris guideline points) */
export function scoreForLines(lines: number): number {
  return [0, 100, 300, 500, 800][lines] ?? 800;
}

/** Spawn column: centre the 4×4 bounding box on the 10-wide board */
export const SPAWN_X = 3;
export const SPAWN_Y = -1; // partially off-screen so piece "enters" the board
