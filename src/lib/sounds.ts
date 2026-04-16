/**
 * Rainbow sweep sound — an ascending glissando in 7 staggered bands
 * (one per colour of the rainbow), sweeping up one octave each.
 * Feels distinct from the 4-note celebration chord in useGame.ts.
 */
export function playRainbowSound(): void {
  try {
    const settings = JSON.parse(localStorage.getItem("connections-settings") || "{}");
    if (settings.soundEnabled === false) return;

    const ctx = new AudioContext();
    const now = ctx.currentTime;

    // 7 sine-wave bands, each offset in time and frequency like prism colours.
    // Every band sweeps up one octave (start → start × 2) over 0.9 s.
    const bands: { start: number; delay: number; vol: number }[] = [
      { start: 280, delay: 0.00, vol: 0.07 },
      { start: 350, delay: 0.08, vol: 0.07 },
      { start: 420, delay: 0.16, vol: 0.06 },
      { start: 500, delay: 0.24, vol: 0.06 },
      { start: 600, delay: 0.32, vol: 0.05 },
      { start: 700, delay: 0.40, vol: 0.05 },
      { start: 840, delay: 0.48, vol: 0.04 },
    ];

    bands.forEach(({ start, delay, vol }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(start, now + delay);
      osc.frequency.exponentialRampToValueAtTime(start * 2, now + delay + 0.9);
      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(vol, now + delay + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.9);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 1.0);
    });
  } catch {}
}
