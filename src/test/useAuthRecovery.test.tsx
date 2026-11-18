import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ getSession: vi.fn(), signOut: vi.fn(), callback: (_event: string, _session: any) => {} }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: {
  getSession: sdk.getSession, signOut: sdk.signOut,
  onAuthStateChange: (fn: typeof sdk.callback) => { sdk.callback = fn; return { data: { subscription: { unsubscribe() {} } } }; },
}, rpc: async () => ({ data: false, error: null }) } }));
vi.mock('@/lib/platformSignIn', () => ({ signOutOfRainbow: vi.fn() }));
import { useAuth } from '../hooks/useAuth';
const alice = { user: { id: 'alice' }, access_token: 'synthetic-a' };
beforeEach(() => { sdk.getSession.mockReset(); sdk.signOut.mockReset(); });
it('recovers from failed startup on reconnect without signing out', async () => {
  sdk.getSession.mockResolvedValueOnce({ data: { session: null }, error: new TypeError('offline') }).mockResolvedValue({ data: { session: alice }, error: null });
  const { result } = renderHook(useAuth);
  await waitFor(() => expect(result.current.authUnavailable).toBe(true));
  act(() => { window.dispatchEvent(new Event('online')); });
  await waitFor(() => expect(result.current.user?.id).toBe('alice'));
  expect(result.current.authUnavailable).toBe(false);
  expect(sdk.signOut).not.toHaveBeenCalled();
});
it('a successful renewal clears a failed check and genuine sign-out clears identity', async () => {
  sdk.getSession.mockRejectedValue(new TypeError('offline'));
  const { result } = renderHook(useAuth);
  await waitFor(() => expect(result.current.authUnavailable).toBe(true));
  act(() => sdk.callback('TOKEN_REFRESHED', alice));
  await waitFor(() => expect(result.current.user?.id).toBe('alice'));
  act(() => sdk.callback('SIGNED_OUT', null));
  expect(result.current.user).toBeNull();
});
it('a late startup response cannot restore an identity after sign-out', async () => {
  let release!: (value: unknown) => void;
  sdk.getSession.mockReturnValue(new Promise(r => { release = r; }));
  const { result } = renderHook(useAuth);
  act(() => sdk.callback('SIGNED_OUT', null));
  await act(async () => release({ data: { session: alice }, error: null }));
  expect(result.current.user).toBeNull();
});
it('a failed recheck keeps the confirmed identity and saved player data', async () => {
  sdk.getSession.mockResolvedValueOnce({ data: { session: alice }, error: null }).mockRejectedValue(new TypeError('offline'));
  localStorage.setItem('saved-progress-test', 'keep');
  const { result } = renderHook(useAuth);
  await waitFor(() => expect(result.current.user?.id).toBe('alice'));
  act(() => window.dispatchEvent(new Event('online')));
  await waitFor(() => expect(result.current.authUnavailable).toBe(true));
  expect(result.current.user?.id).toBe('alice');
  expect(localStorage.getItem('saved-progress-test')).toBe('keep');
});
