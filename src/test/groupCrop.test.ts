import { describe, expect, it } from 'vitest';
import { centerSquare, cropSquare, photoFile } from '@/lib/groupPicture';

describe('group picture crop geometry', () => {
  it('keeps the previous center crop by default, including portraits', () => {
    for (const [w, h] of [[1600, 800], [800, 1600], [1, 1]]) expect(cropSquare(w, h)).toEqual(centerSquare(w, h));
  });
  it('reaches each edge without exposing an empty margin', () => {
    expect(cropSquare(1600, 800, { x: 0, y: 0, zoom: 2 })).toEqual({ sx: 0, sy: 0, size: 400 });
    expect(cropSquare(1600, 800, { x: 1, y: 1, zoom: 2 })).toEqual({ sx: 1200, sy: 400, size: 400 });
  });
  it('clamps invalid input and never crops outside the original', () => {
    expect(cropSquare(1600, 800, { x: -1, y: 5, zoom: 0 })).toEqual({ sx: 0, sy: 0, size: 800 });
    expect(cropSquare(800, 1600, { x: NaN, y: Infinity, zoom: NaN })).toEqual(centerSquare(800, 1600));
    for (const zoom of [1, 1.5, 2, 3, 20]) {
      const { sx, sy, size } = cropSquare(800, 1600, { x: 1, y: 1, zoom });
      expect(sx + size).toBeLessThanOrEqual(800);
      expect(sy + size).toBeLessThanOrEqual(1600);
    }
  });
  it('reopens stored JPEG bytes locally and refuses other sources', async () => {
    const file = photoFile('data:image/jpeg;base64,/9j/2Q==');
    expect(file.type).toBe('image/jpeg');
    expect(file.size).toBe(4);
    expect(() => photoFile('https://example.com/a.jpg')).toThrow('upload the original');
  });
});
