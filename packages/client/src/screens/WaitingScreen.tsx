import type { RoomState } from '@tetris/shared';
import { socketClient } from '../net/SocketClient';

interface Props {
  roomCode: string;
  playerName: string;
  isHost: boolean;
  roomState: RoomState | null;
}

export default function WaitingScreen({ roomCode, playerName, isHost, roomState }: Props) {
  return (
    <div className="waiting">
      <h2 className="waiting-title">WAITING ROOM</h2>

      <div className="room-code-box">
        <p className="room-code-label">ROOM CODE</p>
        <p className="room-code">{roomCode}</p>
        <p className="room-code-hint">Play solo or share with friends (2–4 players)</p>
      </div>

      <div className="player-list-card">
        <h3>PLAYERS</h3>
        {roomState?.players.map((p, i) => (
          <div key={p.id} className="player-row">
            <span>{i + 1}.</span>
            <span>{p.name}</span>
            {p.name === playerName && <span className="you-badge">YOU</span>}
            {p.id === roomState.hostId && <span className="host-badge">♛</span>}
          </div>
        ))}
        {!roomState && <p style={{ color: 'var(--dim)', fontSize: 14 }}>Connecting…</p>}
      </div>

      {isHost ? (
        <button
          className="btn btn-primary"
          onClick={() => socketClient.socket.emit('room:start')}
        >
          START GAME
        </button>
      ) : (
        <p style={{ color: 'var(--dim)', fontSize: 14 }}>Waiting for host to start…</p>
      )}
    </div>
  );
}
