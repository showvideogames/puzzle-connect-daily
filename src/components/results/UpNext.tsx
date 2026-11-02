import { useId } from "react";
import { Link } from "react-router-dom";
import { moreGames } from "@/components/moreGames";
import { FULL_FORMAT, MINI_FORMAT, type PuzzleFormat } from "@/lib/puzzleFormat";

// The menu's own CrossPuns entry, so the two never drift; the same values here
// if it is ever missing, so the popup can't fail over a menu change.
const CROSSPUNS_FALLBACK = { title: "CrossPuns", href: "https://crosspuns.com/", icon: "crosspuns" };
const crossPuns: { title: string; href: string; icon: string } =
  moreGames.find((game) => game.icon === "crosspuns") ?? CROSSPUNS_FALLBACK;

const card =
  "flex aspect-square min-h-0 flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-secondary/50 p-3 text-center " +
  "transition-colors hover:bg-secondary active:scale-[0.98] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card";

function CardFace({ icon, title }: { icon: string; title: string }) {
  return (
    <>
      <img src={icon} alt="" width={64} height={64} decoding="async" className="h-14 w-14 rounded-xl object-contain sm:h-16 sm:w-16" />
      <span className="mt-1 text-base font-bold leading-tight text-foreground">{title}</span>
      <span className="text-[15px] leading-tight text-muted-foreground">Play</span>
    </>
  );
}

/**
 * Two games to play next, each a whole tappable card: the other Rainbow format,
 * then CrossPuns. Shown for every finished game. A Rainbow card closes the popup
 * as it goes, because the board behind it may stay mounted across the route
 * change; CrossPuns opens the way the menu's More Games does.
 */
export function UpNext({ format, onNavigate }: { format: PuzzleFormat["id"]; onNavigate: () => void }) {
  const title = useId();
  const other =
    format === "mini"
      ? { title: "Rainbow Categories", icon: "/icons/rainbow-icon-192-0e09e6d1.png", to: FULL_FORMAT.dailyPath }
      : { title: "Mini Categories", icon: "/icons/mini-icon-192-bf5daacd.png", to: MINI_FORMAT.dailyPath };

  return (
    <section aria-labelledby={title} data-testid="up-next" className="mt-6 text-left">
      {/* Not a heading: the result word stays the popup's only heading. */}
      <p id={title} className="text-lg font-extrabold leading-tight text-foreground">Up next</p>
      <ul className="mt-3 grid grid-cols-2 gap-3">
        <li className="flex">
          <Link to={other.to} onClick={onNavigate} className={`${card} w-full`}>
            <CardFace icon={other.icon} title={other.title} />
          </Link>
        </li>
        <li className="flex">
          <a href={crossPuns.href} target="_blank" rel="noopener noreferrer" className={`${card} w-full`}>
            <CardFace icon={`/game-icons/${crossPuns.icon}.png`} title={crossPuns.title} />
          </a>
        </li>
      </ul>
    </section>
  );
}
