/**
 * Client-side downscaling for custom-emoji uploads.
 *
 * Why this exists: the bucket accumulated 38 PNGs averaging ~895 KB, the
 * largest 1.46 MB, all of which render on the board at roughly 64x64. Nothing
 * stopped a full-resolution export from being uploaded as a game tile, and
 * every one of those megabytes is paid for again on every cache miss.
 *
 * So the browser decodes, downscales and re-encodes before anything is sent.
 *
 * Format: PNG out, always. WebP would compress better, but the game builds
 * every URL as `<name>.png` (see customEmojiUrl) and the Storage listing
 * filters on `.png`, so a WebP body under a `.png` name would be a lie that
 * two other modules would have to keep. PNG also preserves the alpha channel
 * these tiles depend on, which is the property that actually matters here.
 */

/** Longest edge of the output, in pixels. */
export const MAX_EMOJI_DIMENSION = 256;

/** What a processed emoji should come in under. */
export const TARGET_EMOJI_BYTES = 100 * 1024;

/**
 * Hard ceiling. Between this and TARGET is a warning, not a refusal: a
 * detailed 256x256 illustration can legitimately land above 100 KB, and
 * rejecting it would push the admin back to uploading the original. Above
 * this, something is wrong enough to stop.
 */
export const MAX_EMOJI_BYTES = 150 * 1024;

export interface OptimizedImage {
  blob: Blob;
  width: number;
  height: number;
  originalBytes: number;
  bytes: number;
}

/**
 * The output size for a source of `width` x `height` fitted inside a
 * `max` x `max` box.
 *
 * Aspect ratio is preserved, and an image already within the box is returned
 * untouched — upscaling a small icon would add bytes while adding no detail.
 * Rounds to at least 1px so a very thin source cannot collapse to a zero
 * dimension, which would make the canvas throw.
 */
export function fitWithin(
  width: number,
  height: number,
  max: number = MAX_EMOJI_DIMENSION,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    throw new Error("Image has no dimensions");
  }
  if (width <= max && height <= max) {
    return { width, height };
  }
  const scale = Math.min(max / width, max / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Thrown for every failure the admin should see verbatim. */
export class ImageOptimizeError extends Error {}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageOptimizeError("That file could not be read as an image."));
    };
    img.src = url;
  });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new ImageOptimizeError("The image could not be re-encoded."));
      },
      // PNG, so the alpha channel survives. Never image/jpeg: that would
      // flatten transparency onto black and ruin every tile.
      "image/png",
    );
  });
}

/**
 * Decode, downscale and re-encode one upload.
 *
 * Throws ImageOptimizeError with a message meant for the admin. Callers must
 * surface it rather than falling back to the original file — silently
 * uploading the unprocessed multi-megabyte original is the exact outcome this
 * function exists to prevent.
 */
export async function optimizeEmojiImage(
  file: File | Blob,
  opts: {
    maxDimension?: number;
    maxBytes?: number;
    loader?: (f: Blob) => Promise<{ width: number; height: number } & CanvasImageSource>;
    encoder?: (c: HTMLCanvasElement) => Promise<Blob>;
  } = {},
): Promise<OptimizedImage> {
  const maxDimension = opts.maxDimension ?? MAX_EMOJI_DIMENSION;
  const maxBytes = opts.maxBytes ?? MAX_EMOJI_BYTES;
  const load = opts.loader ?? (loadImage as (f: Blob) => Promise<never>);
  const encode = opts.encoder ?? canvasToPng;

  const img = await load(file);
  const source = { width: img.width, height: img.height };
  const target = fitWithin(source.width, source.height, maxDimension);

  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new ImageOptimizeError("This browser could not process the image.");
  }
  // No fillRect first: the canvas starts fully transparent, and drawing
  // straight onto it is what carries the source's alpha through.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img as CanvasImageSource, 0, 0, target.width, target.height);

  const blob = await encode(canvas);

  if (blob.size > maxBytes) {
    throw new ImageOptimizeError(
      `Processed image is ${(blob.size / 1024).toFixed(0)} KB, over the ` +
        `${(maxBytes / 1024).toFixed(0)} KB limit. Try simpler artwork or fewer colours.`,
    );
  }

  return {
    blob,
    width: target.width,
    height: target.height,
    originalBytes: file.size,
    bytes: blob.size,
  };
}
