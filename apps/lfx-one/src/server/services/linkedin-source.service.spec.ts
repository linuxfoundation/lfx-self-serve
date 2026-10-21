// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LINKEDIN_FILE_TYPES_LABEL } from '@lfx-one/shared/constants';
const fetch = vi.hoisted(() => vi.fn());
const warning = vi.hoisted(() => vi.fn());
const debug = vi.hoisted(() => vi.fn());
vi.mock('./logger.service', () => ({ logger: { warning, debug } }));
vi.mock('../helpers/url-validation', () => ({ fetchSafeUrl: fetch }));
import { LinkedinSourceService } from './linkedin-source.service';

describe('LinkedIn source ingestion', () => {
  beforeEach(() => vi.clearAllMocks());
  it('passes pasted content, refusing blank and oversize inputs', async () => {
    const source = new LinkedinSourceService();
    expect(await source.ingest({ content_source: 'text', content_text: ' Pasted source ' })).toEqual({ content_source: 'text', content_text: 'Pasted source' });
    for (const text of ['', ' ', 'x'.repeat(1048577), '\0bad']) await expect(source.ingest({ content_source: 'text', content_text: text })).rejects.toThrow();
  });
  it('decodes a UTF-8 file server-side and extracts HTML without scripts', async () => {
    const result = await new LinkedinSourceService().ingest({
      content_source: 'file',
      content_file_name: 'release.html',
      content_file_base64: Buffer.from('<h1>Release</h1><script>bad()</script><p>New &amp; useful</p>').toString('base64'),
    });
    expect(result.content_text).toBe('Release\n\nNew & useful');
    expect(result.content_file_name).toBe('release.html');
  });
  it('decodes named/numeric entities once without turning a literal escape into markup', async () => {
    const result = await new LinkedinSourceService().ingest({
      content_source: 'file',
      content_file_name: 'entities.html',
      content_file_base64: Buffer.from('<p>A&#x26;B &copy; &#x1F680; &amp;lt;literal&amp;gt;</p>').toString('base64'),
    });
    expect(result.content_text).toBe('A&B © 🚀 &lt;literal&gt;');
  });
  it('refuses binary, unsupported and oversize uploads', async () => {
    for (const answers of [
      { content_file_name: 'binary.txt', content_file_base64: '/w==' },
      { content_file_name: 'file.pdf', content_file_base64: 'YWJj' },
      { content_file_name: 'large.txt', content_file_base64: 'a'.repeat(1400000) },
    ]) {
      await expect(new LinkedinSourceService().ingest({ content_source: 'file', ...answers })).rejects.toThrow();
    }
    await expect(
      new LinkedinSourceService().ingest({ content_source: 'file', content_file_name: 'unsupported.bin', content_file_base64: 'YWJj' })
    ).rejects.toMatchObject({ validationErrors: [{ message: `Upload a UTF-8 ${LINKEDIN_FILE_TYPES_LABEL} file.` }] });
  });
  it('fetches with the existing SSRF-safe helper and uses the actual page text', async () => {
    fetch.mockResolvedValue({ ok: true, contentType: 'text/html', html: '<p>Fetched release</p>', finalUrl: 'https://public.example/release' });
    const result = await new LinkedinSourceService().ingest({
      content_source: 'url',
      content_url: 'https://public.example/release',
      content_text: 'Do not trust client text',
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://public.example/release',
      expect.any(AbortSignal),
      expect.objectContaining({ maxResponseBytes: 1048576, allowedContentTypes: expect.arrayContaining(['text/html', 'text/plain']) })
    );
    expect(result.content_text).toBe('Fetched release');
  });
  it.each(['text/plain', 'text/markdown'])('preserves literal angle brackets and Markdown autolinks from %s URLs', async (contentType) => {
    fetch.mockResolvedValueOnce({ ok: true, contentType, html: '  List<T>\n<https://public.example/release>  ' });
    const result = await new LinkedinSourceService().ingest({ content_source: 'url', content_url: 'https://public.example/release' });
    expect(result.content_text).toBe('List<T>\n<https://public.example/release>');
  });

  it('preserves specific credential, HTTP, empty-page and file validation reasons', async () => {
    const source = new LinkedinSourceService();
    await expect(source.ingest({ content_source: 'url', content_url: 'https://secret@public.example/' })).rejects.toMatchObject({
      validationErrors: [{ message: 'URLs must not contain credentials.' }],
    });
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockResolvedValueOnce({ ok: false, html: '' });
    await expect(source.ingest({ content_source: 'url', content_url: 'https://public.example/' })).rejects.toMatchObject({
      validationErrors: [{ message: 'The page could not be fetched. Paste its text instead.' }],
    });
    fetch.mockResolvedValueOnce({ ok: true, contentType: 'text/html', html: '<script>hidden</script>' });
    await expect(source.ingest({ content_source: 'url', content_url: 'https://public.example/' })).rejects.toMatchObject({
      validationErrors: [{ message: 'Supply readable content, up to 1 MB.' }],
    });
    await expect(source.ingest({ content_source: 'file', content_file_name: 'empty.txt', content_file_base64: '' })).rejects.toMatchObject({
      validationErrors: [{ message: 'Supply readable content, up to 1 MB.' }],
    });
    await expect(
      source.ingest({ content_source: 'file', content_file_name: 'large.txt', content_file_base64: Buffer.alloc(1048577, 'x').toString('base64') })
    ).rejects.toMatchObject({ validationErrors: [{ message: 'The uploaded file exceeds 1 MB.' }] });
  });
  it('logs transport failure classification without logging the source URL or error message', async () => {
    fetch.mockRejectedValueOnce(Object.assign(new Error('https://private-data.example/?token=personal'), { code: 'ECONNRESET' }));
    await expect(new LinkedinSourceService().ingest({ content_source: 'url', content_url: 'https://public.example/' })).rejects.toThrow();
    expect(debug).toHaveBeenCalledWith(undefined, 'linkedin_source_fetch', 'Public source fetch failed', {
      source_failure: { name: 'Error', code: 'ECONNRESET' },
    });
    expect(warning).not.toHaveBeenCalled();
    expect(JSON.stringify(debug.mock.calls)).not.toContain('personal');
  });
  it('surfaces fetch refusals rather than running on an empty or private page', async () => {
    fetch.mockRejectedValue(new Error('private address'));
    await expect(new LinkedinSourceService().ingest({ content_source: 'url', content_url: 'https://127.0.0.1' })).rejects.toThrow(
      'Validation failed for content'
    );
    await expect(new LinkedinSourceService().ingest({ content_source: 'url', content_url: 'https://secret@public.example/' })).rejects.toThrow();
  });
});
