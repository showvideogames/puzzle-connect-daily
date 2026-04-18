const SETTINGS_KEY = "connections-settings";

export interface GameSettings {
  showRainbowColors: boolean;
  soundEnabled: boolean;
  darkMode: boolean;
  hapticEnabled: boolean;
  arrangeTiles: boolean;
  colorCodeTiles: boolean;
}

const defaults: GameSettings = {
  showRainbowColors: true,
  soundEnabled: true,
  darkMode: false,
  hapticEnabled: true,
  arrangeTiles: false,
  colorCodeTiles: false,
};

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {}
  return { ...defaults };
}

export function saveSettings(settings: GameSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
