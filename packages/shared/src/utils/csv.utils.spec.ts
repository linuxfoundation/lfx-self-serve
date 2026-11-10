// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { buildCsv, escapeCsvCell, neutralizeCsvFormula } from './csv.utils';

describe('neutralizeCsvFormula', () => {
  it.each(['=SUM(A1)', '+1', '-1', '@cmd', '\tx', '\rx'])('prefixes %j with an apostrophe', (value) => {
    expect(neutralizeCsvFormula(value)).toBe(`'${value}`);
  });

  it('leaves ordinary text alone', () => {
    expect(neutralizeCsvFormula('Acme - Labs')).toBe('Acme - Labs');
  });
});

describe('escapeCsvCell', () => {
  it('renders null and undefined as empty', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });

  it('quotes cells with commas, quotes or newlines and doubles quotes', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('a\nb')).toBe('"a\nb"');
  });

  it('neutralizes a formula before quoting', () => {
    expect(escapeCsvCell('=1,2')).toBe('"\'=1,2"');
  });
});

describe('buildCsv', () => {
  it('joins header and rows with CRLF', () => {
    expect(
      buildCsv(
        ['A', 'B'],
        [
          ['1', 2],
          [null, 'x,y'],
        ]
      )
    ).toBe('A,B\r\n1,2\r\n,"x,y"');
  });
});
