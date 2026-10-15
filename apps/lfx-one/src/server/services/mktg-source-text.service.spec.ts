// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMocks = vi.hoisted(() => ({ fetchSafeUrlBytes: vi.fn() }));

vi.mock('../helpers/url-validation', () => ({ fetchSafeUrlBytes: fetchMocks.fetchSafeUrlBytes }));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { MktgReadBudget } from '../helpers/mktg-document-read-gate.helper';
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

  it('parses only a readable content type: an image, JSON or a missing type is refused unread', async () => {
    for (const contentType of ['image/png', 'application/json', '']) {
      fetchMocks.fetchSafeUrlBytes.mockResolvedValueOnce(response('Readable words.', { contentType }));

      expect(await service.readLink(req, 'https://search.example.org/file', 1000)).toEqual({
        text: null,
        title: null,
        truncated: false,
        reason: 'unsupported',
      });
    }
  });

  it('reads text, PDF, Word, XHTML and octet-stream responses, parameters ignored', async () => {
    for (const contentType of ['text/markdown; charset=utf-8', 'application/octet-stream', 'application/xhtml+xml; charset=utf-8']) {
      fetchMocks.fetchSafeUrlBytes.mockResolvedValueOnce(response('Readable words.', { contentType }));

      expect((await service.readLink(req, 'https://search.example.org/file', 1000)).text).toBe('Readable words.');
    }
  });

  it('stops parsing once the request has spent its shared budget', async () => {
    fetchMocks.fetchSafeUrlBytes.mockResolvedValue(response('Readable words.', { contentType: 'text/plain' }));
    const budget = new MktgReadBudget(1);
    budget.spend(1);

    expect(await service.readLink(req, 'https://search.example.org/notes.txt', 1000, budget)).toMatchObject({ text: null, reason: 'too-complex' });
  });

  it('refuses a read as busy when the user already has too many waiting, instead of queueing without end', async () => {
    const held: ((value: ReturnType<typeof response>) => void)[] = [];
    fetchMocks.fetchSafeUrlBytes.mockImplementation(() => new Promise((resolve) => held.push(resolve)));
    const busyReq = { path: '/api/mktg-agents/foundation-message/documents/link', oidc: { user: { sub: 'auth0|busy' } } } as unknown as Request;

    // Four run and twelve wait; the seventeenth is refused at once.
    const pending = Array.from({ length: 16 }, () => service.readLink(busyReq, 'https://search.example.org/slow', 1000));
    await new Promise((resolve) => setImmediate(resolve));
    expect(held).toHaveLength(4);
    expect(await service.readLink(busyReq, 'https://search.example.org/slow', 1000)).toMatchObject({ text: null, reason: 'busy' });

    // Once the four finish, the waiters run in turn.
    fetchMocks.fetchSafeUrlBytes.mockResolvedValue(response('Done.', { contentType: 'text/plain' }));
    held.forEach((resolve) => resolve(response('Done.', { contentType: 'text/plain' })));
    const reads = await Promise.all(pending);
    expect(reads.every((read) => read.text === 'Done.')).toBe(true);
  });

  it('caps a long text with an explicit marker, never a silent clip', async () => {
    fetchMocks.fetchSafeUrlBytes.mockResolvedValue(response('word '.repeat(100), { contentType: 'text/plain' }));

    const read = await service.readLink(req, 'https://search.example.org/notes.txt', 20);

    expect(read.truncated).toBe(true);
    expect(read.text).toBe(`${'word '.repeat(4)}\n\n…(truncated by LFX before submission)`);
  });
});

describe('MktgSourceTextService.readFile', () => {
  it('reads the accepted file types and refuses the rest by extension', async () => {
    const service = new MktgSourceTextService();

    expect((await service.readFile(req, 'notes.md', Buffer.from('# Notes'), 1000)).text).toBe('# Notes');
    expect(await service.readFile(req, 'deck.pptx', Buffer.from('PK'), 1000)).toEqual({ text: null, title: null, truncated: false, reason: 'unsupported' });
  });

  it("refuses a file over the 20 MB cap unread, and caps a real PDF's text with the explicit marker", async () => {
    const service = new MktgSourceTextService();
    const pdf = readFileSync(new URL('../helpers/__fixtures__/mktg-document-note.pdf', import.meta.url));

    expect((await service.readFile(req, 'huge.pdf', Buffer.alloc(20 * 1024 * 1024 + 1), 1000)).reason).toBe('too-large');
    expect(await service.readFile(req, 'note.pdf', pdf, 14)).toEqual({
      text: 'Example Search\n\n…(truncated by LFX before submission)',
      title: null,
      truncated: true,
    });
  });
});
