import { PROFILE_COLORS } from "@/lib/sharedProfile";

/** Initials and colour for a creator's monogram avatar (components/community/CreatorAvatar). */
export function creatorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts.slice(0, 1);
  return letters.map((p) => Array.from(p)[0] ?? "").join("").toUpperCase() || "?";
}

export function creatorColor(slug: string): string {
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PROFILE_COLORS[h % PROFILE_COLORS.length].hex;
}
