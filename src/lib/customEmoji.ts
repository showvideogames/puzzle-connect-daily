const PREFIX = "img:";

export function isCustomEmoji(word: string): boolean {
  return word.startsWith(PREFIX);
}

export function customEmojiName(word: string): string | null {
  return isCustomEmoji(word) ? word.slice(PREFIX.length) : null;
}

export function customEmojiUrl(nameOrWord: string): string {
  const name = customEmojiName(nameOrWord) ?? nameOrWord;
  const base = import.meta.env.VITE_SUPABASE_URL as string;
  return `${base}/storage/v1/object/public/custom-emoji/${name}.png`;
}

export function customEmojiReference(name: string): string {
  return `${PREFIX}${name}`;
}
