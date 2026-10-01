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
