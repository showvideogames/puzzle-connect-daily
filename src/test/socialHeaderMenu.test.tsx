import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SocialHeaderMenu } from '@/components/social/SocialHeaderMenu';
import { HEADER_REFRESH } from '@/components/social/socialHeaderEvents';
import type { AppSocial } from '@/components/social/appSocial';
import type { SessionFacts } from '@/components/social/useSocialSession';

vi.mock('@/components/social/appSocial', () => ({ appSocial: vi.fn() }));
const signed = (scope = 'a'): SessionFacts => ({ state: { scope, credential: 'test' }, accountId: scope, storedOwner: scope, generation: 1, checkRunning: false });
function fixture() {
  let facts = signed();
  const listeners = new Set<() => void>();
  const readMe = vi.fn(async () => ({ ok: true, data: { displayName: 'Alex', animalId: 'fox', backgroundColor: '#DED1F2' } }));
  const readRequests = vi.fn(async () => ({ ok: true, data: { incoming: [{ requestRef: 'r1' }], outgoing: [{ requestRef: 'r2' }] } }));
  const call = vi.fn((op: string) => op === 'getMe' ? readMe() : readRequests());
  const social = { api: { client: { call, forget: vi.fn() } }, source: { read: () => facts, subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); } } } as unknown as AppSocial;
  const become = (next: SessionFacts) => act(() => { facts = next; listeners.forEach(fn => fn()); });
  return { social, call, readMe, readRequests, become };
}
function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}:{JSON.stringify(location.state)}</output>; }
function open(fake: ReturnType<typeof fixture>, onAccount = vi.fn()) {
  return render(<MemoryRouter><SocialHeaderMenu social={fake.social} onAccount={onAccount} /><Location /></MemoryRouter>);
}
async function openMenu() {
  const button = screen.getByRole('button', { name: /^Profile menu/ });
  fireEvent.keyDown(button, { key: 'Enter', code: 'Enter' });
  await screen.findByRole('menu');
}

describe('header identity and notifications', () => {
  it('counts incoming requests only and reads no results, friends, or groups', async () => {
    const fake = fixture(); open(fake);
    await screen.findByRole('button', { name: 'Profile menu, 1 pending notification' });
    expect(fake.call.mock.calls.map(([op]) => op)).toEqual(['getMe', 'listFriendRequests']);
    await openMenu();
    expect(screen.getByText('Alex')).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: /Friends & Groups/ })));
    expect(screen.getByTestId('location')).toHaveTextContent('/friends:{"friendsHome":true}');
  });
  it('opens the existing profile route with its edit request and preserves account action', async () => {
    const fake = fixture(); const account = vi.fn(); open(fake, account);
    await screen.findByTestId('profile-notification');
    await openMenu(); await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'My profile' })));
    expect(screen.getByTestId('location')).toHaveTextContent('/friends:{"editProfile":true}');
    await openMenu(); fireEvent.click(screen.getByRole('menuitem', { name: 'Account options' }));
    expect(account).toHaveBeenCalledOnce();
  });
  it('clears the count after decisions and hides an unavailable count', async () => {
    const fake = fixture(); open(fake);
    await screen.findByTestId('profile-notification');
    fake.readRequests.mockResolvedValueOnce({ ok: true, data: { incoming: [], outgoing: [] } });
    act(() => dispatchEvent(new Event(HEADER_REFRESH)));
    await waitFor(() => expect(screen.queryByTestId('profile-notification')).not.toBeInTheDocument());
    fake.readRequests.mockResolvedValueOnce({ ok: false, outcome: 'unavailable' } as never);
    act(() => dispatchEvent(new Event(HEADER_REFRESH)));
    await waitFor(() => expect(fake.readRequests).toHaveBeenCalledTimes(3));
    expect(screen.queryByTestId('profile-notification')).not.toBeInTheDocument();
  });
  it('retries a routine background account check without dropping the confirmed badge', async () => {
    const fake = fixture(); open(fake);
    await screen.findByTestId('profile-notification');
    fake.readRequests.mockResolvedValueOnce({ ok: false, outcome: 'still_checking' } as never);
    act(() => dispatchEvent(new Event(HEADER_REFRESH)));
    await waitFor(() => expect(fake.readRequests).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('profile-notification')).toBeInTheDocument();
    await waitFor(() => expect(fake.readRequests).toHaveBeenCalledTimes(3), { timeout: 2000 });
    expect(screen.getByTestId('profile-notification')).toBeInTheDocument();
  });
  it('clears immediately on account change and ignores the previous response', async () => {
    const fake = fixture(); let finish!: (value: unknown) => void;
    fake.readMe.mockImplementationOnce(() => new Promise(resolve => { finish = resolve as never; }));
    open(fake);
    await waitFor(() => expect(fake.readMe).toHaveBeenCalledOnce());
    fake.readMe.mockResolvedValue({ ok: true, data: { displayName: 'Ben', animalId: 'owl', backgroundColor: '#DED1F2' } });
    fake.become(signed('b'));
    await screen.findByTestId('profile-notification');
    await act(async () => finish({ ok: true, data: { displayName: 'Alex', animalId: 'fox', backgroundColor: '#DED1F2' } }));
    await openMenu();
    expect(screen.getByText('Ben')).toBeInTheDocument();
    expect(screen.queryByText('Alex')).not.toBeInTheDocument();
  });
  it('drops identity and notifications for a failed account check and makes no new requests', async () => {
    const fake = fixture(); open(fake);
    await screen.findByTestId('profile-notification');
    fake.become({ ...signed(), state: 'checking', checkRunning: false });
    expect(screen.queryByTestId('profile-notification')).not.toBeInTheDocument();
    expect(fake.call).toHaveBeenCalledTimes(2);
    await openMenu();
    expect(screen.queryByText('Alex')).not.toBeInTheDocument();
    expect(screen.getByText('Your account')).toBeInTheDocument();
    expect(fake.call).toHaveBeenCalledTimes(2);
  });
});
