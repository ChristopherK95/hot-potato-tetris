import type { GameOverState } from '@tetris/shared';

interface Props {
  state: GameOverState;
  playerName: string;
  onPlayAgain: () => void;
}

const MEDALS = ['🥇', '🥈', '🥉'];

export default function GameOverScreen({ state, playerName, onPlayAgain }: Props) {
  const sorted = [...state.players].sort((a, b) => b.score - a.score);

  return (
    <div className="gameover">
      <h1 className="gameover-title">GAME OVER</h1>
      <p className="gameover-stats">Lines cleared: {state.linesCleared}</p>

      <div className="leaderboard">
        {sorted.map((p, i) => (
          <div key={p.id} className={`leaderboard-row ${p.name === playerName ? 'is-me' : ''}`}>
            <span className="lb-rank">{MEDALS[i] ?? `${i + 1}.`}</span>
            <span className="lb-name">{p.name}{p.name === playerName ? ' ★' : ''}</span>
            <span className="lb-score">{p.score} pts</span>
          </div>
        ))}
      </div>

      <button className="btn btn-primary" onClick={onPlayAgain}>
        PLAY AGAIN
      </button>
    </div>
  );
}
