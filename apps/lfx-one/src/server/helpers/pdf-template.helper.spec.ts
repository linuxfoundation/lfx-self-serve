// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { drawPdfSignature } from './pdf-template.helper';

const IMAGES_DIR = join(__dirname, '..', 'pdf-templates', 'visa-letter-manual', 'images');

function fakeDoc(y: number): PDFKit.PDFDocument & { image: ReturnType<typeof vi.fn> } {
  return { y, image: vi.fn() } as unknown as PDFKit.PDFDocument & { image: ReturnType<typeof vi.fn> };
}

describe('drawPdfSignature', () => {
  it.each([
    ['image1.png', 261, 80],
    ['cncf-signature.png', 232, 210],
  ])('draws %s at the cursor and moves the cursor below it', (file, pixelWidth, pixelHeight) => {
    const path = join(IMAGES_DIR, file);
    const doc = fakeDoc(400);

    drawPdfSignature(doc, path, 44, 110);

    expect(doc.image).toHaveBeenCalledWith(path, 44, 400, { width: 110 });
    expect(doc.y).toBeCloseTo(400 + (110 * pixelHeight) / pixelWidth);
  });

  it('rejects a file that is not a PNG', () => {
    expect(() => drawPdfSignature(fakeDoc(0), __filename, 44, 110)).toThrow(/Not a PNG image/);
  });
});
