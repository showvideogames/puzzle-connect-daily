type GtagFn = (command: string, eventName: string, params?: Record<string, unknown>) => void;

declare global {
  interface Window {
    gtag?: GtagFn;
  }
}

export function trackEvent(name: string, params: Record<string, unknown> = {}): void {
  try {
    window.gtag?.("event", name, params);
  } catch {
    // ignore — analytics should never break the game
  }
}
