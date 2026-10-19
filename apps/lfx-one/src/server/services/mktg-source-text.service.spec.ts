// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { MktgSourceTextService } from './mktg-source-text.service';

const req = { path: '/api/mktg-agents/foundation-message/documents/file' } as unknown as Request;

describe('MktgSourceTextService.readFile', () => {
  it('reads the accepted file types and refuses the rest by extension', async () => {
    const service = new MktgSourceTextService();

    expect((await service.readFile(req, 'notes.md', Buffer.from('# Notes'), 1000)).text).toBe('# Notes');
    expect(await service.readFile(req, 'deck.pptx', Buffer.from('PK'), 1000)).toEqual({ text: null, truncated: false, reason: 'unsupported' });
  });

  it("refuses a file over the 20 MB cap unread, and caps a real PDF's text with the explicit marker", async () => {
    const service = new MktgSourceTextService();
    const pdf = readFileSync(new URL('../helpers/__fixtures__/mktg-document-note.pdf', import.meta.url));

    expect((await service.readFile(req, 'huge.pdf', Buffer.alloc(20 * 1024 * 1024 + 1), 1000)).reason).toBe('too-large');
    expect(await service.readFile(req, 'note.pdf', pdf, 14)).toEqual({
      text: 'Example Search\n\n…(truncated by LFX before submission)',
      truncated: true,
    });
  });

  it('caps a long text with an explicit marker, never a silent clip', async () => {
    const service = new MktgSourceTextService();

    const read = await service.readFile(req, 'notes.txt', Buffer.from('word '.repeat(100)), 20);

    expect(read.truncated).toBe(true);
    expect(read.text).toBe(`${'word '.repeat(4)}\n\n…(truncated by LFX before submission)`);
  });

  it('does not read links: the agent fetches its own sources and document links', () => {
    expect((new MktgSourceTextService() as unknown as Record<string, unknown>)['readLink']).toBeUndefined();
  });
});
