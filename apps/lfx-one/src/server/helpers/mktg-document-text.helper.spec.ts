// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import mammoth from 'mammoth';
import { describe, expect, it, vi } from 'vitest';

import { MktgDocumentText } from './mktg-document-text.helper';

/** A real file from `__fixtures__`: a PDF printed by macOS Quartz, a .docx written by TextEdit. */
function fixture(name: string): Buffer {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url));
}

/** A PDF written by pdfkit with one paragraph per page (none for an empty page), optionally password-protected. */
async function pdfkitPdf(pages: string[], userPassword?: string): Promise<Buffer> {
  const doc = new PDFDocument({ autoFirstPage: false, ...(userPassword ? { userPassword, pdfVersion: '1.7' as const } : {}) });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  for (const text of pages) {
    doc.addPage();
    if (text) {
      doc.text(text);
    }
  }
  doc.end();
  return done;
}

/** A zip of the given entries, deflated. */
async function zip(entries: Record<string, string | Buffer>): Promise<Buffer> {
  const archive = new JSZip();
  for (const [name, content] of Object.entries(entries)) {
    archive.file(name, content);
  }
  return archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}

/** A minimal .docx whose main document (at `mainPath`) holds `paragraphs` short paragraphs, plus any `extra` parts. */
async function wordZip(paragraphs: number, extra: Record<string, string | Buffer> = {}, mainPath = 'word/document.xml'): Promise<Buffer> {
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const rels =
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" ' +
    `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${mainPath}"/></Relationships>`;
  const body = '<w:p><w:r><w:t>Pillar</w:t></w:r></w:p>'.repeat(paragraphs);
  return zip({ '_rels/.rels': rels, [mainPath]: `<w:document xmlns:w="${w}"><w:body>${body}</w:body></w:document>`, ...extra });
}

describe('MktgDocumentText.read — PDF', () => {
  it('reads a real PDF, one line per line, and finds its header after leading junk', async () => {
    const note = fixture('mktg-document-note.pdf');
    const expected = 'Example Search messaging note\nVision: search, in the open.\nPillars: fast, open, trusted.';

    expect(await MktgDocumentText.read(note, { fileName: 'note.pdf' })).toEqual({ text: expected, title: null, truncated: false });
    expect((await MktgDocumentText.read(Buffer.concat([Buffer.from('\r\n'.repeat(60)), note]), {})).text).toBe(expected);
  });

  it('reads every page, a blank line between two', async () => {
    const pdf = await pdfkitPdf(['OpenSearch messaging note: vision first.', 'Second page — pillars and proof points.']);

    expect((await MktgDocumentText.read(pdf, { fileName: 'note.pdf' })).text).toBe(
      'OpenSearch messaging note: vision first.\n\nSecond page — pillars and proof points.'
    );
  });

  it('refuses a password-protected PDF as encrypted, and reports no text for one with nothing to read (a scan)', async () => {
    expect(await MktgDocumentText.read(await pdfkitPdf(['Secret pillars'], 'secret'), { fileName: 'locked.pdf' })).toEqual({
      text: null,
      title: null,
      truncated: false,
      reason: 'encrypted',
    });
    expect((await MktgDocumentText.read(await pdfkitPdf(['']), { fileName: 'scan.pdf' })).reason).toBe('no-text');
  });

  it('reports a corrupt PDF as too complex, whose message asks for a fresh export', async () => {
    const corrupt = Buffer.concat([fixture('mktg-document-note.pdf').subarray(0, 600), Buffer.from('garbage')]);

    expect((await MktgDocumentText.read(corrupt, { fileName: 'broken.pdf' })).reason).toBe('too-complex');
    expect((await MktgDocumentText.read(Buffer.from('not a pdf at all'), { contentType: 'application/pdf' })).reason).toBe('too-complex');
  });

  it('refuses a PDF over the page cap before reading a page, and stops one at the deadline', async () => {
    const tooLong = await pdfkitPdf(Array.from({ length: 301 }, (_, page) => `Page ${page + 1}`));
    const slow = await pdfkitPdf(Array.from({ length: 200 }, () => 'lorem ipsum dolor sit amet '.repeat(120)));

    expect((await MktgDocumentText.read(tooLong, { fileName: 'long.pdf' })).reason).toBe('too-complex');
    const start = performance.now();
    expect((await MktgDocumentText.read(slow, { fileName: 'slow.pdf' }, 1)).reason).toBe('too-complex');
    expect(performance.now() - start).toBeLessThan(1000);
  }, 20_000);
});

describe('MktgDocumentText.read — Word, HTML and text', () => {
  it('reads a real .docx body, a blank line between paragraphs, tabs kept', async () => {
    const read = await MktgDocumentText.read(fixture('mktg-document-brief.docx'), { fileName: 'brief.docx' });

    expect(read).toEqual({ text: 'Example Search positioning brief\n\nVision & mission\n\nPillar\tone', title: null, truncated: false });
  });

  it('refuses a corrupt zip, and a zip that is not a Word document', async () => {
    const corrupt = Buffer.concat([Buffer.from('PK\u0003\u0004', 'latin1'), Buffer.from('garbage')]);
    const notWord = await zip({ 'ppt/presentation.xml': '<p:presentation/>' });

    expect((await MktgDocumentText.read(corrupt, { fileName: 'brief.docx' })).reason).toBe('unsupported');
    expect((await MktgDocumentText.read(notWord, { fileName: 'deck.pptx' })).reason).toBe('unsupported');
  });

  it('refuses a .docx whose markup inflates past the cap (a compression bomb) before mammoth reads it', async () => {
    const parse = vi.spyOn(mammoth, 'extractRawText');
    const bomb = await zip({ 'word/document.xml': `<w:document>${' '.repeat(40 * 1024 * 1024)}</w:document>` });
    const tooLong = await wordZip(60_000);

    expect(bomb.length).toBeLessThan(1024 * 1024);
    expect((await MktgDocumentText.read(bomb, { fileName: 'bomb.docx' })).reason).toBe('too-complex');
    expect((await MktgDocumentText.read(tooLong, { fileName: 'long.docx' })).reason).toBe('too-complex');
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  }, 20_000);

  it('never inflates the parts it does not parse: a bomb among the images costs nothing, a main document hidden in one is not read', async () => {
    const imageBomb = await wordZip(3, { 'word/media/image1.png': Buffer.alloc(40 * 1024 * 1024) });
    const hidden = await wordZip(3, {}, 'word/media/image1.png');

    expect((await MktgDocumentText.read(imageBomb, { fileName: 'brief.docx' })).text).toBe('Pillar\n\nPillar\n\nPillar');
    expect((await MktgDocumentText.read(hidden, { fileName: 'brief.docx' })).reason).toBe('unsupported');
  }, 20_000);

  it('reads a .docx just under the markup cap within the deadline, and stops one at a spent deadline before mammoth starts', async () => {
    const nearCap = await wordZip(45_000);
    const parse = vi.spyOn(mammoth, 'extractRawText');

    const start = performance.now();
    const read = await MktgDocumentText.read(nearCap, { fileName: 'long.docx' });
    expect(performance.now() - start).toBeLessThan(MktgDocumentText.maxDocxMillis + 1000);
    expect(read.text === null ? read.reason : 'read').toMatch(/^(read|too-complex)$/);

    parse.mockClear();
    expect((await MktgDocumentText.read(nearCap, { fileName: 'long.docx' }, 1)).reason).toBe('too-complex');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  }, 20_000);

  it('turns a page into Markdown-flavoured text, keeping absolute link and image URLs and dropping scripts', async () => {
    const html =
      '<!doctype html><html><head><title>Example Search — Home</title><style>h1{}</style></head><body>' +
      '<header><img src="/logo.svg" alt="Example Search"></header><script>var x = 1;</script>' +
      '<h1>Search, in the open</h1><p>Read the <a href="docs/start">getting started guide</a>.</p>' +
      '<ul><li>Fast</li><li>Open</li></ul></body></html>';

    const read = await MktgDocumentText.read(Buffer.from(html, 'utf8'), { contentType: 'text/html; charset=utf-8', baseUrl: 'https://search.example.org/en/' });

    expect(read.title).toBe('Example Search — Home');
    expect(read.text).toBe(
      [
        '![Example Search](https://search.example.org/logo.svg)',
        '',
        '# Search, in the open',
        '',
        'Read the [getting started guide](https://search.example.org/en/docs/start).',
        '',
        '- Fast',
        '',
        '- Open',
      ].join('\n')
    );
  });

  it('keeps Markdown and plain text as written, and refuses binary data', async () => {
    expect((await MktgDocumentText.read(Buffer.from('﻿# Notes\r\n\r\nKeep <b>this</b>.', 'utf8'), { fileName: 'notes.md' })).text).toBe(
      '# Notes\n\nKeep <b>this</b>.'
    );
    expect((await MktgDocumentText.read(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]), { fileName: 'logo.txt' })).reason).toBe('unsupported');
  });
});
