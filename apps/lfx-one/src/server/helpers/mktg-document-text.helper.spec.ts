// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { deflateRawSync, deflateSync } from 'node:zlib';
import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';

import { MktgDocumentText } from './mktg-document-text.helper';

/** A PDF written by pdfkit (compressed content streams, a standard font) with one paragraph per page. */
async function pdfkitPdf(pages: string[]): Promise<Buffer> {
  const doc = new PDFDocument({ autoFirstPage: false });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  for (const text of pages) {
    doc.addPage();
    doc.text(text);
  }
  doc.end();
  return done;
}

/**
 * A hand-built PDF whose font is Type0 / Identity-H with a ToUnicode CMap —
 * how Word and most office suites write text — so the two-byte codes only
 * mean something through the CMap. Its content stream is FlateDecode'd.
 */
function type0Pdf(): Buffer {
  const cmap = [
    'begincmap',
    '1 begincodespacerange <0000> <FFFF> endcodespacerange',
    '2 beginbfchar <0001> <0048> <0002> <0069> endbfchar',
    '1 beginbfrange <0010> <0012> <0061> endbfrange',
    'endcmap',
  ].join('\n');
  const content = deflateSync(Buffer.from('BT /F1 12 Tf 72 720 Td <00010002> Tj 0 -14 Td [<0010> -300 <00110012>] TJ ET', 'latin1'));
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n${content.toString('latin1')}\nendstream`,
    '<< /Type /Font /Subtype /Type0 /BaseFont /Fixture /Encoding /Identity-H /ToUnicode 6 0 R >>',
    `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`,
  ];
  const body = objects.map((object, index) => `${index + 1} 0 obj\n${object}\nendobj\n`).join('');
  return Buffer.from(`%PDF-1.7\n${body}trailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'latin1');
}

/** ASCII base-85 with the `<~ … ~>` frame, as ReportLab and pypdf write content streams (before FlateDecode). */
function ascii85(bytes: Buffer): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 4) {
    const chunk = Buffer.alloc(4);
    bytes.copy(chunk, 0, i, i + 4);
    let value = chunk.readUInt32BE(0);
    const digits: string[] = [];
    for (let d = 0; d < 5; d++) {
      digits.unshift(String.fromCharCode((value % 85) + 33));
      value = Math.floor(value / 85);
    }
    out += digits.slice(0, Math.min(4, bytes.length - i) + 1).join('');
  }
  return `<~${out}~>`;
}

/** A one-page PDF with a standard Type1 font whose content stream is ASCII85- then Flate-encoded. */
function ascii85Pdf(text: string): Buffer {
  const content = ascii85(deflateSync(Buffer.from(`BT /F1 12 Tf 72 720 Td (${text}) Tj ET`, 'latin1')));
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} /Filter [/ASCII85Decode /FlateDecode] >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  const body = objects.map((object, index) => `${index + 1} 0 obj\n${object}\nendobj\n`).join('');
  return Buffer.from(`%PDF-1.4\n${body}trailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'latin1');
}

/** A minimal .docx: a zip holding only word/document.xml (or `entryName`), deflated. CRCs are not checked by the reader, so they are zero. */
function docx(documentXml: string, entryName = 'word/document.xml'): Buffer {
  const name = Buffer.from(entryName, 'utf8');
  const raw = Buffer.from(documentXml, 'utf8');
  const data = deflateRawSync(raw);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const centralOffset = local.length + name.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

describe('MktgDocumentText.read — PDF', () => {
  it('reads the text of a pdfkit PDF, page by page', async () => {
    const pdf = await pdfkitPdf(['OpenSearch messaging note: vision first.', 'Second page — pillars and proof points.']);

    const read = MktgDocumentText.read(pdf, { fileName: 'note.pdf' });

    expect(read.reason).toBeUndefined();
    expect(read.text).toContain('OpenSearch messaging note: vision first.');
    expect(read.text).toContain('Second page — pillars and proof points.');
  });

  it('reads Type0 fonts through their ToUnicode CMap (bfchar and bfrange), with kerning gaps as spaces', () => {
    expect(MktgDocumentText.read(type0Pdf(), { fileName: 'word-export.pdf' }).text).toBe('Hi\na bc');
  });

  it('decodes ASCII85 content streams, as ReportLab and pypdf write them, and finds a header after leading junk', () => {
    expect(MktgDocumentText.read(ascii85Pdf('Pillars, proof points (2026)'), { fileName: 'report.pdf' }).text).toBe('Pillars, proof points (2026)');
    expect(MktgDocumentText.read(Buffer.concat([Buffer.from('\r\n'.repeat(60)), ascii85Pdf('Late header')]), {}).text).toBe('Late header');
  });

  it('refuses an encrypted PDF instead of returning ciphertext', () => {
    const encrypted = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt 9 0 R >>\n%%EOF', 'latin1');

    expect(MktgDocumentText.read(encrypted, { fileName: 'locked.pdf' })).toEqual({ text: null, title: null, truncated: false, reason: 'encrypted' });
  });

  it('reports no text for a PDF with nothing to read (a scan)', () => {
    const empty = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] >>\nendobj\n%%EOF', 'latin1');

    expect(MktgDocumentText.read(empty, { fileName: 'scan.pdf' }).reason).toBe('no-text');
  });
});

describe('MktgDocumentText.read — Word, HTML and text', () => {
  it('reads a .docx body: one line per paragraph, tabs and breaks kept, entities decoded', () => {
    const xml =
      '<?xml version="1.0"?><w:document xmlns:w="w"><w:body>' +
      '<w:p><w:r><w:t>Vision &amp; mission</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">Pillar </w:t></w:r><w:r><w:tab/><w:t>one</w:t><w:br/><w:t>two</w:t></w:r></w:p>' +
      '</w:body></w:document>';

    expect(MktgDocumentText.read(docx(xml), { fileName: 'brief.docx' }).text).toBe('Vision & mission\nPillar \tone\ntwo');
  });

  it('refuses a zip that is not a Word document', () => {
    const notWord = docx('<x/>', 'ppt/presentation.xml');

    expect(MktgDocumentText.read(notWord, { fileName: 'deck.pptx' }).reason).toBe('unsupported');
  });

  it('turns a page into Markdown-flavoured text, keeping absolute link and image URLs and dropping scripts', () => {
    const html =
      '<!doctype html><html><head><title>Example Search — Home</title><style>h1{}</style></head><body>' +
      '<header><img src="/logo.svg" alt="Example Search"></header><script>var x = 1;</script>' +
      '<h1>Search, in the open</h1><p>Read the <a href="docs/start">getting started guide</a>.</p>' +
      '<ul><li>Fast</li><li>Open</li></ul></body></html>';

    const read = MktgDocumentText.read(Buffer.from(html, 'utf8'), { contentType: 'text/html; charset=utf-8', baseUrl: 'https://search.example.org/en/' });

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

  it('keeps Markdown and plain text as written, and refuses binary data', () => {
    expect(MktgDocumentText.read(Buffer.from('﻿# Notes\r\n\r\nKeep <b>this</b>.', 'utf8'), { fileName: 'notes.md' }).text).toBe('# Notes\n\nKeep <b>this</b>.');
    expect(MktgDocumentText.read(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]), { fileName: 'logo.txt' }).reason).toBe('unsupported');
  });
});
