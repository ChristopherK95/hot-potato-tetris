let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  freq: number,
  type: OscillatorType,
  vol: number,
  dur: number,
  delay = 0,
): void {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain);
  gain.connect(c.destination);
  osc.type = type;
  osc.frequency.value = freq;
  const t = c.currentTime + delay;
  gain.gain.setValueAtTime(0.001, t);
  gain.gain.linearRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noise(vol: number, dur: number): void {
  const c = getCtx();
  if (!c) return;
  const samples = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, samples, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < samples; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const gain = c.createGain();
  gain.gain.setValueAtTime(vol, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  src.connect(gain);
  gain.connect(c.destination);
  src.start();
}

export function initAudio(): void {
  getCtx();
}

export const sound = {
  move():        void { tone(240, 'square',   0.06, 0.055); },
  rotate():      void { tone(360, 'triangle', 0.08, 0.065); },
  softDrop():    void { tone(180, 'sine',     0.04, 0.04); },
  lock():        void { noise(0.12, 0.08); tone(130, 'sawtooth', 0.1, 0.1); },
  hardDrop():    void { noise(0.22, 0.12); tone(85, 'sawtooth', 0.18, 0.18); },
  timerTick():   void { tone(880, 'sine', 0.1, 0.055); },
  timerUrgent(): void { tone(1320, 'sine', 0.14, 0.07); },

  yourTurn(): void {
    tone(523, 'sine', 0.14, 0.18, 0.0);
    tone(659, 'sine', 0.14, 0.18, 0.1);
    tone(784, 'sine', 0.17, 0.25, 0.2);
  },

  lineClear(lines: number): void {
    const freqs = [440, 554, 659, 880];
    for (let i = 0; i < Math.min(lines, 4); i++) {
      tone(freqs[i], 'sine', 0.18, 0.26, i * 0.07);
    }
    if (lines >= 4) {
      // Tetris bonus fanfare
      const melody = [784, 988, 1175, 1319, 1175, 988, 784];
      melody.forEach((f, i) => tone(f, 'sine', 0.13, 0.14, 0.32 + i * 0.075));
    }
  },

  levelUp(): void {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone(f, 'triangle', 0.17, 0.24, i * 0.09),
    );
  },

  rouletteLucky(): void {
    [440, 550, 660, 880].forEach((f, i) =>
      tone(f, 'sine', 0.14, 0.2, i * 0.07),
    );
  },

  rouletteBad(): void {
    noise(0.28, 0.22);
    tone(65, 'sawtooth', 0.22, 0.32);
  },

  rouletteBlind(): void {
    tone(330, 'triangle', 0.18, 0.12);
    tone(220, 'triangle', 0.15, 0.18, 0.1);
    tone(165, 'triangle', 0.12, 0.25, 0.2);
  },
};
