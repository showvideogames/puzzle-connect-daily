/**
 * Friend codes: six letters and numbers, shown as ABC-234. O, 0, I and 1 are left
 * out because they are easy to misread aloud. A code can be typed in lowercase,
 * or without the dash.
 */
const CODE = /^[A-HJ-NP-Z2-9]{6}$/;

/** The code in its display form, or null when it could not be a friend code. */
export function cleanFriendCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, "");
  return CODE.test(code) ? `${code.slice(0, 3)}-${code.slice(3)}` : null;
}
