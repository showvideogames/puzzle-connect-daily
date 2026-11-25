import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { CommunityHeader } from "@/components/community/CommunityHeader";
import { CoverPicker, NO_COVER, draftToCover, type CoverDraft } from "@/components/community/CoverPicker";
import { cv } from "@/lib/communityStyle";
import { useGamePageTheme } from "@/hooks/useGamePageTheme";
import { publishDemoPuzzle } from "./fixtureClient";

/**
 * The showcase's stand-in for /create: name a fictional puzzle, make its cover
 * with the real picker, "publish" it into this visit's Newest, and see the
 * card. The real builder also asks for the four categories; this demo fills
 * those in with a fixed fictional board so the cover step is the focus.
 */
export default function ShowcaseCreate() {
  useGamePageTheme();
  const navigate = useNavigate();
  const [title, setTitle] = useState("My Demo Puzzle");
  const [draft, setDraft] = useState<CoverDraft>(NO_COVER);
  return (
    <div className="min-h-screen bg-background pb-16">
      <CommunityHeader user={null} />
      <main className="mx-auto w-full max-w-xl px-4">
        <Link to="/community" className={`mt-2 inline-flex h-11 items-center gap-1 rounded-full pr-3 text-sm font-extrabold ${cv.ink} ${cv.focus}`}>
          <ChevronLeft aria-hidden="true" className="h-5 w-5" /> Explore
        </Link>
        <h1 className={`mt-1 text-[30px] font-black tracking-tight ${cv.ink}`}>Create a puzzle</h1>
        <p className="text-sm text-muted-foreground">Demo: the real builder also has you write four categories. Here a fictional board is filled in so you can try the cover.</p>
        <label htmlFor="demo-title" className={`mt-4 block text-sm font-extrabold ${cv.ink}`}>Puzzle title</label>
        <input
          id="demo-title"
          value={title}
          maxLength={100}
          onChange={(e) => setTitle(e.target.value)}
          className={`mt-1 h-11 w-full rounded-xl border border-input bg-card px-3 text-base text-foreground ${cv.focus}`}
        />
        <div className="mt-4">
          <CoverPicker value={draft} onChange={setDraft} title={title} creatorName="You (demo)" />
        </div>
        <button
          type="button"
          onClick={() => { publishDemoPuzzle(title, draftToCover(draft)); navigate("/community"); }}
          className={`mt-4 inline-flex h-12 w-full items-center justify-center rounded-full text-base font-extrabold ${cv.play} ${cv.focus}`}
        >
          Publish demo
        </button>
        <p className="mt-2 text-center text-xs text-muted-foreground">Nothing is saved. It appears in this visit's Newest only.</p>
      </main>
    </div>
  );
}
