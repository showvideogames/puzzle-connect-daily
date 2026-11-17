import "./routerTestEnvironment";
import { beforeEach, vi } from "vitest";
// Synchronous lock grant for component tests; real contention is tested in Chromium.
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("navigator", Object.assign(navigator, {
    locks: { request: (_name: string, _options: unknown, callback: (lock: object) => Promise<void>) => callback({}) },
  }));
});
