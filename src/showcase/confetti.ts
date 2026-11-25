/**
 * canvas-confetti without its blob Worker: the default instance tries to start
 * one, which a hosted Artifact's content policy blocks (it falls back, but the
 * browser logs a violation). Same function, same options, main-thread canvas.
 */
import real from "canvas-confetti/dist/confetti.module.mjs";

type Confetti = ((options?: Record<string, unknown>) => Promise<null> | null) & { reset: () => void; create: typeof real.create };
const instance = real.create(null, { resize: true, useWorker: false }) as Confetti;
instance.create = real.create;
export default instance;
