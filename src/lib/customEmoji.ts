const PREFIX = "img:";

export function isCustomEmoji(word: string): boolean {
  return word.startsWith(PREFIX);
}

export function customEmojiName(word: string): string | null {
  return isCustomEmoji(word) ? word.slice(PREFIX.length) : null;
}

export function customEmojiUrl(nameOrWord: string, bustCache = false): string {
  const name = customEmojiName(nameOrWord) ?? nameOrWord;
  const base = import.meta.env.VITE_SUPABASE_URL as string;
  const url = `${base}/storage/v1/object/public/custom-emoji/${name}.png`;
  return bustCache ? `${url}?t=${Date.now()}` : url;
}

export function customEmojiReference(name: string): string {
  return `${PREFIX}${name}`;
}
