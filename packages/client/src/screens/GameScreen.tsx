import { useState, useEffect, useRef } from 'react';
import type { GameState, PieceState, PieceType, PowerUpType } from '@tetris/shared';
import {
  BOARD_COLS,
  BOARD_ROWS,
  PIECE_COLORS,
  PIECE_ROTATIONS,
} from '@tetris/shared';
import { socketClient } from '../net/SocketClient';
import { initAudio, sound } from '../sound';

// ── Canvas constants ───────────────────────────────────────────────────────────
const CELL = 30;
const W = BOARD_COLS * CELL;
const H = BOARD_ROWS * CELL;
const MINI = 18;
const GARBAGE_COLOR = 0x4a4a60;

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  size: number;
  alpha: number;
  decay: number;
  color: string;
}

const POWERUP_ICONS: Record<PowerUpType, string> = {
  nuke:      '💥',
  garbage:   '🗑️',
  blindfold: '🙈',
};

const POWERUP_LABELS: Record<PowerUpType, string> = {
  nuke:      'NUKE',
  garbage:   'GARBAGE',
  blindfold: 'BLINDFOLD',
};

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
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(x + pad, y + pad, CELL - pad * 2, 3);
  ctx.fillRect(x + pad, y + pad, 3, CELL - pad * 2);
  ctx.globalAlpha = 1;
}

function clientGhostY(state: GameState): number {
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
  ctx.fillStyle = '#0e0e1c';
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = '#1a1a30';
  ctx.lineWidth = 0.5;
  for (let c = 1; c < BOARD_COLS; c++) {
    ctx.beginPath(); ctx.moveTo(c * CELL, 0); ctx.lineTo(c * CELL, H); ctx.stroke();
  }
  for (let r = 1; r < BOARD_ROWS; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * CELL); ctx.lineTo(W, r * CELL); ctx.stroke();
  }

  for (let row = 0; row < BOARD_ROWS; row++) {
    for (let col = 0; col < BOARD_COLS; col++) {
      const cell = state.board[row][col];
      if (cell) {
        const color = cell === 'G' ? GARBAGE_COLOR : PIECE_COLORS[cell as PieceType];
        drawCell(ctx, col, row, color);
      }
    }
  }

  const gy = clientGhostY(state);
  const { currentPiece: p } = state;
  if (gy !== p.y) {
    for (const [dr, dc] of PIECE_ROTATIONS[p.type][p.rotation]) {
      const r = gy + dr;
      const c = p.x + dc;
      if (r >= 0 && r < BOARD_ROWS) drawCell(ctx, c, r, PIECE_COLORS[p.type], 0.18);
    }
  }

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
  const [powerUpMsg, setPowerUpMsg] = useState<string | null>(null);

  const boardRef = useRef<HTMLCanvasElement>(null);
  const particleCanvasRef = useRef<HTMLCanvasElement>(null);
  const boardWrapRef = useRef<HTMLDivElement>(null);
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

  const confirmLeaveRef = useRef(false);
  confirmLeaveRef.current = confirmLeave;

  // Refs for stale-closure-free access inside socket/rAF callbacks
  const gsRef = useRef<GameState>(initialState);
  gsRef.current = gs;

  // Particle system
  const particlesRef = useRef<Particle[]>([]);
  const flashAlphaRef = useRef(0);
  const rAFRef = useRef<number | null>(null);

  // Level tracking for level-up detection
  const prevLevelRef = useRef(0);

  // Power-up message timeout
  const powerUpMsgTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Particle animation loop ───────────────────────────────────────────────────
  const animateParticlesRef = useRef<() => void>(null!);
  useEffect(() => {
    animateParticlesRef.current = function animateParticles() {
      const canvas = particleCanvasRef.current;
      if (!canvas) { rAFRef.current = null; return; }
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, W, H);

      // Screen flash
      if (flashAlphaRef.current > 0.005) {
        ctx.fillStyle = `rgba(255,255,255,${flashAlphaRef.current.toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
        flashAlphaRef.current = Math.max(0, flashAlphaRef.current - 0.035);
      }

      // Particles
      particlesRef.current.forEach(p => {
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      });
      ctx.globalAlpha = 1;

      particlesRef.current = particlesRef.current
        .map(p => ({ ...p, x: p.x + p.vx, y: p.y + p.vy, vy: p.vy + 0.15, alpha: p.alpha - p.decay }))
        .filter(p => p.alpha > 0.01);

      if (particlesRef.current.length > 0 || flashAlphaRef.current > 0.005) {
        rAFRef.current = requestAnimationFrame(animateParticlesRef.current);
      } else {
        rAFRef.current = null;
        ctx.clearRect(0, 0, W, H);
      }
    };
  });

  function spawnParticles(count: number) {
    const hues = [180, 270, 60, 120, 0, 210];
    const newParticles: Particle[] = Array.from({ length: count }, (_, i) => ({
      x: Math.random() * W,
      y: H * 0.45 + (Math.random() - 0.5) * H * 0.55,
      vx: (Math.random() - 0.5) * 8,
      vy: (Math.random() - 0.5) * 7 - 1.5,
      size: 3 + Math.random() * 5,
      alpha: 1,
      decay: 0.017 + Math.random() * 0.013,
      color: `hsl(${hues[i % hues.length] + Math.floor(Math.random() * 40)}, 90%, 65%)`,
    }));
    particlesRef.current = [...particlesRef.current, ...newParticles];
    if (!rAFRef.current) {
      rAFRef.current = requestAnimationFrame(animateParticlesRef.current);
    }
  }

  function triggerFlash(intensity: number) {
    flashAlphaRef.current = intensity;
    if (!rAFRef.current) {
      rAFRef.current = requestAnimationFrame(animateParticlesRef.current);
    }
  }

  function triggerShake() {
    const el = boardWrapRef.current;
    if (!el) return;
    el.classList.remove('shake');
    void el.offsetWidth; // force reflow to restart animation
    el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 380);
  }

  // ── Socket listeners ────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = socketClient.socket;

    socket.on('game:state', (state: GameState) => {
      const wasMyTurn = isMyTurnRef.current;
      const nowMyTurn = state.currentPlayerId === myId;

      if (state.lastLinesCleared > 0) {
        sound.lineClear(state.lastLinesCleared);
        spawnParticles(state.lastLinesCleared * 22);
        if (state.lastLinesCleared >= 4) triggerFlash(0.55);
      }

      if (state.level > prevLevelRef.current) {
        prevLevelRef.current = state.level;
        sound.levelUp();
      }

      gsRef.current = state;
      setGs(state);

      if (!wasMyTurn && nowMyTurn) {
        bannerKey.current += 1;
        setShowBanner(true);
        setTimeout(() => setShowBanner(false), 1900);
        sound.yourTurn();
      }
    });

    socket.on('game:pieceUpdate', (piece: PieceState) => {
      setGs(prev => {
        const next = { ...prev, currentPiece: piece };
        gsRef.current = next;
        return next;
      });
    });

    socket.on('game:timerTick', (seconds: number) => {
      setGs(prev => {
        const next = { ...prev, timerSeconds: seconds };
        gsRef.current = next;
        return next;
      });
      if (seconds <= 3) sound.timerUrgent();
      else sound.timerTick();
    });

    socket.on('game:powerUpUsed', (playerId: string, type: PowerUpType, targetId: string) => {
      const players = gsRef.current.players;
      const user = players.find(p => p.id === playerId);
      const target = players.find(p => p.id === targetId);
      const msgs: Record<PowerUpType, string> = {
        nuke:      `${user?.name ?? '?'} used NUKE 💥`,
        garbage:   `${user?.name ?? '?'} dumped GARBAGE on ${target?.name ?? 'next player'} 🗑️`,
        blindfold: `${user?.name ?? '?'} BLINDFOLDED ${target?.name ?? 'next player'} 🙈`,
      };
      if (powerUpMsgTimeoutRef.current) clearTimeout(powerUpMsgTimeoutRef.current);
      setPowerUpMsg(msgs[type]);
      powerUpMsgTimeoutRef.current = setTimeout(() => setPowerUpMsg(null), 2800);

      if (targetId === myId) sound.powerUpHit();
      else sound.powerUpUse();
    });

    return () => {
      socket.off('game:state');
      socket.off('game:pieceUpdate');
      socket.off('game:timerTick');
      socket.off('game:powerUpUsed');
      if (rAFRef.current) cancelAnimationFrame(rAFRef.current);
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

  function doLeave() {
    socketClient.socket.emit('game:leave');
    onLeave();
  }

  // ── Keyboard ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let softInterval: ReturnType<typeof setInterval> | null = null;

    const onDown = (e: KeyboardEvent) => {
      initAudio(); // ensure AudioContext is active after first gesture

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

      if (confirmLeaveRef.current) {
        setConfirmLeave(false);
        confirmLeaveRef.current = false;
      }

      if (!isMyTurnRef.current) return;
      const socket = socketClient.socket;
      switch (e.code) {
        case 'ArrowLeft':
          socket.emit('game:move', 'left');
          sound.move();
          break;
        case 'ArrowRight':
          socket.emit('game:move', 'right');
          sound.move();
          break;
        case 'ArrowUp':
        case 'KeyX':
          socket.emit('game:rotate', 'cw');
          sound.rotate();
          break;
        case 'KeyZ':
          socket.emit('game:rotate', 'ccw');
          sound.rotate();
          break;
        case 'Space':
          e.preventDefault();
          socket.emit('game:hardDrop');
          sound.hardDrop();
          triggerShake();
          break;
        case 'ArrowDown':
          if (!softInterval) {
            socket.emit('game:softDrop');
            sound.softDrop();
            softInterval = setInterval(() => {
              socket.emit('game:softDrop');
            }, 80);
          }
          break;
        case 'KeyQ': {
          const me = gsRef.current.players.find(p => p.id === myId);
          if (me && me.powerUps.length > 0) {
            socket.emit('game:usePowerUp', 0);
          }
          break;
        }
        case 'KeyE': {
          const me = gsRef.current.players.find(p => p.id === myId);
          if (me && me.powerUps.length > 1) {
            socket.emit('game:usePowerUp', 1);
          }
          break;
        }
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
  const timerClass = gs.timerSeconds <= 2 ? 'danger' : gs.timerSeconds <= 4 ? 'warn' : 'safe';
  const isTimerUrgent = gs.timerSeconds <= 3;
  const sortedPlayers = [...gs.players].sort((a, b) => b.score - a.score);
  const myPlayer = gs.players.find(p => p.id === myId);
  const isBlindfolded = isMyTurn && myPlayer?.isBlindfolded === true;

  return (
    <div className="game-layout">
      {/* ── Board ─────────────────────────────────────────────────────────── */}
      <div
        ref={boardWrapRef}
        className={`board-wrap${isTimerUrgent ? ' timer-urgent' : ''}`}
      >
        <canvas ref={boardRef} width={W} height={H} />
        <canvas
          ref={particleCanvasRef}
          width={W}
          height={H}
          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
        />
        {showBanner && (
          <div className="your-turn-banner" key={bannerKey.current}>
            <span>YOUR TURN!</span>
          </div>
        )}
        {powerUpMsg && (
          <div className="powerup-notification">{powerUpMsg}</div>
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
          {isBlindfolded ? (
            <div className="blindfold-msg">🙈 ???</div>
          ) : (
            <div className="next-pieces">
              {nextRefs.map((ref, i) => (
                <canvas key={i} ref={ref} width={4 * MINI} height={4 * MINI} />
              ))}
            </div>
          )}
        </div>

        {/* Power-ups */}
        <div className="sidebar-section">
          <h4>POWER-UPS {!isMyTurn ? <span className="dim-label">(your turn only)</span> : null}</h4>
          <div className="powerup-slots">
            {[0, 1].map(slot => {
              const pu = myPlayer?.powerUps[slot];
              return (
                <div key={slot} className={`powerup-slot${pu ? ' filled' : ''}`}>
                  {pu ? (
                    <>
                      <span className="powerup-icon">{POWERUP_ICONS[pu]}</span>
                      <span className="powerup-name">{POWERUP_LABELS[pu]}</span>
                    </>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--dim)' }}>empty</span>
                  )}
                  <span className="slot-key">{slot === 0 ? 'Q' : 'E'}</span>
                </div>
              );
            })}
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

        {/* Stats */}
        <div className="sidebar-section">
          <div className="stats-row">
            <div>
              <h4>LINES</h4>
              <div className="stat-value">{gs.linesCleared}</div>
            </div>
            <div>
              <h4>LEVEL</h4>
              <div className="stat-value level-value">{gs.level}</div>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="sidebar-section">
          <div className="controls-hint">
            ← → &nbsp;move<br />
            ↑ / X &nbsp;rotate CW<br />
            Z &nbsp;&nbsp;&nbsp;&nbsp;rotate CCW<br />
            ↓ &nbsp;&nbsp;&nbsp;&nbsp;soft drop<br />
            SPACE &nbsp;hard drop<br />
            Q / E &nbsp;use power-up
          </div>
        </div>

      </div>
    </div>
  );
}
