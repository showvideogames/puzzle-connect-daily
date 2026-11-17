import { transferableAbortController } from "node:util";
import { vi } from "vitest";
// Node's Request rejects jsdom's AbortSignal; use a matching Node controller.
vi.stubGlobal("AbortController", class {
  constructor() { return transferableAbortController(); }
});
