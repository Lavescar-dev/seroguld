import { describe, expect, it } from 'vitest';

import { buildMediaUrl } from '../media';

describe('buildMediaUrl', () => {
  it('göreli /media yolunu backend origin ile mutlaklaştırır', () => {
    const url = buildMediaUrl('/media/products/abc/1.avif');
    expect(url).toMatch(/^https?:\/\//);
    expect(url.endsWith('/media/products/abc/1.avif')).toBe(true);
  });

  it('mutlak, blob ve data URL:lerini olduğu gibi geçirir', () => {
    expect(buildMediaUrl('http://127.0.0.1:8100/media/x.jpg')).toBe('http://127.0.0.1:8100/media/x.jpg');
    expect(buildMediaUrl('blob:tauri://localhost/abc')).toBe('blob:tauri://localhost/abc');
    expect(buildMediaUrl('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
  });

  it('boş değerde boş döner', () => {
    expect(buildMediaUrl('')).toBe('');
    expect(buildMediaUrl(null)).toBe('');
    expect(buildMediaUrl(undefined)).toBe('');
  });
});
