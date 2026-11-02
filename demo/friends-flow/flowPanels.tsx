import { accountPanel } from "@/components/account/accountStyles";

/** Stand-ins for what the real app would show around these screens, in the onboarding preview's style. */

export function Waiting({ label }: { label: string }) {
  return (
    <main className={`${accountPanel} preview-signin`} data-testid="flow-waiting">
      <p className="preview-tag">{label}</p>
    </main>
  );
}

export function GuestPanel() {
  return (
    <main className={`${accountPanel} preview-signin`} data-testid="flow-guest">
      <p className="preview-tag">Stand-in for the page a guest came from</p>
      <h1 className="font-tile text-2xl font-extrabold tracking-tight text-foreground">You're a guest</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Friends and Groups need an account. Choose a person in the bar, or open a link: a guest can see an invitation.
      </p>
    </main>
  );
}
