import { Link } from "react-router-dom";
import { Heart } from "lucide-react";

interface CustomPuzzleCtaProps {
  /** Validated external support URL, or null to omit the support action. */
  supportUrl: string | null;
}

/**
 * Bottom-of-page call to action for custom puzzles only: make your own (the
 * strongest action) and, when a support destination is configured, support
 * the site. Without a support URL the section is just the Create action.
 */
export function CustomPuzzleCta({ supportUrl }: CustomPuzzleCtaProps) {
  return (
    <section
      data-testid="custom-cta"
      aria-labelledby="custom-cta-heading"
      className="w-full max-w-[840px] mt-8 px-4"
    >
      <div className="rounded-2xl border border-border bg-card shadow-sm px-5 py-6 text-center">
        <h2 id="custom-cta-heading" className="font-tile font-bold tracking-tight text-foreground text-2xl">
          Enjoyed this puzzle?
        </h2>
        <p className="mt-1 text-foreground text-base">Make your own and challenge your friends.</p>

        <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
          <Link
            to="/create"
            className="inline-flex items-center justify-center h-12 px-8 rounded-full bg-primary text-primary-foreground
              text-base font-bold shadow-md hover:bg-primary/90 active:scale-95 transition
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Create Your Own
          </Link>
          {supportUrl && (
            <a
              href={supportUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 h-12 px-6 rounded-full border border-border bg-card
                text-foreground text-base font-semibold hover:bg-secondary active:scale-95 transition
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Heart aria-hidden="true" className="w-5 h-5 shrink-0 fill-current text-red-500" />
              Keep the Puzzles Coming
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </div>

        {supportUrl && (
          <p className="mt-4 text-sm text-muted-foreground">
            Rainbow Categories is free to play. Your support helps fund new puzzles and future games.
          </p>
        )}
      </div>
    </section>
  );
}
