import { useState } from 'react';
import { socketClient } from '../net/SocketClient';

interface Props {
  onEnterRoom: (roomCode: string, playerName: string, isHost: boolean) => void;
}

export default function LobbyScreen({ onEnterRoom }: Props) {
  const [name, setName]   = useState('');
  const [code, setCode]   = useState('');
  const [error, setError] = useState('');

  function showError(msg: string) {
    setError(msg);
    setTimeout(() => setError(''), 3000);
  }

  function handleCreate() {
    if (!name.trim()) { showError('Please enter your name'); return; }
    socketClient.socket.emit('room:create', name.trim(), (roomCode: string) => {
      onEnterRoom(roomCode, name.trim(), true);
    });
  }

  function handleJoin() {
    if (!name.trim()) { showError('Please enter your name'); return; }
    if (code.trim().length < 6) { showError('Enter the 6-letter room code'); return; }
    socketClient.socket.emit(
      'room:join',
      code.trim().toUpperCase(),
      name.trim(),
      (ok: boolean, err?: string) => {
        if (!ok) { showError(err ?? 'Could not join room'); return; }
        onEnterRoom(code.trim().toUpperCase(), name.trim(), false);
      },
    );
  }

  return (
    <div className="lobby">
      <h1 className="lobby-title">TETRIS ROYALE</h1>
      <p className="lobby-subtitle">TURN-BASED MULTIPLAYER</p>

      <div className="lobby-card">
        <div className="field">
          <label htmlFor="name">YOUR NAME</label>
          <input
            id="name"
            type="text"
            maxLength={20}
            placeholder="Enter your name…"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            autoFocus
          />
        </div>

        <button className="btn btn-primary" onClick={handleCreate}>
          CREATE ROOM
        </button>

        <div className="divider">or join existing</div>

        <div className="field">
          <label htmlFor="code">ROOM CODE</label>
          <input
            id="code"
            type="text"
            maxLength={6}
            placeholder="e.g. ABCDEF"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleJoin()}
          />
        </div>

        <button className="btn btn-secondary" onClick={handleJoin}>
          JOIN ROOM
        </button>

        <p className="error-msg">{error}</p>
      </div>
    </div>
  );
}
