// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMocks = vi.hoisted(() => ({ fetchSafeUrlBytes: vi.fn() }));

vi.mock('../helpers/url-validation', () => ({ fetchSafeUrlBytes: fetchMocks.fetchSafeUrlBytes }));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { MktgSourceTextService } from './mktg-source-text.service';

const req = { path: '/api/mktg-agents/foundation-message/generate' } as unknown as Request;

const response = (body: string, overrides: Record<string, unknown> = {}) => ({
  body: Buffer.from(body, 'utf8'),
  ok: true,
  status: 200,
  finalUrl: 'https://search.example.org/',
  contentType: 'text/html; charset=utf-8',
  ...overrides,
});

describe('MktgSourceTextService.readLink', () => {
  let service: MktgSourceTextService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MktgSourceTextService();
  });

  it('reads a page to text through the SSRF-safe fetcher, with its title, under the 20 MB cap', async () => {
    fetchMocks.fetchSafeUrlBytes.mockResolvedValue(response('<html><head><title>Example</title></head><body><p>Open search.</p></body></html>'));

    const read = await service.readLink(req, 'https://search.example.org/', 1000);

    expect(read).toEqual({ text: 'Open search.', title: 'Example', truncated: false });
    const [url, , maxBytes] = fetchMocks.fetchSafeUrlBytes.mock.calls[0];
    expect(url).toBe('https://search.example.org/');
    expect(maxBytes).toBe(20 * 1024 * 1024);
  });

  it('reads a Google Doc through its plain-text export', async () => {
    fetchMocks.fetchSafeUrlBytes.mockResolvedValue(response('Positioning note', { contentType: 'text/plain; charset=utf-8' }));

    const read = await service.readLink(req, 'https://docs.google.com/document/d/AbC-12_x/edit?usp=sharing', 1000);

    expect(fetchMocks.fetchSafeUrlBytes.mock.calls[0][0]).toBe('https://docs.google.com/document/d/AbC-12_x/export?format=txt');
    expect(read.text).toBe('Positioning note');
  });

  it('reports a private Google Doc as not shared instead of reading the sign-in page', async () => {
    fetchMocks.fetchSafeUrlBytes.mockResolvedValue(response('<html>Sign in</html>', { finalUrl: 'https://accounts.google.com/ServiceLogin' }));

    expect(await service.readLink(req, 'https://docs.google.com/document/d/private/edit', 1000)).toMatchObject({ text: null, reason: 'not-shared' });
  });

  it('never throws: a failed status, a refused host and an oversized body each come back with their reason', async () => {
    fetchMocks.fetchSafeUrlBytes.mockResolvedValueOnce(response('', { ok: false, status: 404 }));
    fetchMocks.fetchSafeUrlBytes.mockRejectedValueOnce(new Error('URLs targeting private/internal hosts are not allowed'));
    fetchMocks.fetchSafeUrlBytes.mockRejectedValueOnce(new Error('Response exceeded 20971520 bytes'));

    expect((await service.readLink(req, 'https://search.example.org/missing', 1000)).reason).toBe('fetch-failed');
    expect((await service.readLink(req, 'https://10.0.0.1/', 1000)).reason).toBe('fetch-failed');
    expect((await service.readLink(req, 'https://search.example.org/huge.pdf', 1000)).reason).toBe('too-large');
  });

  it('caps a long text with an explicit marker, never a silent clip', async () => {
    fetchMocks.fetchSafeUrlBytes.mockResolvedValue(response('word '.repeat(100), { contentType: 'text/plain' }));

    const read = await service.readLink(req, 'https://search.example.org/notes.txt', 20);

    expect(read.truncated).toBe(true);
    expect(read.text).toBe(`${'word '.repeat(4)}\n\n…(truncated by LFX before submission)`);
  });
});

describe('MktgSourceTextService.readFile', () => {
  it('reads the accepted file types and refuses the rest by extension', () => {
    const service = new MktgSourceTextService();

    expect(service.readFile('notes.md', Buffer.from('# Notes'), 1000).text).toBe('# Notes');
    expect(service.readFile('deck.pptx', Buffer.from('PK'), 1000)).toEqual({ text: null, title: null, truncated: false, reason: 'unsupported' });
  });
});
