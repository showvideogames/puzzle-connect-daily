import type { ReactNode } from "react";
import { accountPanel } from "./accountStyles";

/**
 * The approved two-panel layout: setup on the left, the games on the right, and
 * those games are open, because no game needs a profile. On a phone there is
 * only room for the form, and Continue or Later leads on to the games.
 */
export function SetupScreen({ form, picker }: { form: ReactNode; picker: ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-[76rem] items-start gap-5 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)]">
      <main className={`${accountPanel} p-5 sm:p-7 lg:sticky lg:top-5`}>{form}</main>
      <aside className={`${accountPanel} hidden p-7 lg:block`} data-testid="games-beside-setup">{picker}</aside>
    </div>
  );
}
