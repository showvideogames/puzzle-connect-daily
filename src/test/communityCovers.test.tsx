/**
 * Creator covers in the client: only 1-3 well-formed, distinct emoji keys
 * (no gaps) plus a known preset background render; everything else is the
 * standard cover. The server side (allowlist, ownership) is
 * npm run e2e:db:covers.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import catalog from "@/lib/coverEmoji.json";
import { COVER_BACKGROUNDS, COVER_BACKGROUND_KEYS } from "@/lib/coverBackgrounds";
import { emojiFromKey, parseCover, validEmojiList } from "@/lib/creatorCover";
import { CreatorCoverArt } from "@/components/community/CreatorCoverArt";

/** The 24 keys of the first cover release (0008): all must keep working. */
const KEYS_0008 = ["lilac", "butter", "mint", "sunflower", "tangerine", "coral", "bubblegum", "ocean", "forest", "charcoal", "lime-checks", "apricot-stripes", "lilac-dots", "indigo-stars", "teal-waves", "pink-waves", "sky-grid", "cream-confetti", "berry-stripes", "cherry-polka", "sunset-split", "peach-rings", "mint-checks", "rainbow-bands"];

describe("cover keys", () => {
  it("rebuilds each emoji from its code-point key, including composite sequences", () => {
    expect(emojiFromKey("1F438")).toBe("🐸");
    expect(emojiFromKey("263A-FE0F")).toBe("☺️");
    expect(emojiFromKey("1F3F3-FE0F-200D-1F308")).toBe("🏳️‍🌈");
    for (const bad of ["🐸", "frog", "1f438", "<img>", "1F438 1F989", "110000", "", "1F438-"]) expect(emojiFromKey(bad)).toBeNull();
  });

  it("accepts one, two or three distinct valid keys, in order, and nothing else", () => {
    expect(parseCover("1F438", "lime-checks")).toEqual({ emojis: ["1F438"], background: "lime-checks" });
    expect(parseCover("1F438", "lime-checks", "1F337")).toEqual({ emojis: ["1F438", "1F337"], background: "lime-checks" });
    expect(parseCover("1FA90", "lilac-dots", "1F680", "2B50-FE0F")).toEqual({ emojis: ["1FA90", "1F680", "2B50-FE0F"], background: "lilac-dots" });
    // Gaps, duplicates, bad keys, missing pieces: no cover at all.
    for (const args of [
      ["1F438", null], [null, "lilac"], ["1F438", "neon"], ["1F438", "url(x)"], [42, "lilac"],
      [null, "lilac", "1F337"], ["1F438", "lilac", null, "2B50-FE0F"], [null, "lilac", null, "2B50-FE0F"],
      ["1F438", "lilac", "1F438"], ["1F438", "lilac", "1F337", "1F438"],
      ["1F438", "lilac", "<b>x</b>"], ["1F438", "lilac", "1F337", "javascript:alert(1)"], ["1F438", "lilac", 7],
    ] as unknown[][]) {
      expect(parseCover(...(args as [unknown, unknown, unknown?, unknown?])), JSON.stringify(args)).toBeNull();
    }
    expect(validEmojiList([])).toBeNull();
    expect(validEmojiList(["1F438", "1F337", "2B50-FE0F", "1F989"])).toBeNull();
    expect(validEmojiList(["1F438", "1F337", "2B50-FE0F"])).toEqual(["1F438", "1F337", "2B50-FE0F"]);
  });

  it("keeps every earlier background key, adds distinct ones, and puts Rainbow first", () => {
    expect(new Set(COVER_BACKGROUND_KEYS).size).toBe(COVER_BACKGROUNDS.length);
    expect(COVER_BACKGROUND_KEYS).toEqual(expect.arrayContaining(KEYS_0008));
    expect(COVER_BACKGROUNDS.length - KEYS_0008.length).toBeGreaterThanOrEqual(10);
    expect(COVER_BACKGROUNDS[0]).toMatchObject({ key: "rainbow-bands", label: "Rainbow", group: "rainbow" });
    // Curved arcs, not the old flat stripes, with all six colours.
    const rainbow = decodeURIComponent(COVER_BACKGROUNDS[0].image ?? "");
    expect(rainbow).toContain("<circle");
    for (const c of ["#FF5A5F", "#FF9F1C", "#FFD23F", "#44B54A", "#2F80ED", "#8B5CF6"]) expect(rainbow).toContain(c);
    expect(rainbow).not.toContain("linear-gradient");
    // Nothing remote.
    for (const b of COVER_BACKGROUNDS) expect(b.image ?? "").not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
  });

  it("has a near-full, de-duplicated emoji catalog", () => {
    const keys = (catalog.emoji as unknown as [string][]).map((e) => e[0]);
    expect(keys.length).toBeGreaterThan(1800);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => emojiFromKey(k) !== null)).toBe(true);
    expect(keys).toEqual(expect.arrayContaining(["1F1EF-1F1F5", "1F468-200D-1F469-200D-1F467"]));
    expect(keys).not.toContain("1F3FB");
  });

  it("draws one, two or three emoji in order on the background, or the standard cover", () => {
    const { container, rerender } = render(<CreatorCoverArt cover={{ emojis: ["1F989"], background: "indigo-stars" }} />);
    const art = () => container.firstElementChild!;
    expect(art().getAttribute("data-cover-kind")).toBe("creator");
    expect(art().textContent).toBe("🦉");
    rerender(<CreatorCoverArt cover={{ emojis: ["1FA90", "1F680", "2B50-FE0F"], background: "lilac-dots" }} />);
    expect(art().getAttribute("data-cover-count")).toBe("3");
    expect([...art().querySelectorAll("[data-cover-glyph]")].map((e) => e.textContent)).toEqual(["🪐", "🚀", "⭐️"]);
    for (const bad of [{ emojis: ["<b>hi</b>"], background: "lilac" }, { emojis: [], background: "lilac" }, { emojis: ["1F438", "1F438"], background: "lilac" }, { emojis: ["1F438", "1F337", "2B50-FE0F", "1F989"], background: "lilac" }]) {
      rerender(<CreatorCoverArt cover={bad} />);
      expect(art().getAttribute("data-cover-kind")).toBe("default");
      expect(container.textContent).toBe("");
    }
  });
});
