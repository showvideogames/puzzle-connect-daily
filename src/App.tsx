import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import Admin from "./pages/Admin.tsx";
import Archive from "./pages/Archive.tsx";
import ArchivePuzzle from "./pages/ArchivePuzzle.tsx";
import BetaLibrary from "./pages/BetaLibrary.tsx";
import BetaPuzzle from "./pages/BetaPuzzle.tsx";
import CreatePuzzle from "./pages/CreatePuzzle.tsx";
import CustomPuzzle from "./pages/CustomPuzzle.tsx";
import CreatorProfilePage from "./pages/CreatorProfile.tsx";
import { MiniDaily, MiniArchivePuzzle } from "./pages/Mini.tsx";
import MiniArchive from "./pages/MiniArchive.tsx";
import Favorites from "./pages/Favorites.tsx";
import ResetPassword from "./pages/ResetPassword.tsx";
import Privacy from "./pages/Privacy.tsx";
import Terms from "./pages/Terms.tsx";
import HowToPlay from "./pages/HowToPlay.tsx";
import NotFound from "./pages/NotFound.tsx";
import { OnboardingGate } from "@/components/OnboardingGate";

// Dev-only visual fixtures. import.meta.env.DEV is statically false in a
// production build, so this lazy import (and the whole fixture module) is
// removed from the bundle.
const CommunityFixtures = import.meta.env.DEV ? lazy(() => import("./dev/CommunityFixtures.tsx")) : null;
const MiniFixtures = import.meta.env.DEV ? lazy(() => import("./dev/MiniFixtures.tsx")) : null;
const LuckyBotFixtures = import.meta.env.DEV ? lazy(() => import("./dev/LuckyBotFixtures.tsx")) : null;

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <OnboardingGate>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/archive" element={<Archive />} />
          <Route path="/archive/:puzzleId" element={<ArchivePuzzle />} />
          {/* Legacy free-puzzle URLs (old shared/bookmarked links) now render
              the exact same shared archived-puzzle page — there is no
              separate FreePuzzle component anymore. New navigation (Archive's
              Free Puzzles cards) links straight to /archive/:puzzleId. */}
          <Route path="/free/:puzzleId" element={<ArchivePuzzle />} />
          {/* Mini 3×3 — the sibling Daily. Same page components as "/" and
              /archive/:id, configured with the Mini format (see
              pages/Mini.tsx and lib/puzzleFormat.ts), so there is one game
              system and two sizes rather than two implementations. */}
          <Route path="/mini" element={<MiniDaily />} />
          <Route path="/mini/archive" element={<MiniArchive />} />
          <Route path="/mini/archive/:puzzleId" element={<MiniArchivePuzzle />} />
          {/* Unlisted playtesting area — never linked from normal nav, kept
              out of search indexes via SEO's noIndex (see BetaLibrary/
              BetaPuzzle). No login, no admin gate: unlisted, not secret. */}
          <Route path="/beta" element={<BetaLibrary />} />
          <Route path="/beta/:puzzleId" element={<BetaPuzzle />} />
          {/* Public custom-puzzle creator (Phase 2). Anyone may create,
              signed in or not; /custom/:shareId is the playable link. */}
          <Route path="/create" element={<CreatePuzzle />} />
          {/* /p/:shortCode is the link new shares use; /custom/:shareId is the
              permanent original. Both render the same page and puzzle identity. */}
          <Route path="/p/:shortCode" element={<CustomPuzzle />} />
          <Route path="/custom/:shareId" element={<CustomPuzzle />} />
          <Route path="/creator/:publicSlug" element={<CreatorProfilePage />} />
          <Route path="/favorites" element={<Favorites />} />
          {CommunityFixtures && (
            <Route path="/__fixtures/community" element={<Suspense fallback={null}><CommunityFixtures /></Suspense>} />
          )}
          {MiniFixtures && (
            <Route path="/__fixtures/mini" element={<Suspense fallback={null}><MiniFixtures /></Suspense>} />
          )}
          {LuckyBotFixtures && (
            <Route path="/__fixtures/lucky-bot" element={<Suspense fallback={null}><LuckyBotFixtures /></Suspense>} />
          )}
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/how-to-play" element={<HowToPlay />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </OnboardingGate>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
