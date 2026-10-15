// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MktgReadText } from '@lfx-one/shared/interfaces';
import { Tokenizer } from 'htmlparser2';
import { inflateRawSync } from 'node:zlib';

import { PdfTextReader } from './mktg-pdf-text.helper';

/**
 * Turns a file or a fetched page into the text an agent with no file or web
 * access reads (the Messaging Document's sources and existing documents):
 * PDF, Word (.docx), HTML, Markdown and plain text, told apart by their bytes
 * first and their name or content type second. Nothing here fetches; nothing
 * throws — what cannot be read comes back with its reason.
 */
export class MktgDocumentText {
  /** Most HTML characters tokenized: a page's header, navigation and body copy sit well inside this. */
  private static readonly maxHtmlChars = 2_000_000;

  /** Most bytes a .docx part may inflate to — a guard against compression bombs. */
  private static readonly maxDocxXmlBytes = 64 * 1024 * 1024;

  /** Block-level elements: each starts and ends a line. */
  // prettier-ignore
  private static readonly blockTags = new Set([
    'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure', 'footer', 'form', 'header', 'hr', 'li',
    'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br',
  ]);

  /** Elements whose content is never page text. */
  private static readonly skipTags = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'canvas', 'object', 'select', 'textarea']);

  /**
   * The text of a file or a response body.
   *
   * @param bytes - The raw bytes
   * @param hints - The file name or the response's content type, and for HTML the URL relative links resolve against
   */
  public static read(bytes: Buffer, hints: { fileName?: string; contentType?: string; baseUrl?: string }): MktgReadText {
    try {
      return MktgDocumentText.readBytes(bytes, hints);
    } catch {
      // Each reader bounds its own work; this keeps the never-throws promise for anything they did not foresee.
      return MktgDocumentText.none('unsupported');
    }
  }

  private static readBytes(bytes: Buffer, hints: { fileName?: string; contentType?: string; baseUrl?: string }): MktgReadText {
    const name = (hints.fileName ?? '').toLowerCase();
    const type = hints.contentType ?? '';
    const head = bytes.subarray(0, 1024).toString('latin1');

    // A PDF reader accepts the header anywhere in the first kilobyte (some generators write junk before it).
    if (head.includes('%PDF-') || type.includes('application/pdf')) {
      const pdf = PdfTextReader.read(bytes);
      return 'text' in pdf ? MktgDocumentText.ok(pdf.text) : MktgDocumentText.none(pdf.reason);
    }
    if (head.startsWith('PK\u0003\u0004')) {
      const xml = MktgDocumentText.zipEntry(bytes, 'word/document.xml');
      return xml === null ? MktgDocumentText.none('unsupported') : MktgDocumentText.ok(MktgDocumentText.docxText(xml));
    }
    if (bytes.includes(0)) {
      return MktgDocumentText.none('unsupported');
    }
    const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
    const looksHtml = type.includes('html') || /^\s*(<!doctype html|<html|<head|<body)/i.test(text.slice(0, 512));
    if (looksHtml && !name.endsWith('.md') && !name.endsWith('.txt')) {
      const page = MktgDocumentText.htmlText(text.slice(0, MktgDocumentText.maxHtmlChars), hints.baseUrl);
      return { ...MktgDocumentText.ok(page.text), title: page.title };
    }
    return MktgDocumentText.ok(text.replace(/\r\n?/g, '\n'));
  }

  private static ok(text: string): MktgReadText {
    const trimmed = text.trim();
    return /[\p{L}\p{N}]/u.test(trimmed) ? { text: trimmed, title: null, truncated: false } : MktgDocumentText.none('no-text');
  }

  private static none(reason: MktgReadText['reason']): MktgReadText {
    return { text: null, title: null, truncated: false, reason };
  }

  // === Word (.docx) ===

  /** One entry of a zip archive (stored or deflated; no ZIP64), or null when it is not there. */
  private static zipEntry(zip: Buffer, entryName: string): Buffer | null {
    try {
      const searchFrom = Math.max(0, zip.length - 65557);
      const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      if (eocd < searchFrom) {
        return null;
      }
      const count = zip.readUInt16LE(eocd + 10);
      let at = zip.readUInt32LE(eocd + 16);
      for (let i = 0; i < count && zip.readUInt32LE(at) === 0x02014b50; i++) {
        const method = zip.readUInt16LE(at + 10);
        const compressedSize = zip.readUInt32LE(at + 20);
        const nameLength = zip.readUInt16LE(at + 28);
        const extraLength = zip.readUInt16LE(at + 30);
        const commentLength = zip.readUInt16LE(at + 32);
        const localOffset = zip.readUInt32LE(at + 42);
        const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
        at += 46 + nameLength + extraLength + commentLength;
        if (name !== entryName || zip.readUInt32LE(localOffset) !== 0x04034b50) {
          continue;
        }
        const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
        const data = zip.subarray(dataStart, dataStart + compressedSize);
        if (method === 0) {
          return data;
        }
        return method === 8 ? inflateRawSync(data, { maxOutputLength: MktgDocumentText.maxDocxXmlBytes }) : null;
      }
      return null;
    } catch {
      return null;
    }
  }

  /** The paragraphs of a WordprocessingML body: `w:t` runs, tabs and breaks, one line per `w:p`. */
  private static docxText(xml: Buffer): string {
    const source = xml.toString('utf8');
    const out: string[] = [];
    let tag = '';
    let inText = false;
    const tokenizer = new Tokenizer(
      { xmlMode: true, decodeEntities: true },
      {
        onopentagname(start, end) {
          tag = source.slice(start, end);
        },
        onopentagend() {
          inText = tag === 'w:t';
          if (tag === 'w:tab') {
            out.push('\t');
          }
        },
        onselfclosingtag() {
          if (tag === 'w:tab') {
            out.push('\t');
          } else if (tag === 'w:br' || tag === 'w:cr') {
            out.push('\n');
          }
        },
        onclosetag(start, end) {
          const name = source.slice(start, end);
          if (name === 'w:t') {
            inText = false;
          } else if (name === 'w:p') {
            out.push('\n');
          }
        },
        ontext(start, end) {
          if (inText) {
            out.push(source.slice(start, end));
          }
        },
        ontextentity(codepoint) {
          if (inText) {
            out.push(String.fromCodePoint(codepoint));
          }
        },
        onattribname: (): void => undefined,
        onattribdata: (): void => undefined,
        onattribentity: (): void => undefined,
        onattribend: (): void => undefined,
        oncdata: (): void => undefined,
        oncomment: (): void => undefined,
        ondeclaration: (): void => undefined,
        onend: (): void => undefined,
        onprocessinginstruction: (): void => undefined,
      }
    );
    tokenizer.write(source);
    tokenizer.end();
    return out.join('').replace(/\n{3,}/g, '\n\n');
  }

  // === HTML ===

  /**
   * A page as Markdown-flavoured text: headings, list items and paragraphs on
   * their own lines, links as `[text](url)` and images as `![alt](url)` with
   * absolute URLs — the agent finds the project's logo in those, so they are
   * kept rather than stripped. Scripts, styles and other non-text content are
   * dropped. Built on htmlparser2's linear TOKENIZER, not a tree builder,
   * which hostile markup makes quadratic (see `event-links.helper.ts`).
   */
  private static htmlText(html: string, baseUrl?: string): { text: string; title: string | null } {
    const out: string[] = [];
    let tag = '';
    let attrName = '';
    let attrValue = '';
    let attrs: Record<string, string> = {};
    let skipDepth = 0;
    let inTitle = false;
    let title = '';
    let link: { start: number; href: string | null } | null = null;

    const absolute = (url: string | undefined): string | null => {
      if (!url) {
        return null;
      }
      try {
        const resolved = new URL(url.trim(), baseUrl);
        return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.href : null;
      } catch {
        return null;
      }
    };
    const text = (value: string): void => {
      if (inTitle) {
        title += value;
      } else if (skipDepth === 0) {
        out.push(value);
      }
    };
    const openTag = (selfClosing: boolean): void => {
      if (MktgDocumentText.skipTags.has(tag)) {
        skipDepth += selfClosing ? 0 : 1;
        return;
      }
      if (tag === 'title') {
        inTitle = !selfClosing;
        return;
      }
      if (skipDepth > 0) {
        return;
      }
      if (MktgDocumentText.blockTags.has(tag)) {
        out.push('\n');
      }
      if (/^h[1-6]$/.test(tag)) {
        out.push(`${'#'.repeat(Number(tag[1]))} `);
      } else if (tag === 'li') {
        out.push('- ');
      } else if (tag === 'img') {
        const src = absolute(attrs['src']);
        if (src) {
          out.push(` ![${(attrs['alt'] ?? '').replace(/[[\]\n]/g, ' ').trim()}](${src}) `);
        }
      } else if (tag === 'a' && !selfClosing) {
        link = { start: out.length, href: absolute(attrs['href']) };
      }
    };
    const closeTag = (name: string): void => {
      if (MktgDocumentText.skipTags.has(name)) {
        skipDepth = Math.max(0, skipDepth - 1);
        return;
      }
      if (name === 'title') {
        inTitle = false;
        return;
      }
      if (skipDepth > 0) {
        return;
      }
      if (name === 'a' && link !== null) {
        const label = out.splice(link.start).join('').replace(/\s+/g, ' ').trim();
        out.push(link.href && label ? `[${label.replace(/[[\]]/g, '')}](${link.href})` : label);
        link = null;
      }
      if (MktgDocumentText.blockTags.has(name)) {
        out.push('\n');
      }
    };

    const tokenizer = new Tokenizer(
      { xmlMode: false, decodeEntities: true },
      {
        onopentagname(start, end) {
          tag = html.slice(start, end).toLowerCase();
          attrs = {};
        },
        onattribname(start, end) {
          attrName = html.slice(start, end).toLowerCase();
          attrValue = '';
        },
        onattribdata(start, end) {
          attrValue += html.slice(start, end);
        },
        onattribentity(codepoint) {
          attrValue += String.fromCodePoint(codepoint);
        },
        onattribend() {
          if (!(attrName in attrs)) {
            attrs[attrName] = attrValue;
          }
        },
        onopentagend() {
          openTag(false);
        },
        onselfclosingtag() {
          openTag(true);
        },
        onclosetag(start, end) {
          closeTag(html.slice(start, end).toLowerCase());
        },
        ontext(start, end) {
          text(html.slice(start, end));
        },
        ontextentity(codepoint) {
          text(String.fromCodePoint(codepoint));
        },
        oncdata: (): void => undefined,
        oncomment: (): void => undefined,
        ondeclaration: (): void => undefined,
        onend: (): void => undefined,
        onprocessinginstruction: (): void => undefined,
      }
    );
    tokenizer.write(html);
    tokenizer.end();

    const body = out
      .join('')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
    return { text: body, title: title.replace(/\s+/g, ' ').trim() || null };
  }
}
