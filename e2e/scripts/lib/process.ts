/**
 * Cross-platform child-process helpers.
 *
 * Every E2E command runs on Windows as well as CI's Linux, so nothing here
 * shells out to a POSIX-only construct.
 *
 * ── Why the Supabase CLI is not run through `npx` ─────────────────────────
 *
 * On Windows `npx` is `npx.cmd`, a batch file. Since Node 20.12 (the fix for
 * CVE-2024-27980) `spawn`/`spawnSync` REFUSE to run a `.cmd` or `.bat`
 * without `shell: true`, and throw `spawn EINVAL` instead. Turning the shell
 * on would work, but then every argument is re-parsed by cmd.exe and paths
 * with spaces — `C:\Users\…\AppData\Local\…` is one command away from being
 * one — need quoting rules that differ per platform.
 *
 * The `supabase` npm package ships the real binary in a per-platform
 * package (`@supabase/cli-windows-x64` and friends), and its own `bin` shim
 * does nothing but locate and spawn it. So {@link supabaseBinary} resolves
 * that executable the same way and spawns it directly: no shell, no `.cmd`,
 * no quoting, and one process less per call.
 */

import { spawn, spawnSync, type SpawnOptions } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

/** The per-platform packages the `supabase` npm package publishes its binary in. */
const CLI_PLATFORM_PACKAGES: Record<string, Record<string, string[]>> = {
  darwin: { arm64: ["darwin-arm64"], x64: ["darwin-x64"] },
  linux: { arm64: ["linux-arm64", "linux-arm64-musl"], x64: ["linux-x64", "linux-x64-musl"] },
  win32: { arm64: ["windows-arm64"], x64: ["windows-x64"] },
};

let cachedBinary: string | null | undefined;

/**
 * The Supabase CLI executable, or null if only a globally installed one is
 * available.
 *
 * `SUPABASE_CLI_BINARY_OVERRIDE` is honoured because the CLI's own shim
 * honours it — a developer pointing at a locally built CLI should not have
 * to point at it twice.
 */
export function supabaseBinary(): string | null {
  if (cachedBinary !== undefined) return cachedBinary;

  const override = process.env.SUPABASE_CLI_BINARY_OVERRIDE;
  if (override) {
    cachedBinary = override;
    return cachedBinary;
  }

  const candidates = CLI_PLATFORM_PACKAGES[process.platform]?.[os.arch()] ?? [];
  const extension = process.platform === "win32" ? ".exe" : "";
  for (const suffix of candidates) {
    try {
      const packageDir = path.dirname(require.resolve(`@supabase/cli-${suffix}/package.json`));
      cachedBinary = path.join(packageDir, "bin", `supabase${extension}`);
      return cachedBinary;
    } catch {
      // Not installed for this platform; try the next candidate.
    }
  }

  cachedBinary = null;
  return cachedBinary;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a command to completion, capturing output. Never throws on non-zero. */
export function runCapture(command: string, args: string[], options: SpawnOptions = {}): RunResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  if (result.error) {
    return { code: 1, stdout: "", stderr: result.error.message };
  }
  return {
    code: result.status ?? 1,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
  };
}

/** Runs a command with its output streamed to this process. */
export async function runInherit(
  command: string,
  args: string[],
  options: SpawnOptions = {}
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * The Supabase CLI, always scoped to the E2E project directory.
 *
 * Falls back to a `supabase` on PATH when the npm package's platform binary
 * is not installed, which is what a globally installed CLI looks like.
 */
function cliInvocation(workdir: string, args: string[]): [string, string[]] {
  const binary = supabaseBinary();
  const scoped = [...args, "--workdir", workdir];
  return binary ? [binary, scoped] : ["supabase", scoped];
}

export function supabaseCapture(workdir: string, args: string[]): RunResult {
  const [command, argv] = cliInvocation(workdir, args);
  return runCapture(command, argv);
}

export function supabaseInherit(workdir: string, args: string[]): Promise<number> {
  const [command, argv] = cliInvocation(workdir, args);
  return runInherit(command, argv);
}

/**
 * Whether a container runtime the Supabase CLI can drive is on PATH.
 *
 * Checked explicitly so the failure mode is a sentence a developer can act
 * on, instead of the CLI's `LegacyStatusDbInspectError`.
 *
 * Note for Windows: Docker Desktop adds itself to the USER Path, so a shell
 * that was already open when it was installed will not see it. That looks
 * exactly like "Docker is not installed" from here — hence the hint.
 */
export function containerRuntime(): "docker" | "podman" | null {
  for (const candidate of ["docker", "podman"] as const) {
    const probe = runCapture(candidate, ["--version"]);
    if (probe.code === 0) return candidate;
  }
  return null;
}
