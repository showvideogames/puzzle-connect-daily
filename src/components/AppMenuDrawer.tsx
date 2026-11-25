import { useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { CircleHelp, Menu, MessageSquareText, SquarePen, UsersRound, X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { MINI_ICONS } from "@/lib/appIcons";
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
  state?: unknown;
  tone: string;
}

const PLAY = [
  { to: "/", label: "Today's Puzzle", detail: null, art: "full", tone: "bg-[#e7d5f5] dark:bg-[#48345b]" },
  { to: "/archive", label: "Puzzle Archive", detail: "Past daily puzzles.", art: "archive", tone: "bg-[#f5e3bd] dark:bg-[#4d3a25]" },
  { to: "/mini", label: "Rainbow Mini", detail: "A smaller daily.", art: "mini", tone: "bg-[#c6e9ec] dark:bg-[#24464c]" },
  { to: "/mini/archive", label: "Mini Archive", detail: "Past mini puzzles.", art: "miniArchive", tone: "bg-[#cfe9d7] dark:bg-[#2b493a]" },
] as const;
type PlayArt = typeof PLAY[number]["art"];

const DESTINATIONS: Destination[] = [
  { to: "/create", label: "Create A Puzzle", icon: SquarePen, tone: "bg-[#f0e9fb] text-[#483862] dark:bg-[#443458] dark:text-[#eadbfd]" },
  { to: "/how-to-play", label: "How To Play", icon: CircleHelp, tone: "bg-[#fff3e1] text-[#6a5445] dark:bg-[#493727] dark:text-[#ffe4bc]" },
];

const FRIENDS: Destination = {
  to: "/friends", label: "Friends & Groups", icon: UsersRound, state: { friendsHome: true },
  tone: "bg-[#ebefff] text-[#455288] dark:bg-[#303955] dark:text-[#dce4ff]",
};

const focusClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const rowClass = `flex min-h-12 w-full items-center gap-3 rounded-xl px-1.5 text-left text-[15px] font-bold leading-tight text-foreground hover:bg-secondary transition-colors aria-[current=page]:bg-secondary ${focusClass}`;

function MenuArt({ art }: { art: PlayArt }) {
  if (art === "full" || art === "mini") {
    const mini = art === "mini";
    return (
      <span
        aria-hidden="true"
        className={`grid shrink-0 place-items-center overflow-hidden ${mini ? "h-12 w-12 -rotate-[8deg] rounded-[10px] bg-[#63bdb5]" : "h-14 w-14 rounded-xl"}`}
      >
        {mini ? (
          <span className="relative block h-10 w-10 overflow-hidden rounded-md">
            <img src={MINI_ICONS.apple} alt="" width={50} height={50} className="absolute -left-[5px] -top-[5px] h-[50px] w-[50px] max-w-none" />
          </span>
        ) : (
          <img src="/icons/rainbow-icon-192-0e09e6d1.png" alt="" width={56} height={56} className="block h-full w-full" />
        )}
      </span>
    );
  }

  const mini = art === "miniArchive";
  return (
    <svg aria-hidden="true" viewBox="0 0 56 56" width={mini ? 48 : 56} height={mini ? 48 : 56} className="shrink-0">
      <rect x="5" y="9" width="46" height="44" rx="9" fill={mini ? "#acd0dc" : "#cbb4de"} />
      <rect x="5" y="7" width="46" height="44" rx="9" fill="white" />
      <path d="M5 16a9 9 0 0 1 9-9h28a9 9 0 0 1 9 9v5H5z" fill={mini ? "#4d91a7" : "#a172b8"} />
      <path d="M17 5v7m22-7v7" stroke="#51435c" strokeWidth="3" strokeLinecap="round" />
      {["#f1d1d7", "#f6e0b5", "#d5eadc", "#d9e9f5", "#e5d6f4", "#f1d1d7"].map((color, i) => (
        <rect key={i} x={13 + (i % 3) * 11} y={26 + Math.floor(i / 3) * 10} width="7" height="7" rx="1.4" fill={color} />
      ))}
    </svg>
  );
}

/** The shared hamburger drawer: Radix handles Escape, focus trap and restore. */
export function AppMenuDrawer({ onFeedback }: { onFeedback: () => void }) {
  const [open, setOpen] = useState(false);
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
        className="flex w-[min(100vw,24rem)] flex-col gap-0 bg-background p-0 text-foreground font-sans sm:max-w-[24rem] [&>button:last-child]:hidden"
        onCloseAutoFocus={() => {
          if (!feedbackNext.current) return;
          feedbackNext.current = false;
          requestAnimationFrame(() => onFeedback());
        }}
      >
        <div className="px-4 pt-4 max-[359px]:px-3">
          <div aria-hidden="true" className="mb-3 grid grid-cols-4 gap-px overflow-hidden rounded-full">
            {["bg-[#ffc20e]", "bg-[#1fae4b]", "bg-[#1e6ff0]", "bg-[#e8262b]"].map((tone) => <span key={tone} className={`h-[3px] ${tone}`} />)}
          </div>
          <div className="flex items-center justify-between gap-2 pb-3">
            <SheetTitle className="text-[26px] font-extrabold leading-none tracking-tight">Menu</SheetTitle>
            <SheetClose className={`${headerIconButton} border border-border bg-card`} aria-label="Close menu">
              <X aria-hidden="true" className={headerGlyph} strokeWidth={HEADER_STROKE} />
            </SheetClose>
          </div>
        </div>
        <SheetDescription className="sr-only">Rainbow Categories pages</SheetDescription>
        <nav aria-label="Main menu" className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] max-[359px]:px-3">
          <ul className="grid grid-cols-2 gap-2.5">
            {PLAY.map(({ to, label, detail, art, tone }, i) => {
              const wide = i < 2;
              return (
                <li key={to} className={wide ? "col-span-2 min-w-0" : "min-w-0"}>
                  <SheetClose asChild>
                    <NavLink to={to} end className={`flex h-full text-foreground rounded-[14px] p-3 transition-[filter] hover:brightness-95 dark:hover:brightness-125 active:brightness-90 aria-[current=page]:ring-1 aria-[current=page]:ring-inset aria-[current=page]:ring-foreground/20 ${wide ? "min-h-[74px] items-center gap-3" : "min-h-[109px] flex-col items-start gap-2 max-[359px]:px-2.5"} ${tone} ${focusClass}`}>
                      <MenuArt art={art} />
                      <span className="min-w-0">
                        <span className={`block font-extrabold leading-tight ${wide ? "text-[18px]" : "text-[16px]"}`}>{label}</span>
                        {detail && <span className="mt-0.5 block text-xs font-semibold leading-snug text-foreground/85">{detail}</span>}
                      </span>
                    </NavLink>
                  </SheetClose>
                </li>
              );
            })}
          </ul>
          <ul className="mt-3 space-y-0.5 border-t border-border pt-2">
            {destinations.map(({ to, label, icon: Icon, state, tone }) => (
              <li key={to}>
                <SheetClose asChild>
                  <NavLink to={to} state={state} end className={rowClass}>
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${tone}`}><Icon aria-hidden="true" className="h-4 w-4" strokeWidth={HEADER_STROKE} /></span>
                    {label}
                  </NavLink>
                </SheetClose>
              </li>
            ))}
            <li>
              <button type="button" className={rowClass} onClick={() => { feedbackNext.current = true; setOpen(false); }}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#fceff2] text-[#a15461] dark:bg-[#492b36] dark:text-[#f4b8c7]">
                  <MessageSquareText aria-hidden="true" className="h-4 w-4" strokeWidth={HEADER_STROKE} />
                </span>
                Send Feedback
              </button>
            </li>
          </ul>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
