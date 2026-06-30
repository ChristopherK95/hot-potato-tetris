import { useState, useEffect, useRef } from 'react';
import type { RoomState, GameState, GameOverState } from '@tetris/shared';
import { socketClient } from './net/SocketClient';
import LobbyScreen from './screens/LobbyScreen';
import WaitingScreen from './screens/WaitingScreen';
import GameScreen from './screens/GameScreen';
import GameOverScreen from './screens/GameOverScreen';

type Screen = 'lobby' | 'waiting' | 'game' | 'gameover';

export default function App() {
  const [screen, setScreen]         = useState<Screen>('lobby');
  const [roomCode, setRoomCode]     = useState('');
  const [playerName, setPlayerName] = useState('');
  const [isHost, setIsHost]         = useState(false);
  const [roomState, setRoomState]   = useState<RoomState | null>(null);
  const [gameState, setGameState]   = useState<GameState | null>(null);
  const [gameOver, setGameOver]     = useState<GameOverState | null>(null);

  // Keep current screen accessible in stable socket listeners without re-registering
  const screenRef = useRef(screen);
  screenRef.current = screen;

  useEffect(() => {
    const serverUrl =
      window.location.hostname === 'localhost'
        ? 'http://localhost:3000'
        : window.location.origin;
    const socket = socketClient.connect(serverUrl);

    socket.on('room:state', state => setRoomState(state));

    socket.on('game:state', state => {
      setGameState(state);
      if (screenRef.current === 'waiting') setScreen('game');
    });

    socket.on('game:over', state => {
      setGameOver(state);
      setScreen('gameover');
    });

    return () => {
      socket.off('room:state');
      socket.off('game:state');
      socket.off('game:over');
    };
  }, []);

  function goToWaiting(code: string, name: string, host: boolean) {
    setRoomCode(code);
    setPlayerName(name);
    setIsHost(host);
    setScreen('waiting');
  }

  function goToLobby() {
    setRoomState(null);
    setGameState(null);
    setGameOver(null);
    setScreen('lobby');
  }

  if (screen === 'lobby') {
    return <LobbyScreen onEnterRoom={goToWaiting} />;
  }

  if (screen === 'waiting') {
    return (
      <WaitingScreen
        roomCode={roomCode}
        playerName={playerName}
        isHost={isHost}
        roomState={roomState}
      />
    );
  }

  if (screen === 'game' && gameState) {
    return (
      <GameScreen
        initialState={gameState}
        playerName={playerName}
        onLeave={goToLobby}
      />
    );
  }

  if (screen === 'gameover' && gameOver) {
    return <GameOverScreen state={gameOver} playerName={playerName} onPlayAgain={goToLobby} />;
  }

  return null;
}
