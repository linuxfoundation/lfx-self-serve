// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { PdfTextReader } from './mktg-pdf-text.helper';

/**
 * The reader runs on the BFF's event loop for any signed-in user's upload,
 * link or source URL, so a crafted PDF must cost time in proportion to its
 * size and stop at the work budget. Every input here took seconds to hours
 * before the bounds (bfrange expansion, object rescans, unclosed blocks,
 * stack depth, repeated Form XObjects); the time limits are far above what
 * the bounded reader needs, and far below what the unbounded one took.
 */

/** A PDF from object bodies, numbered from 1, with the catalog first. */
function pdf(objects: string[]): Buffer {
  const body = objects.map((object, index) => `${index + 1} 0 obj\n${object}\nendobj\n`).join('');
  return Buffer.from(`%PDF-1.7\n${body}trailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'latin1');
}

function stream(data: string, compress = false): string {
  const body = compress ? deflateSync(Buffer.from(data, 'latin1')).toString('latin1') : data;
  return `<< /Length ${body.length}${compress ? ' /Filter /FlateDecode' : ''} >>\nstream\n${body}\nendstream`;
}

/** One page showing `shown` (hex codes) in a Type0 font whose ToUnicode CMap is `cmap`. */
function cmapPdf(cmap: string, shown: string, compress = false): Buffer {
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    stream(`BT /F1 12 Tf 72 720 Td <${shown}> Tj ET`),
    '<< /Type /Font /Subtype /Type0 /BaseFont /Fixture /Encoding /Identity-H /ToUnicode 6 0 R >>',
    stream(`1 begincodespacerange <0000> <FFFF> endcodespacerange\n${cmap}`, compress),
  ]);
}

function timed<T>(read: () => T): { result: T; ms: number } {
  const start = performance.now();
  const result = read();
  return { result, ms: performance.now() - start };
}

describe('PdfTextReader — bounded work on hostile input', () => {
  it('caps bfrange expansion across the whole PDF, keeping the mappings that came first', () => {
    // 2,000 full-plane ranges after a real one: unbounded, 131 million map entries (about 35 s).
    const junk = '<0100> <FFFF> <0100>\n'.repeat(2000);
    const { result, ms } = timed(() => PdfTextReader.read(cmapPdf(`2001 beginbfrange\n<0041> <005A> <0041>\n${junk}endbfrange`, '004100420043')));

    expect(result).toEqual({ text: 'ABC' });
    expect(ms).toBeLessThan(2000);
  });

  it('expands a deflated CMap of millions of ranges in bounded time', () => {
    const cmap = `beginbfrange\n${'<0000> <FFFF> <0041>\n'.repeat(1_000_000)}endbfrange`;
    const { ms } = timed(() => PdfTextReader.read(cmapPdf(cmap, '0001', true)));

    expect(ms).toBeLessThan(3000);
  });

  it('maps an array bfrange only as far as its array lists', () => {
    const { result } = timed(() => PdfTextReader.read(cmapPdf('1 beginbfrange\n<0001> <FFFF> [<0048> <0069>]\nendbfrange', '000100020003')));

    expect(result).toEqual({ text: 'Hi' });
  });

  it('scans past an unterminated string once, instead of re-parsing every object header inside it', () => {
    // Unbounded: quadratic, about 27 s at this size.
    const { result, ms } = timed(() => PdfTextReader.read(Buffer.from(`%PDF-1.7\n${'1 0 obj ('.repeat(40_000)}`, 'latin1')));

    expect(result).toEqual({ reason: 'no-text' });
    expect(ms).toBeLessThan(1000);
  });

  it('does not retry a long digit run at every offset, or rescan for an endstream that is not there', () => {
    const digits = timed(() => PdfTextReader.read(Buffer.from(`%PDF-1.7\n${'1'.repeat(200_000)}`, 'latin1')));
    const noEnd = timed(() => PdfTextReader.read(Buffer.from(`%PDF-1.7\n${'1 0 obj<</Length 9>>stream\n'.repeat(40_000)}`, 'latin1')));

    expect(digits.ms).toBeLessThan(1000);
    expect(noEnd.ms).toBeLessThan(1000);
  });

  it('finds CMap blocks and array ranges in linear time when they are never closed', () => {
    const unclosedBlocks = timed(() => PdfTextReader.read(cmapPdf(`${'beginbfrange '.repeat(20_000)}${'x'.repeat(200_000)}`, '0001')));
    const unclosedArrays = timed(() => PdfTextReader.read(cmapPdf(`beginbfrange\n${'<0><0>['.repeat(40_000)}\nendbfrange`, '0001')));

    expect(unclosedBlocks.ms).toBeLessThan(1000);
    expect(unclosedArrays.ms).toBeLessThan(1000);
  });

  it('reads deeply nested arrays without overflowing the stack (never throws)', () => {
    expect(() => PdfTextReader.read(Buffer.from(`%PDF-1.7\n1 0 obj ${'['.repeat(200_000)}`, 'latin1'))).not.toThrow();
    expect(PdfTextReader.read(Buffer.from(`%PDF-1.7\n1 0 obj ${'<<'.repeat(200_000)}`, 'latin1'))).toEqual({ reason: 'no-text' });
  });

  it('stops a Form XObject fan-out at the work budget and reports the PDF as too complex', () => {
    // Each level draws the next 1,000 times, four levels deep: 10^12 draws unbounded.
    const forms = [0, 1, 2, 3].map((level) =>
      stream(level === 3 ? 'BT /F1 12 Tf (hello) Tj ET' : '/X Do '.repeat(1000)).replace(
        '<< ',
        `<< /Type /XObject /Subtype /Form /Resources << /XObject << /X ${level + 5} 0 R >> /Font << /F1 9 0 R >> >> `
      )
    );
    const fanOut = pdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /Resources << /XObject << /X 5 0 R >> >> /Contents 4 0 R >>',
      stream('/X Do '.repeat(1000)),
      ...forms,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    ]);

    const { result, ms } = timed(() => PdfTextReader.read(fanOut));

    expect(result).toEqual({ reason: 'too-complex' });
    // The unit budget stops it in about 2 s; the wall-clock backstop is 5 s.
    expect(ms).toBeLessThan(8000);
  }, 20_000);
});
