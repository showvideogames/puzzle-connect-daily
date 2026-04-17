/**
 * Gift box sparkle chime — 5 bright triangle-wave notes ascending rapidly,
 * like a quick magical twinkle. Celebratory and light.
 */
export function playGiftOpenSound(): void {
  try {
    const settings = JSON.parse(localStorage.getItem("connections-settings") || "{}");
    if (settings.soundEnabled === false) return;

    const ctx = new AudioContext();
    const now = ctx.currentTime;

    // High pentatonic arpeggio: C6, E6, G6, C7, E7
    const notes = [1047, 1319, 1568, 2093, 2637];

    notes.forEach((freq, i) => {
      const delay = i * 0.06; // 60 ms between each sparkle
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "triangle"; // brighter timbre than sine
      osc.frequency.value = freq;

      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(0.06, now + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.4);
    });
  } catch {}
}

/**
 * Rainbow harp glissando — 10 plucked sine-wave notes ascending a pentatonic
 * scale, staggered like fingers brushing harp strings. Soft attack, warm decay.
 * Feels light and magical rather than sci-fi.
 */
export function playRainbowSound(): void {
  try {
    const settings = JSON.parse(localStorage.getItem("connections-settings") || "{}");
    if (settings.soundEnabled === false) return;

    const ctx = new AudioContext();
    const now = ctx.currentTime;

    // Pentatonic scale starting at C5 (523 Hz) — 10 notes ascending.
    // Frequencies: C D E G A C D E G A (two octaves of pentatonic)
    const notes = [523, 587, 659, 784, 880, 1047, 1175, 1319, 1568, 1760];

    notes.forEach((freq, i) => {
      const delay = i * 0.07; // 70 ms between each pluck
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.value = freq;

      // Sharp pluck attack, then a warm exponential decay like a harp string
      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(0.03, now + delay + 0.01);  // fast attack
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.8); // warm decay

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.85);
    });
  } catch {}
}
