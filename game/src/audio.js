// DUSTLINE — all sound is synthesized with WebAudio. No audio files, no network.
export function createAudio() {
  let ctx = null, master = null, wind = null;
  let muted = false;
  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      // Desert wind: looped filtered noise, very quiet.
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { last = last * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = last * 3; }
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320;
      wind = ctx.createGain(); wind.gain.value = 0.05;
      src.connect(f); f.connect(wind); wind.connect(master);
      src.start();
      return true;
    } catch { return false; }
  }
  function noiseBurst(dur, freq, gain, type = 'lowpass', when = 0) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + when;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = ctx.createBufferSource(); s.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.02);
  }
  function tone(freq, dur, gain, type = 'sine', when = 0, slideTo = 0) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  const SHOT = {
    P9: { dur: 0.09, freq: 1800, gain: 0.5, crack: 0.25 },
    'Vex-9': { dur: 0.08, freq: 2400, gain: 0.42, crack: 0.2 },
    'KR-7': { dur: 0.12, freq: 1400, gain: 0.6, crack: 0.3 },
    'Longshot-50': { dur: 0.28, freq: 900, gain: 0.9, crack: 0.5 },
    'Breacher-12': { dur: 0.16, freq: 1100, gain: 0.75, crack: 0.35 },
  };
  return {
    unlock() { ensure(); },
    setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.5; },
    // distance 0..1 attenuates a far-away shot.
    shot(name, dist = 0) {
      if (!ensure()) return;
      const s = SHOT[name] || SHOT['KR-7'];
      const g = s.gain * (1 - dist * 0.8);
      noiseBurst(s.dur, s.freq, g);
      tone(180, 0.07, s.crack * (1 - dist * 0.7), 'square');
      if (name === 'Longshot-50') noiseBurst(0.4, 500, 0.3 * (1 - dist * 0.7), 'lowpass', 0.02);
    },
    dryFire() { tone(1400, 0.03, 0.12, 'square'); },
    reload() { noiseBurst(0.05, 3000, 0.2, 'highpass'); tone(900, 0.04, 0.1, 'square', 0.12); noiseBurst(0.05, 3000, 0.25, 'highpass', 0.3); },
    step() { noiseBurst(0.05, 500, 0.08); },
    hit(head) { tone(head ? 2400 : 1800, 0.05, 0.25, 'sine'); },
    kill() { tone(1800, 0.05, 0.25, 'sine'); tone(2600, 0.08, 0.25, 'sine', 0.06); },
    hurt() { tone(220, 0.12, 0.3, 'sawtooth', 0, 140); },
    beep(n = 1) { for (let i = 0; i < n; i++) tone(1200, 0.09, 0.2, 'sine', i * 0.16); },
    plantDone() { tone(880, 0.12, 0.25, 'sine'); tone(1320, 0.2, 0.25, 'sine', 0.12); },
    roundWin() { tone(523, 0.14, 0.25, 'sine'); tone(784, 0.22, 0.25, 'sine', 0.13); },
    roundLose() { tone(392, 0.16, 0.25, 'sine'); tone(262, 0.28, 0.25, 'sine', 0.15); },
    buy() { tone(1000, 0.05, 0.18, 'sine'); tone(1500, 0.06, 0.18, 'sine', 0.05); },
    denied() { tone(180, 0.12, 0.25, 'square'); },
  };
}
