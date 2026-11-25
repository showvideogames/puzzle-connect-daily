import "./menu-nunito.css";
import { useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { Menu, UsersRound, X } from "lucide-react";
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
  icon: "create" | "book" | "friends";
  state?: unknown;
  tone: string;
}

const PLAY = [
  { to: "/", label: "Today's Puzzle", detail: null, art: "full", tone: "bg-[#e8d7ff] dark:bg-[#48345b]" },
  { to: "/archive", label: "Puzzle Archive", detail: "Past daily puzzles.", art: "archive", tone: "bg-[#fff08c] dark:bg-[#54471e]" },
  { to: "/mini", label: "Rainbow Mini", detail: "A smaller daily.", art: "mini", tone: "bg-[#b7edf0] dark:bg-[#24464c]" },
  { to: "/mini/archive", label: "Mini Archive", detail: "Past mini puzzles.", art: "miniArchive", tone: "bg-[#c3f1d3] dark:bg-[#2b493a]" },
] as const;
type PlayArt = typeof PLAY[number]["art"];

const DESTINATIONS: Destination[] = [
  { to: "/create", label: "Create A Puzzle", icon: "create", tone: "bg-[#f0e9fb] dark:bg-[#443458]" },
  { to: "/how-to-play", label: "How To Play", icon: "book", tone: "bg-[#fff6d7] dark:bg-[#493727]" },
];

const FRIENDS: Destination = {
  to: "/friends", label: "Friends & Groups", icon: "friends", state: { friendsHome: true },
  tone: "bg-[#ebefff] dark:bg-[#303955]",
};

const focusClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const rowClass = `flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left text-[18px] font-black [font-family:'Nunito_Menu','Nunito_Sans_Variable',sans-serif] leading-tight text-foreground hover:brightness-95 dark:hover:brightness-125 transition-[filter] aria-[current=page]:ring-1 aria-[current=page]:ring-inset aria-[current=page]:ring-foreground/25 ${focusClass}`;

function MenuArt({ art }: { art: PlayArt }) {
  if (art === "mini") {
    return <img aria-hidden="true" src="/icons/mini-lagoon-tilted.png" alt="" width={62} height={62} className="block h-[60px] w-[60px] shrink-0" />;
  }
  if (art === "full") {
    return <img aria-hidden="true" src="/icons/rainbow-icon-192-0e09e6d1.png" alt="" width={66} height={66} className="block h-16 w-16 shrink-0 rounded-xl" />;
  }

  const mini = art === "miniArchive";
  return (
    <svg aria-hidden="true" viewBox="0 0 56 56" width={mini ? 60 : 64} height={mini ? 60 : 64} className="shrink-0">
      <rect x="7" y="10" width="46" height="43" rx="9" fill={mini ? "#80ced0" : "#c5a5f0"} />
      <rect x="5" y="7" width="46" height="44" rx="9" fill="white" />
      <path d="M5 16a9 9 0 0 1 9-9h28a9 9 0 0 1 9 9v6H5z" fill={mini ? "#49c4c3" : "#c689e9"} />
      <rect x="5" y="7" width="46" height="44" rx="9" stroke="#231d2a" strokeWidth="3.2" fill="none" />
      <path d="M5 22h46" stroke="#231d2a" strokeWidth="3.2" />
      {[15, 37].map(x => <rect key={x} x={x} y="2.5" width="4.5" height="12" rx="2.25" stroke="#231d2a" strokeWidth="2.6" fill={mini ? "#49c4c3" : "#c689e9"} />)}
      {["#f54959", "#ffab34", "#ffc20e", "#1fae4b", "#3776f2", "#a45de8"].map((color, i) => (
        <rect key={i} x={13 + (i % 3) * 11} y={27 + Math.floor(i / 3) * 10} width="7" height="7" rx="1.8" fill={color} />
      ))}
    </svg>
  );
}

function RowArt({ icon }: { icon: Destination["icon"] | "feedback" }) {
  if (icon === "friends") return <UsersRound aria-hidden="true" className="h-6 w-6 text-foreground" strokeWidth={HEADER_STROKE} />;
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className="h-[35px] w-[35px] shrink-0" fill="none" stroke="#231d2a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {icon === "create" && <>
        <rect x="3" y="7" width="20" height="22" rx="3.5" fill="white" />
        <path d="M3 18h20M13 7v22" />
        <path d="m13 22 1.3-5.8L25 5.5l4.3 4.3-10.7 10.7z" fill="#ffd150" />
        <path d="m23 7.5 2.8-2.8a1.5 1.5 0 0 1 2.1 0l2.2 2.2a1.5 1.5 0 0 1 0 2.1l-2.8 2.8z" fill="#f16e96" />
      </>}
      {icon === "book" && <>
        <path d="M3 9c5-1 9 .5 13 3 4-2.5 8-4 13-3v17c-5-1-9 .2-13 2.5C12 26 8 25 3 26z" fill="#ffe462" />
        <path d="M5 6c5-1 8.5.5 11 3v17c-3.8-2.5-7.5-3.2-11-2.5z" fill="#d9b7ff" />
        <path d="M27 6c-5-1-8.5.5-11 3v17c3.8-2.5 7.5-3.2 11-2.5z" fill="#a8e6f4" />
      </>}
      {icon === "feedback" && <>
        <path d="M29 16c0 6-5.6 10-12 10h-4l-6 4 1-6c-2.6-2-4-4.9-4-8 0-6 5.6-10 12.5-10S29 10 29 16z" fill="#ef9cb7" stroke="none" />
        <path d="M27 14c0 5.7-5.4 9.7-12 9.7h-3.2L5 28l1.1-6.4c-2.4-1.7-3.6-4.4-3.6-7.6 0-5.8 5.5-10 12.3-10S27 8.2 27 14z" fill="white" />
        {[9.5, 14.7, 19.9].map(x => <circle key={x} cx={x} cy="14" r="1.15" fill="#231d2a" stroke="none" />)}
      </>}
    </svg>
  );
}

function TileSticker({ compact }: { compact: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 48 42" className={`shrink-0 text-foreground ${compact ? "absolute right-2.5 top-3 h-8 w-9 max-[359px]:h-7 max-[359px]:w-8" : "ml-auto h-10 w-11 max-[359px]:h-8 max-[359px]:w-9"}`} fill="none">
    <rect x="22" y="15" width="21" height="21" rx="4" transform="rotate(17 22 15)" fill="currentColor" fillOpacity=".14" stroke="currentColor" strokeWidth="2.3" />
    <rect x="3" y="10" width="22" height="22" rx="4" transform="rotate(-12 3 10)" className="fill-white dark:fill-background" stroke="currentColor" strokeWidth="2.3" />
  </svg>;
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
            <SheetTitle className="text-[32px] font-black [font-family:'Nunito_Menu','Nunito_Sans_Variable',sans-serif] leading-none">Menu</SheetTitle>
            <SheetClose className={`${headerIconButton} border border-foreground/65 bg-card shadow-[2px_2px_0_#ccb5ee] dark:shadow-none`} aria-label="Close menu">
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
                    <NavLink to={to} end className={`relative flex h-full text-foreground rounded-[14px] border-[1.5px] border-foreground/80 dark:border-foreground/50 p-3 transition-[filter] hover:brightness-95 dark:hover:brightness-125 active:brightness-90 aria-[current=page]:ring-1 aria-[current=page]:ring-inset aria-[current=page]:ring-foreground/15 ${wide ? "min-h-[84px] items-center gap-3 max-[359px]:gap-2" : "min-h-[117px] flex-col items-start gap-2 max-[359px]:px-2.5"} ${tone} ${focusClass}`}>
                      <MenuArt art={art} />
                      <span className="min-w-0">
                        <span className={`block font-black [font-family:'Nunito_Menu','Nunito_Sans_Variable',sans-serif] leading-[1.08] ${wide ? "text-[23px] max-[359px]:text-[21px]" : "text-[20px] max-[359px]:text-[18px]"}`}>{label}</span>
                        {detail && <span className="mt-0.5 block text-[13px] font-bold leading-snug text-foreground/90">{detail}</span>}
                      </span>
                      <TileSticker compact={!wide} />
                    </NavLink>
                  </SheetClose>
                </li>
              );
            })}
          </ul>
          <ul className="mt-3 space-y-1.5 border-t border-border pt-2.5">
            {destinations.map(({ to, label, icon, state, tone }) => (
              <li key={to}>
                <SheetClose asChild>
                  <NavLink to={to} state={state} end className={`${rowClass} ${tone}`}>
                    <RowArt icon={icon} />
                    {label}
                  </NavLink>
                </SheetClose>
              </li>
            ))}
            <li>
              <button type="button" className={`${rowClass} bg-[#fbdce7] dark:bg-[#492b36]`} onClick={() => { feedbackNext.current = true; setOpen(false); }}>
                <RowArt icon="feedback" />
                Send Feedback
              </button>
            </li>
          </ul>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
