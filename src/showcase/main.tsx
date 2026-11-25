/**
 * Entry point of the Arcade Shelf showcase: the real Community Explore and
 * custom-puzzle pages, built with vite.showcase.config.ts against the
 * in-memory fixture client. See src/showcase/README.md.
 */
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, Navigate, RouterProvider, createHashRouter, createMemoryRouter, type RouteObject } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import CommunityPage from "@/pages/Community";
import CustomPuzzle from "@/pages/CustomPuzzle";
import CreatorProfilePage from "@/pages/CreatorProfile";
import ShowcaseCreate from "./ShowcaseCreate";
import { cv } from "@/lib/communityStyle";
import "@/index.css";

// Start in the host's theme the first time (the app keeps its own setting after that).
try {
  if (!localStorage.getItem("connections-settings")) {
    const host = document.documentElement.dataset.theme;
    const dark = host ? host === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    localStorage.setItem("connections-settings", JSON.stringify({ darkMode: dark }));
  }
  localStorage.setItem("tutorial-seen", "true");
} catch {
  // storage blocked: the app falls back to its defaults
}

function NotInShowcase() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className={`text-2xl font-black ${cv.ink}`}>Not part of this preview</h1>
      <p className="text-sm text-muted-foreground">This preview shows Community Puzzles with fictional puzzles. Other Rainbow pages aren't included.</p>
      <Link to="/community" className={`inline-flex h-11 items-center rounded-full px-6 text-sm font-extrabold ${cv.play} ${cv.focus}`}>Back to Community</Link>
    </main>
  );
}

function PreviewNote() {
  return (
    <p className="bg-background pt-2 text-center text-xs font-semibold text-muted-foreground" data-testid="showcase-note">
      Preview with fictional puzzles. Nothing you do here is saved to Rainbow Categories.
    </p>
  );
}

const routes: RouteObject[] = [
  { path: "/", element: <Navigate to="/community" replace /> },
  { path: "/community", element: <><PreviewNote /><CommunityPage /></> },
  { path: "/p/:shortCode", element: <><PreviewNote /><CustomPuzzle /></> },
  { path: "/custom/:shareId", element: <><PreviewNote /><CustomPuzzle /></> },
  { path: "/creator/:publicSlug", element: <><PreviewNote /><CreatorProfilePage /></> },
  { path: "/create", element: <><PreviewNote /><ShowcaseCreate /></> },
  { path: "*", element: <NotInShowcase /> },
];

// In memory by default (the hosted Artifact keeps only a plain #name in its URL);
// a hash router for static hosting gets working Back and shareable deep links.
const router = import.meta.env.VITE_SHOWCASE_ROUTER === "hash"
  ? createHashRouter(routes)
  : createMemoryRouter(routes, { initialEntries: ["/community"] });

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  </HelmetProvider>,
);
