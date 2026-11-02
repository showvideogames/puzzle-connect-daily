import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moreGames } from "@/components/moreGames";
import { AVATAR_FRAMING, avatarLabel } from "@/lib/avatarManifest";
import { cleanFriendCode } from "@/lib/friendCode";
import { canOpenResult, resultSummary } from "@/lib/friendResults";
import { gameCatalog } from "@/lib/gameCatalog";
import { GROUP_EMBLEMS } from "@/lib/groupEmblems";
import { inviteMemberPreview, memberLine } from "@/lib/invitePreview";
import { PHOTO_MAX_BYTES, PHOTO_SIZE, UPLOAD_MAX_BYTES, centerSquare, checkUpload } from "@/lib/groupPicture";
import {
  AVATAR_IDS,
  DISPLAY_NAME_MAX,
  FEATURED_AVATARS,
  PROFILE_COLORS,
  hasDisplayName,
  newProfile,
  profileIsComplete,
  validProfile,
} from "@/lib/sharedProfile";

const ROOT = path.resolve(__dirname, "..", "..");
const assets = path.join(ROOT, "demo", "onboarding", "shared-assets");

describe("the approved avatars, colors and group pictures", () => {
  it("has the 30 approved avatars, the six colors and the nine group pictures", () => {
    expect(new Set(AVATAR_IDS).size).toBe(30);
    expect(new Set(PROFILE_COLORS.map((color) => color.hex)).size).toBe(6);
    expect(new Set(GROUP_EMBLEMS.map((emblem) => emblem.id)).size).toBe(9);
  });

  it("does not offer the two avatars held back from the approved set", () => {
    expect(AVATAR_IDS as readonly string[]).not.toContain("santa");
    expect(AVATAR_IDS as readonly string[]).not.toContain("turkey");
  });

  it("frames every avatar and has its picture", () => {
    for (const id of AVATAR_IDS) {
      expect(AVATAR_FRAMING[id], id).toBeDefined();
      expect(existsSync(path.join(assets, "avatars", `${id}.webp`)), id).toBe(true);
    }
    for (const { id } of GROUP_EMBLEMS) {
      expect(existsSync(path.join(assets, "groups", `${id}.webp`)), id).toBe(true);
    }
  });

  it("records which original each display copy came from, and every copy is small", () => {
    const record = JSON.parse(readFileSync(path.join(assets, "DISPLAY-COPIES.json"), "utf8"));
    expect(record.files).toHaveLength(50);
    for (const file of record.files) {
      expect(file.original, file.display).toMatch(/^\//);
      expect(file.originalSha256, file.display).toMatch(/^[0-9a-f]{64}$/);
      expect(statSync(path.join(assets, file.display)).size, file.display).toBe(file.displayBytes);
      expect(file.displayBytes, file.display).toBeLessThan(60 * 1024);
    }
  });

  it("offers a short list of real avatars, starting with the default", () => {
    expect(FEATURED_AVATARS[0]).toBe(newProfile().animalId);
    for (const id of FEATURED_AVATARS) expect(AVATAR_IDS).toContain(id);
  });

  it("names avatars for screen readers", () => {
    expect(avatarLabel("saint-bernard")).toBe("Saint Bernard");
  });
});

describe("a shared profile", () => {
  const profile = { ...newProfile(), displayName: "Alex" };

  it("starts with a default chosen but is not complete until it has a name", () => {
    expect(validProfile(newProfile())).toBe(true);
    expect(profileIsComplete(newProfile())).toBe(false);
    expect(profileIsComplete(profile)).toBe(true);
    expect(profileIsComplete(null)).toBe(false);
  });

  it("rejects ids and colors outside the approved set", () => {
    expect(validProfile({ ...profile, animalId: "dragon" })).toBe(false);
    expect(validProfile({ ...profile, backgroundColor: "#000000" })).toBe(false);
    expect(validProfile({ ...profile, version: 2 })).toBe(false);
  });

  it("rejects a blank name or one over the contract's limit", () => {
    expect(validProfile({ ...profile, displayName: "   " })).toBe(false);
    expect(validProfile({ ...profile, displayName: "x".repeat(DISPLAY_NAME_MAX) })).toBe(true);
    expect(validProfile({ ...profile, displayName: "x".repeat(DISPLAY_NAME_MAX + 1) })).toBe(false);
  });
});

describe("the bear and frog picture", () => {
  const original = "b9743f501dd4474c647c4a4512beaacd6e42c0174778856b455d1094fcba2b35";

  it("is served as a small display copy, recorded against the supplied original", () => {
    const record = JSON.parse(readFileSync(path.join(assets, "DISPLAY-COPIES.json"), "utf8"));
    const entry = record.files.find((file: { display: string }) => file.display === "friends/bear-frog-heart.webp");
    expect(entry.originalSha256).toBe(original);
    expect(entry.originalBytes).toBe(1200995);
    expect(entry.displaySize).toBe("480x336");
    const copy = readFileSync(path.join(assets, entry.display));
    expect(createHash("sha256").update(copy).digest("hex")).toBe(entry.displaySha256);
  });

  it("no longer serves the full-size file", () => {
    expect(readdirSync(path.join(assets, "friends"))).toEqual(["bear-frog-heart.webp"]);
  });
});

describe("player-facing screens", () => {
  it("say nothing about being simulated or fictional: that belongs to the preview banner", () => {
    const folder = path.join(ROOT, "src", "components", "account");
    for (const name of readdirSync(folder)) {
      const source = readFileSync(path.join(folder, name), "utf8");
      expect(source, name).not.toMatch(/simulated|fictional|K7M|nothing was sent/i);
    }
  });
});

describe("an invitation's member preview", () => {
  const member = { animalId: "bear", backgroundColor: "#F8E4A0" } as const;
  const rich = {
    ...member,
    name: "Sam",
    email: "sam@example.test",
    globalUserId: "user_0123456789",
    results: [{ puzzleId: "p1", mistakes: 1 }],
    detail: "secret-grid",
  };

  it("carries only avatars, one Display Name and a count, however much is known", () => {
    const preview = inviteMemberPreview([rich, { ...rich, name: "Jordan" }, { ...rich, name: "Taylor" }, { ...rich, name: "Riley" }], 6);
    expect(Object.keys(preview).sort()).toEqual(["faces", "leadName", "memberCount"]);
    expect(preview.leadName).toBe("Sam");
    expect(preview.memberCount).toBe(6);
    expect(preview.faces).toHaveLength(3);
    for (const face of preview.faces) expect(Object.keys(face).sort()).toEqual(["animalId", "backgroundColor"]);
    const sent = JSON.stringify(preview);
    for (const secret of ["email", "example.test", "user_", "results", "mistakes", "puzzleId", "detail", "secret-grid", "Jordan"]) {
      expect(sent, secret).not.toContain(secret);
    }
  });

  it("reads properly for any number of members", () => {
    expect(memberLine({ leadName: "Sam", memberCount: 6 })).toBe("Join Sam and 5 friends.");
    expect(memberLine({ leadName: "Sam", memberCount: 2 })).toBe("Join Sam and 1 friend.");
    expect(memberLine({ leadName: "Sam", memberCount: 1 })).toBe("Join Sam.");
  });
});

describe("friend codes", () => {
  it("accepts lowercase and a missing dash, and shows one form", () => {
    expect(cleanFriendCode("k7m4px")).toBe("K7M-4PX");
    expect(cleanFriendCode(" K7M-4PX ")).toBe("K7M-4PX");
    expect(cleanFriendCode("k7m 4px")).toBe("K7M-4PX");
  });

  it("refuses the wrong length, letters that are easy to misread, and anything else", () => {
    expect(cleanFriendCode("K7M")).toBeNull();
    expect(cleanFriendCode("K7M-4PXX")).toBeNull();
    expect(cleanFriendCode("O0I-1AB")).toBeNull();
    expect(cleanFriendCode(null)).toBeNull();
  });
});

describe("a friend's result", () => {
  it("reads in plain words", () => {
    expect(resultSummary({ status: "solved", mistakes: 0 })).toBe("Solved · 0 mistakes");
    expect(resultSummary({ status: "solved", mistakes: 1 })).toBe("Solved · 1 mistake");
    expect(resultSummary({ status: "not-solved", mistakes: 4 })).toBe("Not solved · 4 mistakes");
    expect(resultSummary({ status: "not-played", mistakes: 0 })).toBe("Not played yet");
  });

  it("can be opened only once they have played", () => {
    expect(canOpenResult({ status: "solved" })).toBe(true);
    expect(canOpenResult({ status: "not-solved" })).toBe(true);
    expect(canOpenResult({ status: "not-played" })).toBe(false);
  });
});

describe("Friends and Groups need a Display Name", () => {
  it("is true only once a name is chosen", () => {
    expect(hasDisplayName(null)).toBe(false);
    expect(hasDisplayName(newProfile())).toBe(false);
    expect(hasDisplayName({ ...newProfile(), displayName: "Alex" })).toBe(true);
  });
});

describe("an uploaded group picture", () => {
  it("keeps to the limits CrossPuns' server enforces", () => {
    expect(PHOTO_SIZE).toBe(256);
    expect(PHOTO_MAX_BYTES).toBeLessThanOrEqual(61440);
  });

  it("refuses what is not a usable picture", () => {
    expect(checkUpload({ type: "application/pdf", size: 100 })).toMatch(/choose a picture/);
    expect(checkUpload({ type: "image/png", size: UPLOAD_MAX_BYTES + 1 })).toMatch(/too large/);
    expect(checkUpload({ type: "image/png", size: 0 })).toMatch(/empty/);
    expect(checkUpload({ type: "image/jpeg", size: 1000 })).toBeNull();
  });

  it("takes the centered square of a wide or tall picture", () => {
    expect(centerSquare(1000, 600)).toEqual({ sx: 200, sy: 0, size: 600 });
    expect(centerSquare(600, 1000)).toEqual({ sx: 0, sy: 200, size: 600 });
  });
});

describe("the game catalog", () => {
  it("is Rainbow plus every game in the menu's More Games list", () => {
    expect(gameCatalog.map((game) => game.id)).toEqual(["rainbow", ...moreGames.map((game) => game.icon)]);
    expect(gameCatalog).toHaveLength(7);
  });

  it("takes each link and description from that list, so the two cannot drift", () => {
    for (const game of moreGames) {
      const entry = gameCatalog.find((candidate) => candidate.id === game.icon);
      expect(entry.href).toBe(game.href);
      expect(entry.description).toBe(game.description);
    }
  });

  it("only links to the games' own public https addresses", () => {
    for (const game of gameCatalog) {
      expect(new URL(game.href).protocol, game.id).toBe("https:");
      expect(game.href, game.id).not.toMatch(/vercel\.app/);
    }
  });

  it("keeps the small icons for menus", () => {
    for (const game of gameCatalog) {
      expect(existsSync(path.join(ROOT, "public", game.iconSrc)), game.id).toBe(true);
    }
  });
});
