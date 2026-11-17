import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useCreatorDraftStore } from "@/hooks/useCreatorDraftStore";

afterEach(() => vi.restoreAllMocks());
it("an exclusive lifetime lock prevents two mounted editors from becoming writers", async () => {
  let held = false;
  const request = vi.fn(async (_name: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => {
    if (held) return callback(null);
    held = true;
    try { await callback({}); } finally { held = false; }
  });
  Object.defineProperty(navigator, "locks", { configurable: true, get: () => ({ request }) });
  const first = renderHook(useCreatorDraftStore);
  await waitFor(() => expect(first.result.current.store).toBeDefined());
  const second = renderHook(useCreatorDraftStore);
  await waitFor(() => expect(second.result.current.busy).toBe(true));
  expect(second.result.current.store).toBeUndefined();
  first.unmount();
  await act(async () => {});
  act(() => second.result.current.retry());
  await waitFor(() => expect(second.result.current.store).toBeDefined());
});
