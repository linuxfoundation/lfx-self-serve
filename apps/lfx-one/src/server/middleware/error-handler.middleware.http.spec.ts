// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import pinoHttp from 'pino-http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Unlike controller/route fixtures, this harness uses the real LoggerService and Pino output.
// Parser failures skip pino-http in production, so mocking either logger hides the failure.
describe('API parser errors before request logging', { timeout: 20_000 }, () => {
  let server: Server | undefined;
  let baseUrl: string;
  let downstreamRequests = 0;
  const lines: string[] = [];

  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LOG_LEVEL', 'info');
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      lines.push(chunk.toString());
      return true;
    });
    const { apiErrorHandler } = await import('./error-handler.middleware');
    const { serverLogger } = await import('../server-logger');
    const app = express();
    app.set('env', 'production');
    app.use(express.json({ limit: '15mb' }));
    app.use(pinoHttp({ logger: serverLogger, autoLogging: false }));
    app.post(['/api/social-listening/mentions-feed', '/api/social-listening/mentions-count'], (_req, res) => {
      downstreamRequests++;
      res.sendStatus(204);
    });
    app.use(apiErrorHandler);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const address = server?.address();
    if (!address || typeof address === 'string') throw new Error('Expected an ephemeral HTTP port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    downstreamRequests = 0;
    lines.length = 0;
  });

  afterAll(async () => {
    try {
      if (server) {
        await new Promise<void>((resolve, reject) => server?.close((error) => (error ? reject(error) : resolve())));
      }
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  });

  it.each(['/mentions-feed', '/mentions-count'])('returns a redacted structured 400 with real logging on %s', async (suffix) => {
    const path = `/api/social-listening${suffix}`;
    for (const body of ['null', '"synthetic-private-body"', '42', 'true', '{"synthetic-private-body":']) {
      lines.length = 0;
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload).toMatchObject({ code: 'VALIDATION_ERROR', errors: [{ field: 'body' }], path });
      expect(JSON.stringify(payload)).not.toContain('synthetic-private-body');
      expect(lines.map((line) => JSON.parse(line))).toContainEqual(
        expect.objectContaining({
          level: 'WARN',
          data: expect.objectContaining({ error_code: 'VALIDATION_ERROR', status_code: 400, path, method: 'POST' }),
        })
      );
      expect(lines.join('')).not.toContain('synthetic-private-body');
    }
    expect(downstreamRequests).toBe(0);
  });
});
