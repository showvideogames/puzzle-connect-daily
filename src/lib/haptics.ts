import { loadSettings } from "@/lib/settings";

export function vibrate(pattern: number | number[] = 10) {
  try {
    if (loadSettings().hapticEnabled && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  } catch {}
}

export function vibrateSuccess() {
  vibrate([10, 50, 10]);
}

export function vibrateError() {
  vibrate([30, 50, 30]);
}

export function vibrateCelebration() {
  vibrate([10, 30, 10, 30, 10, 30, 50]);
}
