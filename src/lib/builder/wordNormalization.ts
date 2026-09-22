/**
 * Word normalization shared by the builder and its save path.
 *
 * Moved out of Admin.tsx unchanged (byte-for-byte the same rules) so the
 * reusable builder components/hooks can normalize without importing the
 * Admin page.
 */
export function normalizeWord(w: string): string {
  const trimmed = w.trim();
  // toUpperCase, not toLocaleUpperCase: canonical stored answers must not
  // vary by the admin device's locale. toUpperCase() already applies
  // Unicode's locale-independent default case mapping (café -> CAFÉ,
  // straße -> STRASSE), which is what we want deterministically.
  return /^img:/i.test(trimmed) ? trimmed.toLowerCase() : trimmed.toUpperCase();
}
