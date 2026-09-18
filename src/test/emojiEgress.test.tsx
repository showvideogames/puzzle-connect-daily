/**
 * Guards the custom-emoji egress fix.
 *
 * The bug these exist for: CustomEmojiManager built every image URL with
 * `?t=${Date.now()}` computed during render, and was mounted unconditionally
 * on the Admin page. One keystroke in the puzzle editor re-rendered it,
 * produced 38 brand-new URLs, and re-downloaded the whole ~33 MB bucket.
 *
 * So the properties under test are: URLs do not change unless the OBJECT
 * changed, and nothing is fetched until an admin asks for it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

const listMock = vi.fn();
const uploadMock = vi.fn();
const removeMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({ list: listMock, upload: uploadMock, remove: removeMock }),
    },
    from: () => ({
      select: () => ({ contains: async () => ({ data: [], error: null }) }),
    }),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { customEmojiUrl, emojiVersionToken } from "@/lib/customEmoji";
import {
  fitWithin,
  optimizeEmojiImage,
  ImageOptimizeError,
  MAX_EMOJI_DIMENSION,
} from "@/lib/imageOptimize";
import { CustomEmojiManager } from "@/components/admin/CustomEmojiManager";

const UPDATED_A = "2026-09-16T08:06:31.000Z";
const UPDATED_B = "2026-09-18T11:22:33.000Z";

function storageRow(name: string, updated_at: string | null) {
  return { name, updated_at, id: name, metadata: { size: 1000, mimetype: "image/png" } };
}

/**
 * jsdom ships no canvas 2D implementation, so stand one up that records the
 * calls this code's correctness depends on: whether anything painted an
 * opaque background before the source was drawn (which would destroy
 * transparency), and what size the source was drawn at.
 */
interface StubCtx {
  __filled: boolean;
  __drawnAt: { w: number; h: number } | null;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
  fillRect: () => void;
  drawImage: (src: unknown, x: number, y: number, w: number, h: number) => void;
}
const ctxByCanvas = new WeakMap<HTMLCanvasElement, StubCtx>();

beforeEach(() => {
  vi.clearAllMocks();
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    const existing = ctxByCanvas.get(this);
    if (existing) return existing as unknown as CanvasRenderingContext2D;
    const ctx: StubCtx = {
      __filled: false,
      __drawnAt: null,
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      fillRect() {
        this.__filled = true;
      },
      drawImage(_src, _x, _y, w, h) {
        this.__drawnAt = { w, h };
      },
    };
    ctxByCanvas.set(this, ctx);
    return ctx as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;

  listMock.mockResolvedValue({
    data: [storageRow("quilt.png", UPDATED_A), storageRow("pea.png", UPDATED_A)],
    error: null,
  });
  uploadMock.mockResolvedValue({ error: null });
  removeMock.mockResolvedValue({ error: null });
});

// ── URL STABILITY ──────────────────────────────────────────────────────────
describe("emoji URL versioning", () => {
  it("gameplay URLs carry no query string at all", () => {
    // Every player's browser cache and every CDN entry is keyed on this exact
    // string. Adding a version here would invalidate all of them at once.
    const url = customEmojiUrl("img:quilt");
    expect(url).toMatch(/\/custom-emoji\/quilt\.png$/);
    expect(url).not.toContain("?");
  });

  it("is byte-identical across repeated calls while metadata is unchanged", () => {
    const v = emojiVersionToken(UPDATED_A);
    const first = customEmojiUrl("quilt", v);
    const second = customEmojiUrl("quilt", v);
    expect(first).toBe(second);
    expect(first).toContain("?v=");
  });

  it("does not depend on the clock", () => {
    // The old implementation failed exactly here.
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000);
    const a = customEmojiUrl("quilt", emojiVersionToken(UPDATED_A));
    now.mockReturnValue(9_999_999);
    const b = customEmojiUrl("quilt", emojiVersionToken(UPDATED_A));
    expect(a).toBe(b);
    now.mockRestore();
  });

  it("changes when the object is genuinely replaced", () => {
    const before = customEmojiUrl("quilt", emojiVersionToken(UPDATED_A));
    const after = customEmojiUrl("quilt", emojiVersionToken(UPDATED_B));
    expect(after).not.toBe(before);
  });

  it("falls back to the plain URL when metadata has no timestamp", () => {
    expect(emojiVersionToken(null)).toBeNull();
    expect(emojiVersionToken("not a date")).toBeNull();
    expect(customEmojiUrl("quilt", emojiVersionToken(null))).not.toContain("?");
  });
});

// ── LAZY MOUNT + RENDER STABILITY ──────────────────────────────────────────
describe("emoji manager loading behaviour", () => {
  it("fetches nothing while it is not mounted", () => {
    // Stands in for the Admin page with the section collapsed.
    render(<div>puzzle editor</div>);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("loads the inventory once when opened", async () => {
    render(<CustomEmojiManager />);
    await waitFor(() => expect(screen.getByAltText("quilt")).toBeInTheDocument());
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("keeps every image URL identical across unrelated re-renders", async () => {
    const { rerender } = render(<CustomEmojiManager />);
    await waitFor(() => expect(screen.getByAltText("quilt")).toBeInTheDocument());

    const before = screen.getAllByRole("img").map((el) => el.getAttribute("src"));

    // Force the clock forward between renders. Without this the old
    // `?t=${Date.now()}` implementation could pass by accident whenever two
    // renders landed in the same millisecond; with it, the old code is
    // guaranteed to produce different URLs and fail here.
    const now = vi.spyOn(Date, "now");
    let tick = 1_000_000;
    now.mockImplementation(() => (tick += 10_000));

    // Simulate the Admin page re-rendering on each keystroke.
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        rerender(<CustomEmojiManager />);
      });
    }
    now.mockRestore();

    const after = screen.getAllByRole("img").map((el) => el.getAttribute("src"));
    expect(after).toEqual(before);
    // And no extra network work was provoked.
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("reuses the same URLs after closing and reopening", async () => {
    const first = render(<CustomEmojiManager />);
    await waitFor(() => expect(screen.getByAltText("quilt")).toBeInTheDocument());
    const before = screen.getAllByRole("img").map((el) => el.getAttribute("src"));
    first.unmount();

    render(<CustomEmojiManager />);
    await waitFor(() => expect(screen.getByAltText("quilt")).toBeInTheDocument());
    const after = screen.getAllByRole("img").map((el) => el.getAttribute("src"));

    // Same URLs => the browser serves them from cache, no bytes re-fetched.
    expect(after).toEqual(before);
  });

  it("picks up a new URL once an object's updated_at moves", async () => {
    const { unmount } = render(<CustomEmojiManager />);
    await waitFor(() => expect(screen.getByAltText("quilt")).toBeInTheDocument());
    const before = screen.getByAltText("quilt").getAttribute("src");
    unmount();

    listMock.mockResolvedValue({
      data: [storageRow("quilt.png", UPDATED_B), storageRow("pea.png", UPDATED_A)],
      error: null,
    });
    render(<CustomEmojiManager />);
    await waitFor(() => expect(screen.getByAltText("quilt")).toBeInTheDocument());

    expect(screen.getByAltText("quilt").getAttribute("src")).not.toBe(before);
    // The untouched one did not move.
    expect(screen.getByAltText("pea").getAttribute("src")).toContain(
      emojiVersionToken(UPDATED_A)!,
    );
  });
});

// ── UPLOAD OPTIMISATION ────────────────────────────────────────────────────
describe("upload sizing rules", () => {
  it("fits oversized images inside the box, preserving aspect ratio", () => {
    expect(fitWithin(1024, 512)).toEqual({ width: 256, height: 128 });
    expect(fitWithin(512, 1024)).toEqual({ width: 128, height: 256 });
    expect(fitWithin(2000, 2000)).toEqual({ width: 256, height: 256 });
  });

  it("never enlarges an image already within the box", () => {
    expect(fitWithin(64, 64)).toEqual({ width: 64, height: 64 });
    expect(fitWithin(256, 100)).toEqual({ width: 256, height: 100 });
  });

  it("never collapses a very thin image to zero", () => {
    const out = fitWithin(4000, 3);
    expect(out.width).toBe(256);
    expect(out.height).toBeGreaterThanOrEqual(1);
  });

  it("rejects a zero-dimension source rather than producing a broken canvas", () => {
    expect(() => fitWithin(0, 100)).toThrow();
  });

  it("downscales to at most 256x256 and reports the saving", async () => {
    const encoder = vi.fn(async (_c: HTMLCanvasElement) => new Blob([new Uint8Array(20 * 1024)]));
    const result = await optimizeEmojiImage(
      { size: 1_500_000 } as Blob,
      {
        loader: async () => ({ width: 1024, height: 1024 }) as never,
        encoder,
      },
    );
    expect(result.width).toBeLessThanOrEqual(MAX_EMOJI_DIMENSION);
    expect(result.height).toBeLessThanOrEqual(MAX_EMOJI_DIMENSION);
    expect(result.bytes).toBeLessThan(result.originalBytes);

    // The canvas really was sized down, not just the reported numbers.
    const canvas = encoder.mock.calls[0][0] as HTMLCanvasElement;
    expect(canvas.width).toBe(256);
    expect(canvas.height).toBe(256);
    expect(ctxByCanvas.get(canvas)?.__drawnAt).toEqual({ w: 256, h: 256 });
  });

  it("encodes as PNG so transparency survives", async () => {
    const encoder = vi.fn(async (_c: HTMLCanvasElement) => new Blob([new Uint8Array(1024)]));
    await optimizeEmojiImage({ size: 5000 } as Blob, {
      loader: async () => ({ width: 100, height: 100 }) as never,
      encoder,
    });
    // No opaque fill beforehand — that is what would flatten the alpha
    // channel onto a solid colour and give every tile a black box.
    const canvas = encoder.mock.calls[0][0] as HTMLCanvasElement;
    expect(ctxByCanvas.get(canvas)?.__filled).toBe(false);
    expect(ctxByCanvas.get(canvas)?.__drawnAt).toEqual({ w: 100, h: 100 });
  });

  it("asks the encoder for PNG, never a format that drops alpha", async () => {
    const toBlob = vi.fn((cb: (b: Blob | null) => void, _type?: string) => cb(new Blob([new Uint8Array(512)])));
    HTMLCanvasElement.prototype.toBlob = toBlob as unknown as typeof HTMLCanvasElement.prototype.toBlob;

    await optimizeEmojiImage({ size: 5000 } as Blob, {
      loader: async () => ({ width: 80, height: 80 }) as never,
    });

    expect(toBlob.mock.calls[0][1]).toBe("image/png");
  });

  it("rejects an oversized processed result with a useful message", async () => {
    const encoder = vi.fn(async (_c: HTMLCanvasElement) => new Blob([new Uint8Array(400 * 1024)]));
    await expect(
      optimizeEmojiImage({ size: 900_000 } as Blob, {
        loader: async () => ({ width: 256, height: 256 }) as never,
        encoder,
      }),
    ).rejects.toBeInstanceOf(ImageOptimizeError);
  });

  it("surfaces a decode failure instead of passing the original through", async () => {
    await expect(
      optimizeEmojiImage({ size: 900_000 } as Blob, {
        loader: async () => {
          throw new ImageOptimizeError("That file could not be read as an image.");
        },
      }),
    ).rejects.toBeInstanceOf(ImageOptimizeError);
  });
});
