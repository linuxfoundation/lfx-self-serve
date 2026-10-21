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
  it('strips a BOM before tokenizing a quoted first header', () => {
    expect(member360TrackerFromRows('tracker.csv', parseMember360Csv('\uFEFF"company",note\nAcme Motors,hello')).rows).toEqual([
      { company: 'Acme Motors', note: 'hello' },
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
  it('expands a large summary watchlist and nested method settings into lossless rows', async () => {
    const envelope = member360Fixture();
    const entry = envelope.tabs.summary.watchlist[0];
    envelope.tabs.summary.watchlist = Array.from({ length: 400 }, (_, index) => ({ ...entry, member_organization: `Synthetic Member ${index}` }));
    expect(JSON.stringify(envelope.tabs.summary.watchlist).length).toBeGreaterThan(32767);
    const output = new ExcelJS.Workbook();
    await output.xlsx.load(await buildMember360Workbook(envelope));
    const summary = output.getWorksheet('Summary');
    const rows: unknown[][] = [];
    summary?.eachRow((row) => rows.push([row.getCell(1).value, row.getCell(2).value]));
    expect(rows.filter(([key]) => String(key).startsWith('watchlist['))).toHaveLength(1600);
    const values = new Map(rows.map(([key, value]) => [key, value]));
    for (let index = 0; index < 400; index++) {
      expect(values.get(`watchlist[${index + 1}] / member organization`)).toBe(`Synthetic Member ${index}`);
      expect(values.get(`watchlist[${index + 1}] / days to renewal`)).toBe(entry.days_to_renewal);
      expect(values.get(`watchlist[${index + 1}] / engagement score`)).toBe(entry.engagement_score);
      expect(values.get(`watchlist[${index + 1}] / engagement tier`)).toBe(entry.engagement_tier);
    }
    const methodValues = new Map<string, unknown>();
    output.getWorksheet('Method')?.eachRow((row) => methodValues.set(row.getCell(1).text, row.getCell(2).value));
    expect(methodValues.get('reweighted')).toBe(String(envelope.tabs.method.reweighted));
    expect(methodValues.get('tier baselines[1] / merged')).toBe(String(envelope.tabs.method.tier_baselines[0].merged));
    expect(methodValues.get('quarter decay[4] / factor')).toBe(envelope.tabs.method.quarter_decay[3].factor);
    expect(methodValues.get('overrides')).toBe('[]');
    for (const name of ['Summary', 'Method']) {
      output.getWorksheet(name)?.eachRow((row) => {
        const value: unknown = row.getCell(2).value;
        expect(value === null || typeof value === 'number' || typeof value === 'string').toBe(true);
        if (typeof value === 'string') expect(value.length).toBeLessThanOrEqual(32767);
      });
    }
  });
  it('reloads formula-shaped content as plain strings, never executable formulas', async () => {
    const envelope = member360Fixture();
    const formula = '=HYPERLINK("https://synthetic.example","open")';
    envelope.tabs.summary.project_name = formula;
    envelope.tabs.member_ranking[0].recommended_next_action = formula;
    envelope.tabs.actions_by_team[0].recommended_action = formula;
    envelope.tabs.evidence[0].description = formula;
    const output = new ExcelJS.Workbook();
    await output.xlsx.load(await buildMember360Workbook(envelope));
    for (const name of ['Summary', 'Member Ranking', 'Actions by Team', 'Evidence']) {
      const cells: ExcelJS.Cell[] = [];
      output.getWorksheet(name)?.eachRow((row) =>
        row.eachCell((cell) => {
          if (cell.value === formula) cells.push(cell);
        })
      );
      expect(cells).toHaveLength(1);
      expect(cells[0]?.type).toBe(ExcelJS.ValueType.String);
      expect(cells[0]?.formula).toBeUndefined();
    }
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
