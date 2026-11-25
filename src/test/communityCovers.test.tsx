/**
 * Creator covers in the client: only a well-formed emoji key plus a known
 * preset background renders; everything else is the standard cover. The server
 * side (allowlist, ownership) is npm run e2e:db:covers.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import catalog from "@/lib/coverEmoji.json";
import { COVER_BACKGROUNDS, COVER_BACKGROUND_KEYS } from "@/lib/coverBackgrounds";
import { emojiFromKey, parseCover } from "@/lib/creatorCover";
import { CreatorCoverArt } from "@/components/community/CreatorCoverArt";

describe("cover keys", () => {
  it("rebuilds the emoji from its code-point key, including composite sequences", () => {
    expect(emojiFromKey("1F438")).toBe("🐸");
    expect(emojiFromKey("263A-FE0F")).toBe("☺️");
    expect(emojiFromKey("1F3F3-FE0F-200D-1F308")).toBe("🏳️‍🌈");
    for (const bad of ["🐸", "frog", "1f438", "<img>", "1F438 1F989", "110000", "", "1F438-"]) expect(emojiFromKey(bad)).toBeNull();
  });

  it("treats anything but one valid key and one preset as no cover", () => {
    expect(parseCover("1F438", "lime-checks")).toEqual({ emoji: "1F438", background: "lime-checks" });
    for (const [e, b] of [["1F438", null], [null, "lilac"], ["1F438", "neon"], ["javascript:alert(1)", "lilac"], ["1F438", "url(x)"], [42, "lilac"]]) {
      expect(parseCover(e, b)).toBeNull();
    }
  });

  it("has 24 distinct backgrounds and a near-full, de-duplicated emoji catalog", () => {
    expect(COVER_BACKGROUNDS).toHaveLength(24);
    expect(new Set(COVER_BACKGROUND_KEYS).size).toBe(24);
    const keys = (catalog.emoji as unknown as [string][]).map((e) => e[0]);
    expect(keys.length).toBeGreaterThan(1800);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => emojiFromKey(k) !== null)).toBe(true);
    // Flags and composite sequences are in; skin-tone swatches are not standalone covers.
    expect(keys).toEqual(expect.arrayContaining(["1F1EF-1F1F5", "1F468-200D-1F469-200D-1F467"]));
    expect(keys).not.toContain("1F3FB");
  });

  it("draws the stored emoji on its background, or the standard cover, never text from the server", () => {
    const { container, rerender } = render(<CreatorCoverArt cover={{ emoji: "1F989", background: "indigo-stars" }} />);
    const art = container.firstElementChild!;
    expect(art.getAttribute("data-cover-kind")).toBe("creator");
    expect(art.textContent).toBe("🦉");
    rerender(<CreatorCoverArt cover={{ emoji: "<b>hi</b>", background: "lilac" }} />);
    expect(container.firstElementChild!.getAttribute("data-cover-kind")).toBe("default");
    expect(container.textContent).toBe("");
  });
});
