import type { ReactNode } from "react";
import type { CatalogGame } from "@/lib/gameCatalog";
import type { SharedProfile } from "@/lib/sharedProfile";
import { primaryAction } from "./accountStyles";
import { ProfileAvatar } from "./ProfileAvatar";

interface GamePickerProps {
  games: readonly CatalogGame[];
  /** Whose avatar sits in the corner. Left out, there is none, as for a guest. */
  profile?: SharedProfile | null;
  /** The corner avatar becomes a way into settings and the profile. */
  onOpenProfile?: () => void;
  /** Wide cover art. Without it a game shows its small icon on a plain panel. */
  renderCover?: (game: CatalogGame) => ReactNode;
  /** Beside another main heading, as on the setup screen. */
  embedded?: boolean;
}

function DefaultCover({ game }: { game: CatalogGame }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-secondary">
      <img src={game.iconSrc} alt="" loading="lazy" decoding="async" className="h-20 w-20 rounded-2xl object-contain" />
    </div>
  );
}

function GameCard({ game, cover }: { game: CatalogGame; cover: ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col" data-testid="game-card" data-game={game.id}>
      <div className="relative h-40 overflow-hidden rounded-2xl sm:h-44 xl:h-48">{cover}</div>
      <div className="flex items-center justify-between gap-3 px-1 pt-2.5">
        <div className="min-w-0">
          <h3 className="font-tile text-lg font-bold leading-tight text-foreground">{game.title}</h3>
          <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-muted-foreground">{game.description}</p>
        </div>
        <a
          href={game.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Play ${game.title} (opens in a new tab)`}
          className={`${primaryAction} h-10 shrink-0`}
        >
          Play
        </a>
      </div>
    </li>
  );
}

/**
 * "What shall we play?": a wide cover and a Play link for every game, open to
 * anyone, with or without an account or a profile. Each Play is a plain link to
 * the game's own site.
 */
export function GamePicker({ games, profile, onOpenProfile, renderCover, embedded = false }: GamePickerProps) {
  const Heading = embedded ? "h2" : "h1";
  const avatar = profile && (
    <ProfileAvatar animalId={profile.animalId} backgroundColor={profile.backgroundColor} size={56} />
  );
  return (
    <section aria-labelledby="game-picker-title" data-testid="game-picker">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Heading id="game-picker-title" className="font-tile text-[2rem] font-extrabold leading-[1.1] tracking-tight text-foreground sm:text-[2.5rem]">
            What shall we play?
          </Heading>
          <p className="mt-1.5 text-base text-muted-foreground">Pick a game and jump in.</p>
        </div>
        {avatar && onOpenProfile ? (
          <button
            type="button"
            onClick={onOpenProfile}
            aria-label="Open your profile"
            className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {avatar}
          </button>
        ) : avatar}
      </header>
      <ul className="mt-5 grid grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2">
        {games.map((game) => (
          <GameCard key={game.id} game={game} cover={renderCover ? renderCover(game) : <DefaultCover game={game} />} />
        ))}
      </ul>
      <p className="mt-6 flex items-center gap-4 text-sm text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
        Your next daily obsession is one click away.
      </p>
    </section>
  );
}
