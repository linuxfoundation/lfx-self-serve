// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
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

/** A one-page PDF whose single content stream inflates to `inflatedBytes` of `q Q` operators: a few dozen kilobytes on disk. */
function heavyStreamPdf(inflatedBytes: number): Buffer {
  const stream = deflateSync(Buffer.alloc(inflatedBytes, 'q Q\n'));
  return Buffer.concat([
    Buffer.from(
      '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n' +
        '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj\n' +
        `4 0 obj << /Length ${stream.length} /Filter /FlateDecode >> stream\n`,
      'latin1'
    ),
    stream,
    Buffer.from('\nendstream endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1'),
  ]);
}

/** The longest the event loop went without running a timer while `work` ran. */
async function longestStall(work: () => Promise<unknown>): Promise<number> {
  let last = performance.now();
  let longest = 0;
  const ticker = setInterval(() => {
    longest = Math.max(longest, performance.now() - last);
    last = performance.now();
  }, 5);
  await work();
  clearInterval(ticker);
  return Math.max(longest, performance.now() - last);
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

    expect(await MktgDocumentText.read(note)).toEqual({ text: expected, truncated: false });
    expect((await MktgDocumentText.read(Buffer.concat([Buffer.from('\r\n'.repeat(60)), note]))).text).toBe(expected);
  });

  it('reads every page, a blank line between two', async () => {
    const pdf = await pdfkitPdf(['OpenSearch messaging note: vision first.', 'Second page — pillars and proof points.']);

    expect((await MktgDocumentText.read(pdf)).text).toBe('OpenSearch messaging note: vision first.\n\nSecond page — pillars and proof points.');
  });

  it('refuses a password-protected PDF as encrypted, and reports no text for one with nothing to read (a scan)', async () => {
    expect(await MktgDocumentText.read(await pdfkitPdf(['Secret pillars'], 'secret'))).toEqual({
      text: null,
      truncated: false,
      reason: 'encrypted',
    });
    expect((await MktgDocumentText.read(await pdfkitPdf(['']))).reason).toBe('no-text');
  });

  it('reports a corrupt PDF as too complex, whose message asks for a fresh export', async () => {
    const corrupt = Buffer.concat([fixture('mktg-document-note.pdf').subarray(0, 600), Buffer.from('garbage')]);

    expect((await MktgDocumentText.read(corrupt)).reason).toBe('too-complex');
  });

  it('refuses a PDF over the page cap before reading a page, and stops one at the deadline', async () => {
    const tooLong = await pdfkitPdf(Array.from({ length: 301 }, (_, page) => `Page ${page + 1}`));
    const slow = await pdfkitPdf(Array.from({ length: 200 }, () => 'lorem ipsum dolor sit amet '.repeat(120)));

    expect((await MktgDocumentText.read(tooLong)).reason).toBe('too-complex');
    const start = performance.now();
    expect((await MktgDocumentText.read(slow, 1)).reason).toBe('too-complex');
    expect(performance.now() - start).toBeLessThan(1000);
  }, 20_000);

  it('stops a small PDF with one huge compressed content stream at the deadline, the event loop running throughout', async () => {
    const heavy = heavyStreamPdf(40 * 1024 * 1024);
    let read: Awaited<ReturnType<typeof MktgDocumentText.read>> | undefined;

    expect(heavy.length).toBeLessThan(200 * 1024);
    // A caller's tighter budget: inflating the stream takes seconds, so the default would let it finish (to no text).
    const stall = await longestStall(async () => {
      read = await MktgDocumentText.read(heavy, 200);
    });
    expect(read?.reason).toBe('too-complex');
    expect(stall).toBeLessThan(300);
  }, 20_000);
});

describe('MktgDocumentText.read — Word and text', () => {
  it('reads a real .docx body, a blank line between paragraphs, tabs kept', async () => {
    const read = await MktgDocumentText.read(fixture('mktg-document-brief.docx'));

    expect(read).toEqual({ text: 'Example Search positioning brief\n\nVision & mission\n\nPillar\tone', truncated: false });
  });

  it('refuses a corrupt zip, and a zip that is neither a Word nor a PowerPoint document', async () => {
    const corrupt = Buffer.concat([Buffer.from('PK\u0003\u0004', 'latin1'), Buffer.from('garbage')]);
    const notOffice = await zip({ 'xl/workbook.xml': '<workbook/>' });

    expect((await MktgDocumentText.read(corrupt)).reason).toBe('unsupported');
    expect((await MktgDocumentText.read(notOffice)).reason).toBe('unsupported');
  });

  it('reads a .pptx slide by slide, in slide order, a line per paragraph, entities decoded; a deck with no text has none', async () => {
    const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const slide = (paragraphs: string[][]): string =>
      `<p:sld xmlns:a="${a}"><p:cSld><p:spTree><p:sp><p:txBody>${paragraphs
        .map((runs) => `<a:p>${runs.map((run) => `<a:r><a:rPr lang="en-US"/><a:t>${run}</a:t></a:r>`).join('')}</a:p>`)
        .join('')}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
    const deck = await zip({
      'ppt/presentation.xml': '<p:presentation/>',
      'ppt/slides/slide10.xml': slide([['Ten']]),
      'ppt/slides/slide2.xml': slide([['Members ', '&amp; partners'], ['']]),
      'ppt/slides/slide1.xml': slide([['Example Search'], ['Open', ' search, &#8220;for all&#8221;']]),
      'ppt/notesSlides/notesSlide1.xml': slide([['Speaker notes stay out']]),
      'ppt/media/image1.png': Buffer.alloc(16),
    });
    const empty = await zip({ 'ppt/presentation.xml': '<p:presentation/>', 'ppt/slides/slide1.xml': slide([['  ']]) });

    expect(await MktgDocumentText.read(deck)).toEqual({ text: 'Example Search\nOpen search, “for all”\n\nMembers & partners\n\nTen', truncated: false });
    expect((await MktgDocumentText.read(empty)).reason).toBe('no-text');
  });

  it('reads a .pptx in presentation order, not by slide file name, and leaves out slide parts the deck does not list', async () => {
    const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const slide = (text: string): string =>
      `<p:sld xmlns:a="${a}"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
    // Slide 3 was moved to the front: the slide list changed, the part names did not; slide 4 was dropped from the list.
    const deck = await zip({
      'ppt/presentation.xml':
        '<p:presentation xmlns:r="r"><p:sldIdLst><p:sldId id="258" r:id="rId9"/><p:sldId id="256" r:id="rId7"/><p:sldId r:id="rId8" id="257"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels':
        '<Relationships><Relationship Id="rId7" Type="slide" Target="slides/slide1.xml"/><Relationship Target="slides/slide2.xml" Id="rId8" Type="slide"/><Relationship Id="rId9" Type="slide" Target="/ppt/slides/slide3.xml"/><Relationship Id="rId1" Type="slideMaster" Target="slideMasters/slideMaster1.xml"/></Relationships>',
      'ppt/slides/slide1.xml': slide('One'),
      'ppt/slides/slide2.xml': slide('Two'),
      'ppt/slides/slide3.xml': slide('Three, moved first'),
      'ppt/slides/slide4.xml': slide('Hidden from the list'),
    });

    expect(await MktgDocumentText.read(deck)).toEqual({ text: 'Three, moved first\n\nOne\n\nTwo', truncated: false });
  });

  it('reads a .pptx soft line break (<a:br/>) as a new line, not a join of the two lines', async () => {
    const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const run = (text: string): string => `<a:r><a:rPr lang="en-US"/><a:t>${text}</a:t></a:r>`;
    const deck = await zip({
      'ppt/presentation.xml': '<p:presentation/>',
      'ppt/slides/slide1.xml': `<p:sld xmlns:a="${a}"><p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:p>${run('Revenue: ')}${run(
        '$1m'
      )}<a:br><a:rPr lang="en-US"/></a:br>${run('Pipeline: $2m')}<a:br/></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    });

    expect(await MktgDocumentText.read(deck)).toEqual({ text: 'Revenue: $1m\nPipeline: $2m', truncated: false });
  });

  it('refuses a .docx whose markup inflates past the cap (a compression bomb) before mammoth reads it', async () => {
    const parse = vi.spyOn(mammoth, 'extractRawText');
    const bomb = await zip({ 'word/document.xml': `<w:document>${' '.repeat(40 * 1024 * 1024)}</w:document>` });
    const tooLong = await wordZip(60_000);

    expect(bomb.length).toBeLessThan(1024 * 1024);
    expect((await MktgDocumentText.read(bomb)).reason).toBe('too-complex');
    expect((await MktgDocumentText.read(tooLong)).reason).toBe('too-complex');
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  }, 20_000);

  it('refuses a .docx listing more parts than any Word file has before JSZip reads it, within the deadline', async () => {
    const load = vi.spyOn(JSZip, 'loadAsync');
    const parse = vi.spyOn(mammoth, 'extractRawText');
    const manyParts = await wordZip(3, Object.fromEntries(Array.from({ length: 1_500 }, (_, part) => [`word/empty${part}.xml`, ''])));

    const start = performance.now();
    expect((await MktgDocumentText.read(manyParts)).reason).toBe('too-complex');
    expect(performance.now() - start).toBeLessThan(MktgDocumentText.maxDocxMillis);
    expect(load).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
    load.mockRestore();
    parse.mockRestore();
  });

  it('never inflates the parts it does not parse: a bomb among the images costs nothing, a main document hidden in one is not read', async () => {
    const imageBomb = await wordZip(3, { 'word/media/image1.png': Buffer.alloc(40 * 1024 * 1024) });
    const hidden = await wordZip(3, {}, 'word/media/image1.png');

    expect((await MktgDocumentText.read(imageBomb)).text).toBe('Pillar\n\nPillar\n\nPillar');
    expect((await MktgDocumentText.read(hidden)).reason).toBe('unsupported');
  }, 20_000);

  it('reads a .docx just under the markup cap within the deadline, and stops one at a spent deadline before mammoth starts', async () => {
    const nearCap = await wordZip(45_000);
    const parse = vi.spyOn(mammoth, 'extractRawText');

    const start = performance.now();
    const read = await MktgDocumentText.read(nearCap);
    // A loose bound: the deadline is what stops a hostile file, and a shared CI runner can take
    // a second or more just to load the parsers, so only a hang fails here.
    expect(performance.now() - start).toBeLessThan(MktgDocumentText.maxDocxMillis + 10_000);
    expect(read.text === null ? read.reason : 'read').toMatch(/^(read|too-complex)$/);

    parse.mockClear();
    expect((await MktgDocumentText.read(nearCap, 1)).reason).toBe('too-complex');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  }, 20_000);

  it('keeps Markdown and plain text as written, and refuses binary data', async () => {
    expect((await MktgDocumentText.read(Buffer.from('﻿# Notes\r\n\r\nKeep <b>this</b>.', 'utf8'))).text).toBe('# Notes\n\nKeep <b>this</b>.');
    expect((await MktgDocumentText.read(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))).reason).toBe('unsupported');
  });

  it('reads bytes only: a body another parser left as a string or an array is unsupported, not searched', async () => {
    expect((await MktgDocumentText.read('%PDF-1.4' as unknown as Buffer)).reason).toBe('unsupported');
    expect((await MktgDocumentText.read(['PK\u0003\u0004'] as unknown as Buffer)).reason).toBe('unsupported');
  });
});
