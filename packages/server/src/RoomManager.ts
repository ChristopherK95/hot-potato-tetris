import GameRoom from './game/GameRoom';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid ambiguity

function generateCode(): string {
  return Array.from({ length: 6 }, () =>
    CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)],
  ).join('');
}

class RoomManager {
  private rooms = new Map<string, GameRoom>();
  /** socketId → roomCode */
  private playerRoom = new Map<string, string>();

  createRoom(socketId: string, playerName: string): GameRoom {
    let code: string;
    do { code = generateCode(); } while (this.rooms.has(code));

    const room = new GameRoom(code, socketId, playerName);
    this.rooms.set(code, room);
    this.playerRoom.set(socketId, code);
    return room;
  }

  joinRoom(socketId: string, roomCode: string, playerName: string): GameRoom | null {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) return null;
    const ok = room.addPlayer(socketId, playerName);
    if (!ok) return null;
    this.playerRoom.set(socketId, roomCode.toUpperCase());
    return room;
  }

  getRoom(code: string): GameRoom | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  getRoomForSocket(socketId: string): GameRoom | undefined {
    const code = this.playerRoom.get(socketId);
    return code ? this.rooms.get(code) : undefined;
  }

  removeSocket(socketId: string) {
    const room = this.getRoomForSocket(socketId);
    if (room) {
      room.removePlayer(socketId);
      if (room.playerCount === 0) {
        this.rooms.delete(room.roomCode);
      }
    }
    this.playerRoom.delete(socketId);
  }
}

export default new RoomManager();
