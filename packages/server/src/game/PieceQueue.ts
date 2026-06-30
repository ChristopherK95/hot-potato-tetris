import { ALL_PIECES, PieceType } from '@tetris/shared';

/** Standard Tetris 7-bag randomizer */
export class PieceQueue {
  private bag: PieceType[] = [];

  next(): PieceType {
    if (this.bag.length === 0) this.refill();
    return this.bag.shift()!;
  }

  peek(count: number): PieceType[] {
    while (this.bag.length < count) this.refill();
    return this.bag.slice(0, count);
  }

  private refill() {
    const shuffled = [...ALL_PIECES];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    this.bag.push(...shuffled);
  }
}
