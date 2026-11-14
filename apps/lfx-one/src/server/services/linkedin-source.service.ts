// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  LINKEDIN_FILE_EXTENSIONS,
  LINKEDIN_FILE_TYPES_LABEL,
  LINKEDIN_LINK_CONTENT_TYPES,
  LINKEDIN_SOURCE_MAX_BYTES,
  LINKEDIN_SOURCE_TIMEOUT_MS,
} from '@lfx-one/shared/constants';
import { LinkedinForm } from '@lfx-one/shared/interfaces';
import { decodeHtmlEntities } from '@lfx-one/shared/utils';
import sanitizeHtml from 'sanitize-html';
import { Request } from 'express';

import { logger } from './logger.service';

import { ServiceValidationError } from '../errors';
import { fetchSafeUrl } from '../helpers/url-validation';

/** Bounded UTF-8 ingestion. Reuses the DNS-pinned, private-address-refusing HTTPS fetcher. */
export class LinkedinSourceService {
  public async ingest(
    answers: Record<string, unknown>,
    req?: Request
  ): Promise<Pick<LinkedinForm, 'content_source' | 'content_text' | 'content_url' | 'content_file_name'>> {
    const source = answers['content_source'];
    if (source === 'url') {
      const url = answers['content_url'];
      if (typeof url !== 'string' || url.length > 2048 || /\s/.test(url)) this.invalid('Enter one public HTTPS URL.');
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        this.invalid('Enter one public HTTPS URL.');
      }
      if (parsed.username || parsed.password) this.invalid('URLs must not contain credentials.');
      const result = await fetchSafeUrl(url, AbortSignal.timeout(LINKEDIN_SOURCE_TIMEOUT_MS), {
        maxResponseBytes: LINKEDIN_SOURCE_MAX_BYTES,
        allowedContentTypes: LINKEDIN_LINK_CONTENT_TYPES,
      }).catch((error: unknown) => {
        const code =
          error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code)
            ? error.code
            : undefined;
        // URL queries, filesystem paths and response text may be personal.
        // Keep the transport failure classification, never its raw message.
        logger.debug(req, 'linkedin_source_fetch', 'Public source fetch failed', {
          source_failure: { name: error instanceof Error ? error.constructor.name : 'UnknownError', code },
        });
        return this.invalid('Could not fetch that public HTTPS page. Paste its text instead.');
      });
      if (!result.ok) {
        logger.debug(req, 'linkedin_source_fetch', 'Public source returned an error status', { status: result.status });
        this.invalid('The page could not be fetched. Paste its text instead.');
      }
      const text = result.contentType === 'text/html' || result.contentType === 'application/xhtml+xml' ? this.htmlToText(result.html) : result.html;
      return { content_source: source, content_url: url, content_text: this.checkedText(text) };
    }
    if (source === 'file') {
      const name = answers['content_file_name'];
      const encoded = answers['content_file_base64'];
      if (typeof name !== 'string' || !name.trim() || name.length > 255 || !LINKEDIN_FILE_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(`.${ext}`)))
        this.invalid(`Upload a UTF-8 ${LINKEDIN_FILE_TYPES_LABEL} file.`);
      if (
        typeof encoded !== 'string' ||
        encoded.length > Math.ceil(LINKEDIN_SOURCE_MAX_BYTES / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
      )
        this.invalid('The uploaded file is invalid or exceeds 1 MB.');
      const bytes = Buffer.from(encoded, 'base64');
      if (bytes.length > LINKEDIN_SOURCE_MAX_BYTES) this.invalid('The uploaded file exceeds 1 MB.');
      let decoded: string;
      try {
        decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        this.invalid('The file must contain readable UTF-8 text, up to 1 MB.');
      }
      return {
        content_source: source,
        content_file_name: name,
        content_text: this.checkedText(name.toLowerCase().endsWith('.html') ? this.htmlToText(decoded) : decoded),
      };
    }
    if (source === 'text') return { content_source: source, content_text: this.checkedText(answers['content_text']) };
    return this.invalid('Choose pasted text, a link or a file.');
  }

  private checkedText(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0') || Buffer.byteLength(value, 'utf8') > LINKEDIN_SOURCE_MAX_BYTES)
      this.invalid('Supply readable content, up to 1 MB.');
    return value.trim();
  }

  private htmlToText(html: string): string {
    // Parse before removing the small set of surviving layout tags. Scripts/styles
    // are nonTextTags in sanitize-html; no markup is ever sent to the browser.
    const text = sanitizeHtml(html, {
      allowedTags: 'p br div li h1 h2 h3 h4 h5 h6 table thead tbody tfoot tr td th ul ol blockquote pre'.split(' '),
      allowedAttributes: {},
    })
      .replace(/<\/(?:td|th)>/gi, '\t')
      .replace(/<\/?(?:table|thead|tbody|tfoot|tr|p|br|div|li|h[1-6]|ul|ol|blockquote|pre)\s*\/?>/gi, '\n')
      .replace(/<\/?(?:td|th)>/gi, '');
    return decodeHtmlEntities(text)
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private invalid(message: string): never {
    throw ServiceValidationError.forField('content', message, { operation: 'linkedin_source' });
  }
}
