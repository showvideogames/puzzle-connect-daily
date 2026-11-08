import { useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { Calendar, CircleHelp, Grid2x2, Grid3x3, Menu, MessageSquareText, SquarePen, UsersRound, X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { socialBetaOn } from "@/components/social/socialFlag";

/** The header's own 44px target: a 24px glyph in the foreground colour, as in the header concept. */
export const headerIconButton =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-secondary active:scale-95 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card";
export const headerGlyph = "h-6 w-6";
export const HEADER_STROKE = 2.25;

interface Destination {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** Existing pages only. Nothing here is new; it is what the old header and Settings > Menu already reached. */
const DESTINATIONS: Destination[] = [
  { to: "/", label: "Today's puzzle", icon: Grid3x3 },
  { to: "/mini", label: "Rainbow Mini", icon: Grid2x2 },
  { to: "/archive", label: "Puzzle archive", icon: Calendar },
  { to: "/mini/archive", label: "Mini archive", icon: Calendar },
  { to: "/create", label: "Create a puzzle", icon: SquarePen },
  { to: "/how-to-play", label: "How to play", icon: CircleHelp },
];

const FRIENDS: Destination = { to: "/friends", label: "Friends & Groups", icon: UsersRound };

const rowClass =
  "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base font-bold text-foreground hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-secondary";

/**
 * The hamburger and its left-hand drawer. Radix gives it Escape, the focus trap,
 * and focus back on the hamburger when it closes.
 */
export function AppMenuDrawer({ onFeedback }: { onFeedback: () => void }) {
  const [open, setOpen] = useState(false);
  // Feedback opens once the drawer has finished closing and Radix has put focus
  // back on the hamburger (the frame after onCloseAutoFocus), so the feedback
  // dialog records the hamburger, not <body>, and returns focus there.
  const feedbackNext = useRef(false);
  const destinations = socialBetaOn() ? [...DESTINATIONS, FRIENDS] : DESTINATIONS;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button type="button" aria-label="Menu" className={headerIconButton}>
          <Menu aria-hidden="true" className={headerGlyph} strokeWidth={HEADER_STROKE} />
        </button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="flex w-[min(20rem,85vw)] flex-col gap-0 bg-card p-0 [&>button:last-child]:hidden"
        onCloseAutoFocus={() => {
          if (!feedbackNext.current) return;
          feedbackNext.current = false;
          requestAnimationFrame(() => onFeedback());
        }}
      >
        <div className="flex items-center justify-between border-b border-border py-2 pl-5 pr-2">
          <SheetTitle className="text-xl font-extrabold">Menu</SheetTitle>
          <SheetClose className={headerIconButton} aria-label="Close menu">
            <X aria-hidden="true" className={headerGlyph} strokeWidth={HEADER_STROKE} />
          </SheetClose>
        </div>
        <SheetDescription className="sr-only">Rainbow Categories pages</SheetDescription>
        <nav aria-label="Main menu" className="min-h-0 flex-1 overflow-y-auto p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <ul className="space-y-1">
            {destinations.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <SheetClose asChild>
                  <NavLink to={to} end className={rowClass}>
                    <Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-slate" strokeWidth={HEADER_STROKE} />
                    {label}
                  </NavLink>
                </SheetClose>
              </li>
            ))}
            <li className="mt-2 border-t border-border pt-2">
              <button type="button" className={rowClass} onClick={() => { feedbackNext.current = true; setOpen(false); }}>
                <MessageSquareText aria-hidden="true" className="h-5 w-5 shrink-0 text-slate" strokeWidth={HEADER_STROKE} />
                Give feedback
              </button>
            </li>
          </ul>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
