// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_MESSAGE_FILE_EXTENSIONS, FOUNDATION_MESSAGE_MAX_FILE_BYTES, FOUNDATION_MESSAGE_TEXT_TRUNCATION_MARKER } from '@lfx-one/shared/constants';
import { MktgReadText } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MktgDocumentText } from '../helpers/mktg-document-text.helper';
import { fetchSafeUrlBytes } from '../helpers/url-validation';
import { logger } from './logger.service';

/**
 * Reads the pages and files a Marketing OS agent needs to text, because the
 * agents cannot fetch or open files themselves: the Messaging Document's four
 * sources and its existing documents.
 *
 * Links go through the SSRF-safe fetcher (`fetchSafeUrlBytes`: HTTPS only,
 * public hosts only, every redirect re-validated, a size cap). A Google Doc
 * link is read through the document's own text export, which works for any
 * document shared as "Anyone with the link"; a private one redirects to the
 * Google sign-in page, which is reported as not shared rather than read as the
 * document. Never throws: whatever cannot be read comes back with its reason,
 * and the agent is told the source was not read.
 */
export class MktgSourceTextService {
  /** How long one link may take, redirects included. */
  private readonly fetchTimeoutMs = 20_000;

  /** Read a link to text, capped at `maxChars` with an explicit marker. */
  public async readLink(req: Request, url: string, maxChars: number): Promise<MktgReadText> {
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      return this.none('fetch-failed');
    }
    const host = parsed.hostname;

    try {
      const response = await fetchSafeUrlBytes(this.readableUrl(parsed), AbortSignal.timeout(this.fetchTimeoutMs), FOUNDATION_MESSAGE_MAX_FILE_BYTES);
      if (new URL(response.finalUrl).hostname === 'accounts.google.com') {
        logger.debug(req, 'mktg_source_text', 'Link needs a Google sign-in — not shared publicly', { host });
        return this.none('not-shared');
      }
      if (!response.ok) {
        logger.debug(req, 'mktg_source_text', 'Link fetch returned a non-success status', { host, status: response.status });
        return this.none('fetch-failed');
      }
      const read = MktgDocumentText.read(response.body, { fileName: parsed.pathname, contentType: response.contentType, baseUrl: response.finalUrl });
      logger.debug(req, 'mktg_source_text', 'Read a link to text', { host, read: read.text !== null, reason: read.reason });
      return this.cap(read, maxChars);
    } catch (error) {
      const tooLarge = error instanceof Error && error.message.startsWith('Response exceeded');
      // Raised to INFO: a source the agent never saw makes a thinner document, and this is where to find out why.
      logger.info(req, 'mktg_source_text', 'Could not fetch a link — the agent is told it was not read', {
        host,
        reason: tooLarge ? 'too-large' : 'fetch-failed',
        error: error instanceof Error ? error.message : 'unknown',
      });
      return this.none(tooLarge ? 'too-large' : 'fetch-failed');
    }
  }

  /** Read an uploaded file to text, capped at `maxChars` with an explicit marker. */
  public readFile(fileName: string, bytes: Buffer, maxChars: number): MktgReadText {
    const lower = fileName.toLowerCase();
    if (!FOUNDATION_MESSAGE_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
      return this.none('unsupported');
    }
    if (bytes.byteLength > FOUNDATION_MESSAGE_MAX_FILE_BYTES) {
      return this.none('too-large');
    }
    return this.cap(MktgDocumentText.read(bytes, { fileName }), maxChars);
  }

  /** The URL to fetch for a link: a Google Doc's plain-text export, else the link itself. */
  private readableUrl(parsed: URL): string {
    const googleDoc = /^\/document\/d\/([A-Za-z0-9_-]+)/.exec(parsed.pathname);
    if (parsed.hostname === 'docs.google.com' && googleDoc) {
      return `https://docs.google.com/document/d/${googleDoc[1]}/export?format=txt`;
    }
    return parsed.href;
  }

  private cap(read: MktgReadText, maxChars: number): MktgReadText {
    if (read.text === null || read.text.length <= maxChars) {
      return read;
    }
    return { ...read, text: `${read.text.slice(0, maxChars)}${FOUNDATION_MESSAGE_TEXT_TRUNCATION_MARKER}`, truncated: true };
  }

  private none(reason: MktgReadText['reason']): MktgReadText {
    return { text: null, title: null, truncated: false, reason };
  }
}
