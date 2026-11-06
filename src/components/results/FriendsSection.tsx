import { Component, useId, type ReactNode } from "react";
import { Users } from "lucide-react";

/**
 * The frame of the Friends' results section, and what it shows while the rest
 * loads. Kept apart from FriendsResults so the results popup can draw this
 * straight away without bringing the social client into the main chunk.
 */

/** `pending` marks the stand-in shown while the section's own code is still on its way. */
export function FriendsCard({ children, pending = false }: { children: ReactNode; pending?: boolean }) {
  const title = useId();
  return (
    <section
      aria-labelledby={title}
      data-testid="friends-results"
      data-pending={pending ? "true" : undefined}
      className="mt-5 rounded-2xl border border-border bg-secondary/40 px-4 py-4 text-left"
    >
      {/* Not a heading: the result word stays the popup's only heading. */}
      <p id={title} className="flex items-center gap-2 text-lg font-extrabold leading-tight text-foreground">
        <Users aria-hidden="true" className="h-5 w-5 shrink-0" />
        {"Friends' results"}
      </p>
      {children}
    </section>
  );
}

/** A few still rows of a fixed height, so nothing jumps when the real ones arrive. */
export function FriendsPlaceholder() {
  return (
    <div role="status" data-testid="friends-results-loading" className="mt-3 h-[9.5rem]">
      <span className="sr-only">{"Loading friends' results"}</span>
      {[0, 1, 2].map((row) => (
        <div key={row} aria-hidden="true" className="flex h-12 items-center gap-3 px-2">
          <span className="h-9 w-9 shrink-0 rounded-full bg-muted motion-safe:animate-pulse" />
          <span className="h-4 flex-1 rounded bg-muted motion-safe:animate-pulse" />
          <span className="h-4 w-20 rounded bg-muted motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  );
}

/** The one sentence for a section that couldn't load. It is never the same as an empty list. */
export function LoadProblem() {
  return <p role="alert" className="text-base text-foreground">{"Couldn't load friends' results right now."}</p>;
}

/**
 * If the section's own code can't be fetched, it says so inside the section;
 * the rest of the popup keeps working. A failed lazy import can't be asked for
 * again, so there is no Try again here.
 */
export class FriendsBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <FriendsCard>
        <div className="mt-3 text-center">
          <LoadProblem />
        </div>
      </FriendsCard>
    );
  }
}
