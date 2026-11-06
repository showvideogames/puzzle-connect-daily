import type { GroupEmblemId } from "./groupEmblems";

/**
 * A group's picture: one of the approved emblems, or an uploaded image. The
 * limits keep existing JPEG pictures compatible. PNG transparency is enabled
 * only after the shared hub has been upgraded; old pictures are not rewritten.
 *
 * This only prepares a picture in the browser. Nothing here stores or sends it.
 */
export interface GroupPicture {
  emblemId: GroupEmblemId;
  /** An uploaded picture as a data URL. When set, it is shown instead of the emblem. */
  photo: string | null;
}

/** Enable only after the shared-service PNG patch has been applied and verified. */
export const transparentGroupPhotos = () => import.meta.env.VITE_GROUP_PNG === "true";

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

export interface PhotoCrop {
  /** Position within the available travel, from left/top (0) to right/bottom (1). */
  x: number;
  y: number;
  zoom: number;
}
export const DEFAULT_CROP: PhotoCrop = { x: 0.5, y: 0.5, zoom: 1 };
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Square source area shared by the crop preview and final encoder. */
export function cropSquare(width: number, height: number, crop: PhotoCrop = DEFAULT_CROP) {
  const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
  const size = Math.min(width, height) / clamp(finite(crop.zoom, 1), 1, 3);
  return {
    sx: (width - size) * clamp(finite(crop.x, 0.5), 0, 1),
    sy: (height - size) * clamp(finite(crop.y, 0.5), 0, 1),
    size,
  };
}

/** Re-edit an existing stored JPEG or PNG without sending or replacing it until Save. */
export function photoFile(photo: string): File {
  const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(photo);
  if (!match) throw new Error("Please upload the original picture to adjust it.");
  const bytes = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0));
  return new File([bytes], `group-picture.${match[1]}`, { type: `image/${match[1]}` });
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

/** The chosen crop as a 256x256 image under the size limit. Rejects with a player-facing message. */
export async function prepareGroupPhoto(file: File, crop: PhotoCrop = DEFAULT_CROP): Promise<string> {
  const image = await loadImage(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = PHOTO_SIZE;
    canvas.height = PHOTO_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser couldn't prepare the picture.");
    // Legacy mode stays compatible with the currently deployed JPEG-only service.
    if (!transparentGroupPhotos()) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
    }
    const { sx, sy, size } = cropSquare(image.naturalWidth, image.naturalHeight, crop);
    context.drawImage(image, sx, sy, size, size, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
    if (transparentGroupPhotos()) {
      const pixels = context.getImageData(0, 0, PHOTO_SIZE, PHOTO_SIZE).data;
      let hasAlpha = false;
      for (let i = 3; i < pixels.length; i += 4) { if (pixels[i] < 255) { hasAlpha = true; break; } }
      if (hasAlpha) {
        const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
        if (png && png.size <= PHOTO_MAX_BYTES) return toDataUrl(png);
        throw new Error("That transparent picture has too much detail. Try a simpler image or a tighter crop.");
      }
    }
    for (const quality of [0.88, 0.8, 0.7, 0.6, 0.5, 0.4]) {
      const blob = await toBlob(canvas, quality);
      if (blob && blob.size <= PHOTO_MAX_BYTES) return toDataUrl(blob);
    }
    throw new Error("That picture couldn't be made small enough. Please try a different one.");
  } finally {
    URL.revokeObjectURL(image.src);
  }
}
