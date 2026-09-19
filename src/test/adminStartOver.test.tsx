/**
 * Admin "Start Over": clears the visible form (Date included) but keeps the
 * hidden editing identity, so a saved puzzle is untouched until Update.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FakeSupabase } from "./fakeSupabase";

const db = new FakeSupabase();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    storage: { from: () => ({ list: async () => ({ data: [], error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
    auth: {
      getUser: () => db.auth.getUser(),
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: async () => {},
    },
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-1" }, loading: false, isAdmin: true, signOut: async () => {} }),
}));
vi.mock("@/components/ArchiveAccessManager", () => ({ ArchiveAccessManager: () => null }));
vi.mock("@/components/admin/FeedbackList", () => ({ FeedbackList: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => {} }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import Admin from "@/pages/Admin";

const WORDS = [
  ["BLUE", "GREEN", "RED", "YELLOW"],
  ["BATTERY", "HOOD", "TIRE", "TRUNK"],
  ["HOUSTON", "MARS", "MERCURY", "SWIFT"],
  ["BIRD", "DOG", "TREE", "WHITE"],
];

beforeEach(() => {
  window.scrollTo = () => {};
  localStorage.clear();
  db.signIn("admin-1", { admin: true });
  db.tables.puzzles = [
    {
      id: "p1", date: "2026-10-01", title: "Saved Puzzle", is_published: false, is_beta: false, designer_name: "Sam West",
      word_order: null, rainbow_herring: null, rainbow_category_name: null, rainbow_hint_word: null,
      rainbow_category_emoji: "🌈", theme: null, is_emoji_puzzle: false, alphabetize_completed: true,
      // The fake has no embedded join; the row carries its groups directly.
      puzzle_groups: [] as Record<string, unknown>[],
    },
  ];
  db.tables.puzzle_groups = WORDS.map((w, i) => ({
    id: `g${i}`, puzzle_id: "p1", category: `Cat ${i}`, words: w, difficulty: i + 1, sort_order: i,
    hint_word: null, category_emoji: i === 0 ? "___ 💬" : null,
  }));
  db.tables.puzzles[0].puzzle_groups = db.tables.puzzle_groups;
  db.tables.puzzle_versions = [];
  db.writeLog = [];
});

async function openSavedPuzzle() {
  render(
    <MemoryRouter>
      <Admin />
    </MemoryRouter>
  );
  const pencil = await waitFor(() => {
    const el = document.querySelector("svg.lucide-pencil");
    if (!el) throw new Error("puzzle list not loaded");
    return el;
  });
  fireEvent.click(pencil.closest("button")!);
  await waitFor(() => expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-10-01"));
  await screen.findByTestId("category-card-1", {}, { timeout: 3000 });
}

const card = (n: number) => screen.getByTestId(`category-card-${n}`);

describe("Admin Start Over while editing a saved puzzle", () => {
  it("loads the saved Category Emoji into the form", async () => {
    await openSavedPuzzle();
    await waitFor(() => {
      const [name, emoji] = within(card(1)).getAllByRole("textbox") as HTMLInputElement[];
      expect(name.value).toBe("Cat 0");
      expect(emoji.value).toBe("___ 💬");
    });
  });

  it("clears the visible Date and every field, keeps the editing identity, and writes nothing", async () => {
    await openSavedPuzzle();
    fireEvent.change(screen.getByLabelText("Designer name"), { target: { value: "Kept Designer" } });
    const writesBefore = db.writeLog.length;
    const groupsBefore = JSON.stringify(db.tables.puzzle_groups);

    fireEvent.click(screen.getByRole("button", { name: "Start Over" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, start over" }));

    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/Title/) as HTMLInputElement).value).toBe("");
    for (const n of [1, 2, 3, 4]) {
      (within(card(n)).getAllByRole("textbox") as HTMLInputElement[]).forEach((i) => expect(i.value).toBe(""));
    }
    // Designer name is preserved.
    expect((screen.getByLabelText("Designer name") as HTMLInputElement).value).toBe("Kept Designer");
    // Still editing the same puzzle (the hidden identity), so Update targets it...
    expect(screen.getByRole("heading", { name: "Edit Puzzle" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Update Puzzle/ })).toBeTruthy();
    // ...and nothing was deleted or overwritten.
    expect(db.writeLog.length).toBe(writesBefore);
    expect(JSON.stringify(db.tables.puzzle_groups)).toBe(groupsBefore);
    expect(db.tables.puzzles).toHaveLength(1);
    expect(db.tables.puzzles[0].date).toBe("2026-10-01");
  });
});
