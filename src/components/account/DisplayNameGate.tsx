import { accountPanel, outlineAction, primaryAction, quietText } from "./accountStyles";

interface DisplayNameGateProps {
  onChooseName: () => void;
  onNotNow: () => void;
}

/**
 * Asked at the moment someone reaches for Friends or Groups without a Display
 * Name. Nothing else asks: every game works without one.
 */
export function DisplayNameGate({ onChooseName, onNotNow }: DisplayNameGateProps) {
  return (
    <main className={`${accountPanel} mx-auto w-full max-w-[28rem] px-6 py-8 text-center sm:px-8`} data-testid="display-name-gate">
      <h1 className="font-tile text-2xl font-extrabold tracking-tight text-foreground">Choose a Display Name first</h1>
      <p className={`mt-3 text-base ${quietText}`}>
        Friends and Groups show your Display Name, so people know who you are. Your games don't need one.
      </p>
      <button type="button" onClick={onChooseName} className={`${primaryAction} mt-6 h-12 w-full text-base`}>
        Choose a Display Name
      </button>
      <button type="button" onClick={onNotNow} className={`${outlineAction} mt-3 h-12 w-full text-base`}>Not now</button>
    </main>
  );
}
