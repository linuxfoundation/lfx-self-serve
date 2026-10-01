// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// In production, import.meta.url points to the server bundle (dist/lfx-one/server/server.mjs)
// and pdf-templates are copied there by the build script.
// In dev (ng serve), import.meta.url resolves to Vite's virtual root, so we fall back
// to the source tree via process.cwd() (which is apps/lfx-one/ when running ng serve).
export function resolvePdfTemplateDir(): string {
  const bundlePath = join(dirname(fileURLToPath(import.meta.url)), 'pdf-templates', 'visa-letter-manual');
  if (existsSync(bundlePath)) return bundlePath;

  const devPath = join(process.cwd(), 'src', 'server', 'pdf-templates', 'visa-letter-manual');
  if (existsSync(devPath)) return devPath;

  return bundlePath; // will produce a clear ENOENT if neither exists
}

let helveticaFont: Buffer | undefined;

// Read once per process: the font is a static multi-MB asset shared by every generated PDF.
export function loadPdfFont(): Buffer {
  return (helveticaFont ??= readFileSync(join(resolvePdfTemplateDir(), 'fonts', 'Helvetica.ttc')));
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngSizes = new Map<string, { width: number; height: number }>();

// Width and height sit in the IHDR chunk right after the 8-byte signature.
function readPngSize(path: string): { width: number; height: number } {
  let size = pngSizes.get(path);
  if (!size) {
    const header = readFileSync(path).subarray(0, 24);
    if (header.length < 24 || !header.subarray(0, 8).equals(PNG_SIGNATURE) || header.toString('ascii', 12, 16) !== 'IHDR') {
      throw new Error(`Not a PNG image: ${path}`);
    }
    size = { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
    pngSizes.set(path, size);
  }
  return size;
}

// PDFKit 0.15 leaves doc.y at the image's top edge, so move it below the image ourselves.
export function drawPdfSignature(doc: PDFKit.PDFDocument, imagePath: string, x: number, width: number): void {
  const { width: pixelWidth, height: pixelHeight } = readPngSize(imagePath);
  const top = doc.y;
  doc.image(imagePath, x, top, { width });
  doc.y = top + (width * pixelHeight) / pixelWidth;
}
