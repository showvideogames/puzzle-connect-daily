import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHOTO_MAX_BYTES, photoFile, prepareGroupPhoto } from '@/lib/groupPicture';

const file = new File(['source'], 'picture.png', { type: 'image/png' });
function canvasFixture(alpha: number, pngSize = 8) {
  const fillRect = vi.fn();
  const encode = vi.fn((callback: BlobCallback, type: string) => callback(new Blob([new Uint8Array(type === 'image/png' ? pngSize : 8)], { type })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect, drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray([200, 0, 0, alpha]) }) } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(encode);
  vi.stubGlobal('Image', class {
    naturalWidth = 2048; naturalHeight = 2048; onload?: () => void;
    private value = '';
    set src(value: string) { this.value = value; queueMicrotask(() => this.onload?.()); }
    get src() { return this.value; }
  });
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() });
  return { fillRect, encode };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('group photo rollout compatibility', () => {
  it('keeps the default JPEG-on-white output compatible with the old service', async () => {
    vi.stubEnv('VITE_GROUP_PNG', undefined);
    const { fillRect, encode } = canvasFixture(0);
    expect(await prepareGroupPhoto(file)).toMatch(/^data:image\/jpeg;base64,/);
    expect(fillRect).toHaveBeenCalledWith(0, 0, 256, 256);
    expect(encode).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.88);
  });
  it('preserves transparency only when enabled and does not flatten oversized PNGs', async () => {
    vi.stubEnv('VITE_GROUP_PNG', 'true');
    const { fillRect, encode } = canvasFixture(128, PHOTO_MAX_BYTES + 1);
    await expect(prepareGroupPhoto(file)).rejects.toThrow('too much detail');
    expect(fillRect).not.toHaveBeenCalled();
    expect(encode).toHaveBeenCalledTimes(1);
    expect(encode).toHaveBeenCalledWith(expect.any(Function), 'image/png');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });
  it('uses the smaller JPEG path for opaque pictures even when PNG is enabled', async () => {
    vi.stubEnv('VITE_GROUP_PNG', 'true');
    canvasFixture(255);
    expect(await prepareGroupPhoto(file)).toMatch(/^data:image\/jpeg;base64,/);
  });
  it('reopens existing PNG bytes with the correct MIME type', () => {
    const picture = photoFile('data:image/png;base64,iVBORw0KGgo=');
    expect(picture.type).toBe('image/png');
    expect(picture.size).toBe(8);
  });
});
