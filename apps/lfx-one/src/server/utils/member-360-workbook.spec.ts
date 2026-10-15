// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MEMBER_360_MAX_TRACKER_COLUMNS, MEMBER_360_MAX_TRACKER_ROWS } from '@lfx-one/shared/constants';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';

import { member360Fixture } from '../../../e2e/fixtures/mock-data/member-360.mock';
import { SYNTHETIC_ORG_NAME, SYNTHETIC_ORG_LEGAL_NAME, SYNTHETIC_SECOND_ORG_LEGAL_NAME } from '../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { buildMember360Workbook, member360TrackerFromRows, parseMember360Csv, parseMember360Xlsx } from './member-360-workbook.util';

describe('Member 360 workbook and tracker round trips', () => {
  it('parses CSV quoting, BOM, CRLF, embedded newlines and empty cells', () => {
    const rows = parseMember360Csv(`\uFEFFcompany,note\r\n"${SYNTHETIC_ORG_LEGAL_NAME}","a\n""quoted"""\r\n"${SYNTHETIC_SECOND_ORG_LEGAL_NAME}",\r\n`);
    expect(member360TrackerFromRows('tracker.csv', rows).rows).toEqual([
      { company: SYNTHETIC_ORG_LEGAL_NAME, note: 'a\n"quoted"' },
      { company: SYNTHETIC_SECOND_ORG_LEGAL_NAME, note: '' },
    ]);
  });
  it.each(['a,b\n"unclosed', 'a,b\n"closed"suffix,c', 'a,b\nmis"quoted,c'])('rejects malformed CSV', (text) => {
    expect(() => parseMember360Csv(text)).toThrow();
  });
  it('does not silently lose ambiguous headers, extra cells or excess rows', () => {
    for (const rows of [
      [
        ['company', 'company'],
        ['a', 'b'],
      ],
      [[''], ['a']],
      [['company'], ['a', 'b']],
      [['company'], ...Array.from({ length: MEMBER_360_MAX_TRACKER_ROWS + 1 }, () => ['a'])],
    ]) {
      expect(() => member360TrackerFromRows('tracker.csv', rows)).toThrow();
    }
  });
  it('uses the shared column cap for parsed tracker headers', () => {
    const headers = Array.from({ length: MEMBER_360_MAX_TRACKER_COLUMNS + 1 }, (_, index) => `column-${index}`);
    expect(() => member360TrackerFromRows('tracker.csv', [headers, ['value']])).toThrow(`at most ${MEMBER_360_MAX_TRACKER_COLUMNS}`);
  });
  it('reads XLSX cells as text and refuses silently skipping extra sheets', async () => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet('Tracker').addRows([
      ['company', 'count'],
      [SYNTHETIC_ORG_NAME, 3],
    ]);
    const bytes = new Uint8Array(await book.xlsx.writeBuffer()).buffer;
    expect((await parseMember360Xlsx('tracker.xlsx', bytes)).rows).toEqual([{ company: SYNTHETIC_ORG_NAME, count: '3' }]);
    book.addWorksheet('Another tracker');
    await expect(parseMember360Xlsx('tracker.xlsx', new Uint8Array(await book.xlsx.writeBuffer()).buffer)).rejects.toThrow('one tracker sheet');
  });
  it('rejects compressed trackers whose actual expansion exceeds the byte cap', async () => {
    const zip = new JSZip();
    zip.file('oversized.xml', 'x'.repeat(6 * 1024 * 1024));
    const bytes = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
    await expect(parseMember360Xlsx('tracker.xlsx', bytes)).rejects.toThrow('expanded tracker');
  });
  it('produces identical bytes from the same tabs regardless of download or envelope time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
      const first = await buildMember360Workbook(member360Fixture());
      vi.setSystemTime(new Date('2026-10-03T15:00:00Z'));
      const sameTabs = { ...member360Fixture(), generated_at: '2026-10-04T18:00:00.000Z' };
      expect(new Uint8Array(await buildMember360Workbook(sameTabs))).toEqual(new Uint8Array(first));
    } finally {
      vi.useRealTimers();
    }
  });
  it('exports empty evidence as a valid header-only sheet without an empty table definition', async () => {
    const envelope = member360Fixture();
    envelope.tabs.evidence = [];
    const bytes = await buildMember360Workbook(envelope);
    const output = new ExcelJS.Workbook();
    await output.xlsx.load(bytes);
    const evidence = output.getWorksheet('Evidence');
    expect(evidence?.getTables()).toHaveLength(0);
    expect(evidence?.rowCount).toBe(1);
    expect(evidence?.getCell('A1').value).toBe('Member');
    const zip = await JSZip.loadAsync(bytes);
    expect(await zip.file('xl/worksheets/sheet5.xml')?.async('string')).not.toContain('<tableParts');
  });
  it('writes six sheets with 21 contact-free ranking columns, sorted scores and frozen headers', async () => {
    const envelope = member360Fixture();
    envelope.tabs.member_ranking[0].key_contact = 'contact@example.test';
    const output = new ExcelJS.Workbook();
    await output.xlsx.load(await buildMember360Workbook(envelope));
    expect(output.worksheets.map((sheet) => sheet.name)).toEqual(['Summary', 'Member Ranking', 'Category Detail', 'Actions by Team', 'Evidence', 'Method']);
    const ranking = output.getWorksheet('Member Ranking')!;
    expect(ranking.columnCount).toBe(21);
    expect(ranking.getRow(1).values).not.toContain('Key Contact');
    expect(JSON.stringify(ranking.model)).not.toContain('contact@example.test');
    expect(ranking.getCell('B2').text).toBe(SYNTHETIC_SECOND_ORG_LEGAL_NAME);
    expect(ranking.getCell('G2').value).toBe(92);
    expect(ranking.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });
});
