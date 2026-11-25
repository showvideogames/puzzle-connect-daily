import { Link, useInRouterContext } from "react-router-dom";
import { ChevronRight, Shapes } from "lucide-react";

const row = "mt-6 flex min-h-14 items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** My profile's way to the creator's own puzzle library (/my-puzzles). */
export function MyPuzzlesLink() {
  const inRouter = useInRouterContext();
  const body = (
    <>
      <Shapes aria-hidden="true" className="h-6 w-6 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-base font-bold">My Puzzles</span>
        <span className="block text-sm text-muted-foreground">Open, share, cover and list the puzzles you've made.</span>
      </span>
      <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0" />
    </>
  );
  return inRouter
    ? <Link to="/my-puzzles" className={row} data-testid="profile-my-puzzles">{body}</Link>
    : <a href="/my-puzzles" className={row} data-testid="profile-my-puzzles">{body}</a>;
}
