import type { GroupEmblemId } from "./groupEmblems";

/**
 * A group's picture: one of the approved emblems, or an uploaded image. The
 * limits and the JPEG recipe match CrossPuns' group pictures, so a picture made
 * here is one its server would accept, and existing group pictures fit without
 * being changed.
 *
 * This only prepares a picture in the browser. Nothing here stores or sends it.
 */
export interface GroupPicture {
  emblemId: GroupEmblemId;
  /** An uploaded picture as a data URL. When set, it is shown instead of the emblem. */
  photo: string | null;
}

export const PHOTO_SIZE = 256;
/** The server's limit is 60 KB; stay a little under it. */
export const PHOTO_MAX_BYTES = 58_000;
/** Refuse enormous files before even trying to open them. */
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

/** Is this file worth opening? A message for the player, or null. */
export function checkUpload(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith("image/")) return "Please choose a picture (a photo or image file).";
  if (file.size > UPLOAD_MAX_BYTES) return "That picture is too large. Please choose one under 20 MB.";
  if (file.size === 0) return "That file is empty. Please choose a different picture.";
  return null;
}

/** The largest centered square of an image, in image pixels. */
export function centerSquare(width: number, height: number): { sx: number; sy: number; size: number } {
  const size = Math.min(width, height);
  return { sx: (width - size) / 2, sy: (height - size) / 2, size };
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That picture couldn't be opened. Please try a different one."));
    };
    image.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("That picture couldn't be read."));
    reader.readAsDataURL(blob);
  });
}

/** The picture's center as a 256x256 JPEG under the size limit. Rejects with a player-facing message. */
export async function prepareGroupPhoto(file: File): Promise<string> {
  const image = await loadImage(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = PHOTO_SIZE;
    canvas.height = PHOTO_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser couldn't prepare the picture.");
    // Transparent PNGs would turn black as JPEG.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
    const { sx, sy, size } = centerSquare(image.naturalWidth, image.naturalHeight);
    context.drawImage(image, sx, sy, size, size, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
    for (const quality of [0.88, 0.8, 0.7, 0.6, 0.5, 0.4]) {
      const blob = await toBlob(canvas, quality);
      if (blob && blob.size <= PHOTO_MAX_BYTES) return toDataUrl(blob);
    }
    throw new Error("That picture couldn't be made small enough. Please try a different one.");
  } finally {
    URL.revokeObjectURL(image.src);
  }
}
