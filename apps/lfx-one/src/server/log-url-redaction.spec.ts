// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The invite pages carry a signed credential in `?token=`, and reqSerializer only redacts the
 * request line pino-http writes. A raw `req.url` / `req.originalUrl` passed as log metadata
 * bypasses it, so every such field must go through redactInviteToken. The SSR render-error log in
 * server.ts is the motivating case; it sits behind the full Angular server, which no unit spec loads.
 */
describe('server log metadata never carries a raw request URL', () => {
  const serverDir = new URL('./', import.meta.url);
  const sources = (readdirSync(serverDir, { recursive: true }) as string[])
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
    .map((file) => ({ file, source: readFileSync(new URL(file, serverDir), 'utf8') }));

  it('scans the server sources', () => {
    expect(sources.some(({ file }) => file === 'server.ts')).toBe(true);
  });

  it('passes every logged url / originalUrl through redactInviteToken', () => {
    const rawUrlField = /\b(?:url|originalUrl)\s*:\s*req\.(?:url|originalUrl)\b/;
    const offenders = sources.filter(({ source }) => rawUrlField.test(source)).map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});
