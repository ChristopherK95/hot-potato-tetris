import { io, Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@tetris/shared';

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

class SocketClient {
  private _socket: AppSocket | null = null;

  connect(url: string): AppSocket {
    this._socket = io(url, { autoConnect: true }) as AppSocket;
    return this._socket;
  }

  get socket(): AppSocket {
    if (!this._socket) throw new Error('Socket not connected');
    return this._socket;
  }

  get isConnected(): boolean {
    return this._socket?.connected ?? false;
  }
}

export const socketClient = new SocketClient();
