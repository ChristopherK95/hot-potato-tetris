import { useState, useEffect, useRef, useCallback } from 'react';
import type { GameState, PieceState, PieceType } from '@tetris/shared';
import {
  BOARD_COLS,
  BOARD_ROWS,
  PIECE_COLORS,
  PIECE_ROTATIONS,
} from '@tetris/shared';
import { socketClient } from '../net/SocketClient';

// ── Canvas constants ───────────────────────────────────────────────────────────
const CELL = 30;
const W = BOARD_COLS * CELL;
const H = BOARD_ROWS * CELL;
const MINI = 18; // next-piece preview cell size

function hexColor(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  color: number,
  alpha = 1,
) {
  const x = col * CELL;
  const y = row * CELL;
  const pad = 2;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = hexColor(color);
  ctx.fillRect(x + pad, y + pad, CELL - pad * 2, CELL - pad * 2);
  // shine
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(x + pad, y + pad, CELL - pad * 2, 3);
  ctx.fillRect(x + pad, y + pad, 3, CELL - pad * 2);
  ctx.globalAlpha = 1;
}

function ghostY(state: GameState): number {
  const { board, currentPiece: p } = state;
  let y = p.y;
  outer: while (true) {
    const nextY = y + 1;
    for (const [dr, dc] of PIECE_ROTATIONS[p.type][p.rotation]) {
      const r = nextY + dr;
      const c = p.x + dc;
      if (r >= BOARD_ROWS || (r >= 0 && board[r][c] !== null)) break outer;
      if (c < 0 || c >= BOARD_COLS) break outer;
    }
    y = nextY;
  }
  return y;
}

function renderBoard(ctx: CanvasRenderingContext2D, state: GameState) {
  // Background
  ctx.fillStyle = '#0e0e1c';
  ctx.fillRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = '#1a1a30';
  ctx.lineWidth = 0.5;
  for (let c = 1; c < BOARD_COLS; c++) {
    ctx.beginPath(); ctx.moveTo(c * CELL, 0); ctx.lineTo(c * CELL, H); ctx.stroke();
  }
  for (let r = 1; r < BOARD_ROWS; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * CELL); ctx.lineTo(W, r * CELL); ctx.stroke();
  }

  // Locked cells
  for (let row = 0; row < BOARD_ROWS; row++) {
    for (let col = 0; col < BOARD_COLS; col++) {
      const cell = state.board[row][col];
      if (cell) drawCell(ctx, col, row, PIECE_COLORS[cell]);
    }
  }

  // Ghost piece
  const gy = ghostY(state);
  const { currentPiece: p } = state;
  if (gy !== p.y) {
    for (const [dr, dc] of PIECE_ROTATIONS[p.type][p.rotation]) {
      const r = gy + dr;
      const c = p.x + dc;
      if (r >= 0 && r < BOARD_ROWS) drawCell(ctx, c, r, PIECE_COLORS[p.type], 0.18);
    }
  }

  // Active piece
  for (const [dr, dc] of PIECE_ROTATIONS[p.type][p.rotation]) {
    const r = p.y + dr;
    const c = p.x + dc;
    if (r >= 0 && r < BOARD_ROWS) drawCell(ctx, c, r, PIECE_COLORS[p.type]);
  }
}

function renderNextPiece(canvas: HTMLCanvasElement, type: PieceType) {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const cells = PIECE_ROTATIONS[type][0];
  const pad = 2;
  for (const [row, col] of cells) {
    ctx.fillStyle = hexColor(PIECE_COLORS[type]);
    ctx.fillRect(col * MINI + pad, row * MINI + pad, MINI - pad * 2, MINI - pad * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(col * MINI + pad, row * MINI + pad, MINI - pad * 2, 3);
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  initialState: GameState;
  playerName: string;
  onLeave: () => void;
}

export default function GameScreen({ initialState, playerName, onLeave }: Props) {
  const [gs, setGs] = useState<GameState>(initialState);
  const [showBanner, setShowBanner] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const confirmLeaveRef = useRef(false);

  const boardRef = useRef<HTMLCanvasElement>(null);
  const nextRefs = [
    useRef<HTMLCanvasElement>(null),
    useRef<HTMLCanvasElement>(null),
    useRef<HTMLCanvasElement>(null),
  ];
  const bannerKey = useRef(0);

  const myId = socketClient.socket.id ?? '';
  const isMyTurn = gs.currentPlayerId === myId;
  const isMyTurnRef = useRef(isMyTurn);
  isMyTurnRef.current = isMyTurn;

  // ── Socket listeners ────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = socketClient.socket;

    socket.on('game:state', (state: GameState) => {
      const wasMyTurn = isMyTurnRef.current;
      const nowMyTurn = state.currentPlayerId === myId;
      setGs(state);
      if (!wasMyTurn && nowMyTurn) {
        bannerKey.current += 1;
        setShowBanner(true);
        setTimeout(() => setShowBanner(false), 1900);
      }
    });

    socket.on('game:pieceUpdate', (piece: PieceState) => {
      setGs(prev => ({ ...prev, currentPiece: piece }));
    });

    socket.on('game:timerTick', (seconds: number) => {
      setGs(prev => ({ ...prev, timerSeconds: seconds }));
    });

    return () => {
      socket.off('game:state');
      socket.off('game:pieceUpdate');
      socket.off('game:timerTick');
    };
  }, [myId]);

  // ── Draw board on every state change ────────────────────────────────────────
  useEffect(() => {
    const canvas = boardRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderBoard(ctx, gs);
  }, [gs]);

  // ── Draw next pieces ─────────────────────────────────────────────────────────
  useEffect(() => {
    gs.nextPieces.slice(0, 3).forEach((type, i) => {
      const canvas = nextRefs[i].current;
      if (canvas) renderNextPiece(canvas, type);
    });
  }, [gs.nextPieces]);

  // Keep ref in sync so keyboard handler always sees current value
  confirmLeaveRef.current = confirmLeave;

  function doLeave() {
    socketClient.socket.emit('game:leave');
    onLeave();
  }

  // ── Keyboard ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let softInterval: ReturnType<typeof setInterval> | null = null;

    const onDown = (e: KeyboardEvent) => {
      // Leave flow — handle before the turn guard
      if (e.code === 'Escape') {
        if (confirmLeaveRef.current) {
          socketClient.socket.emit('game:leave');
          onLeave();
        } else {
          setConfirmLeave(true);
          confirmLeaveRef.current = true;
        }
        return;
      }

      // Any other key dismisses the confirmation overlay
      if (confirmLeaveRef.current) {
        setConfirmLeave(false);
        confirmLeaveRef.current = false;
      }

      if (!isMyTurnRef.current) return;
      const socket = socketClient.socket;
      switch (e.code) {
        case 'ArrowLeft':  socket.emit('game:move', 'left');  break;
        case 'ArrowRight': socket.emit('game:move', 'right'); break;
        case 'ArrowUp':
        case 'KeyX':       socket.emit('game:rotate', 'cw');  break;
        case 'KeyZ':       socket.emit('game:rotate', 'ccw'); break;
        case 'Space':
          e.preventDefault();
          socket.emit('game:hardDrop');
          break;
        case 'ArrowDown':
          if (!softInterval) {
            socket.emit('game:softDrop');
            softInterval = setInterval(() => socket.emit('game:softDrop'), 80);
          }
          break;
      }
    };

    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'ArrowDown' && softInterval) {
        clearInterval(softInterval);
        softInterval = null;
      }
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      if (softInterval) clearInterval(softInterval);
    };
  }, []);

  // ── Derived display values ───────────────────────────────────────────────────
  const activePlayer = gs.players.find(p => p.id === gs.currentPlayerId);
  const timerClass =
    gs.timerSeconds <= 2 ? 'danger' : gs.timerSeconds <= 4 ? 'warn' : 'safe';
  const sortedPlayers = [...gs.players].sort((a, b) => b.score - a.score);

  return (
    <div className="game-layout">
      {/* ── Board ─────────────────────────────────────────────────────────── */}
      <div className="board-wrap">
        <canvas ref={boardRef} width={W} height={H} />
        {showBanner && (
          <div className="your-turn-banner" key={bannerKey.current}>
            <span>YOUR TURN!</span>
          </div>
        )}
        {confirmLeave && (
          <div className="leave-overlay">
            <div className="leave-dialog">
              <p>Leave the game?</p>
              <p className="leave-hint">ESC to confirm · any key to cancel</p>
              <div className="leave-actions">
                <button className="btn btn-danger" onClick={doLeave}>Leave</button>
                <button className="btn btn-secondary" onClick={() => setConfirmLeave(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <div className="sidebar">

        {/* Timer */}
        <div className="sidebar-section">
          <h4>TIME</h4>
          <div className={`timer-value ${timerClass}`}>{gs.timerSeconds}</div>
        </div>

        {/* Active player */}
        <div className="sidebar-section">
          <h4>ACTIVE PLAYER</h4>
          <div className={`active-player-name ${isMyTurn ? 'is-me' : ''}`}>
            {activePlayer?.name ?? '—'}{isMyTurn ? ' (you)' : ''}
          </div>
        </div>

        {/* Next pieces */}
        <div className="sidebar-section">
          <h4>NEXT</h4>
          <div className="next-pieces">
            {nextRefs.map((ref, i) => (
              <canvas key={i} ref={ref} width={4 * MINI} height={4 * MINI} />
            ))}
          </div>
        </div>

        {/* Players */}
        <div className="sidebar-section">
          <h4>PLAYERS</h4>
          <div className="players-list">
            {sortedPlayers.map(p => (
              <div
                key={p.id}
                className={[
                  'player-entry',
                  p.id === gs.currentPlayerId ? 'active' : '',
                  p.name === playerName ? 'me' : '',
                ].join(' ')}
              >
                <div className="player-entry-left">
                  <span className="turn-arrow">
                    {p.id === gs.currentPlayerId ? '▶' : ' '}
                  </span>
                  <span>{p.name}</span>
                </div>
                <span className="player-score">{p.score}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Lines */}
        <div className="sidebar-section">
          <h4>LINES CLEARED</h4>
          <div style={{ fontSize: 24, fontWeight: 'bold' }}>{gs.linesCleared}</div>
        </div>

        {/* Controls */}
        <div className="sidebar-section">
          <div className="controls-hint">
            ← → &nbsp;move<br />
            ↑ / X &nbsp;rotate CW<br />
            Z &nbsp;&nbsp;&nbsp;&nbsp;rotate CCW<br />
            ↓ &nbsp;&nbsp;&nbsp;&nbsp;soft drop<br />
            SPACE &nbsp;hard drop
          </div>
        </div>

      </div>
    </div>
  );
}
