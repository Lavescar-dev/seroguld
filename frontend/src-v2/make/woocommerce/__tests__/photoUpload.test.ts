import { describe, expect, it } from 'vitest';

import {
  PHOTO_MAX_SIZE_BYTES,
  PHOTO_MAX_SIZE_MB,
  describeRejectedPhotos,
  validatePhotoFiles,
} from '../photoUpload';

function makeFile(name: string, type: string, size: number): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('validatePhotoFiles', () => {
  it('accepts supported image types under the server size limit', () => {
    const files = [
      makeFile('a.jpg', 'image/jpeg', 1024),
      makeFile('b.webp', 'image/webp', PHOTO_MAX_SIZE_BYTES),
      makeFile('c.avif', '', 1024),
    ];
    const result = validatePhotoFiles(files);
    expect(result.accepted).toHaveLength(3);
    expect(result.rejected).toHaveLength(0);
  });

  it('rejects non-image types with a clear reason', () => {
    const result = validatePhotoFiles([makeFile('rapor.pdf', 'application/pdf', 1024)]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('desteklenmeyen tür');
  });

  it('rejects oversized files mirroring the backend 413 rule', () => {
    const result = validatePhotoFiles([makeFile('big.jpg', 'image/jpeg', PHOTO_MAX_SIZE_BYTES + 1)]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected[0].reason).toContain(`${PHOTO_MAX_SIZE_MB} MB`);
  });

  it('splits mixed batches into accepted and rejected', () => {
    const result = validatePhotoFiles([
      makeFile('ok.png', 'image/png', 1024),
      makeFile('nope.txt', 'text/plain', 10),
    ]);
    expect(result.accepted.map((file) => file.name)).toEqual(['ok.png']);
    expect(describeRejectedPhotos(result.rejected)).toContain('nope.txt');
  });
});
