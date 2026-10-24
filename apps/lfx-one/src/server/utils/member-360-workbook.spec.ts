// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MEMBER_360_MAX_TRACKER_COLUMNS, MEMBER_360_MAX_TRACKER_ROWS, ENGAGEMENT_TIERS } from '@lfx-one/shared/constants/member-360.constants';
import { lfxColors } from '@lfx-one/shared/constants/colors.constants';
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
    expect(rows.filter(([key]) => String(key).startsWith('Synthetic Member '))).toHaveLength(400);
    for (let index = 0; index < 400; index++) {
      expect(summary?.getRow(19 + index).values).toEqual([
        undefined,
        `Synthetic Member ${index}`,
        entry.days_to_renewal,
        entry.engagement_score,
        entry.engagement_tier,
      ]);
    }
    expect(summary?.columnCount).toBe(6);
    expect(summary?.pageSetup).toMatchObject({ fitToWidth: 1, fitToHeight: 0 });
    expect(summary?.getTables()).toHaveLength(3);
    const methodValues = new Map<string, unknown>();
    output.getWorksheet('Method')?.eachRow((row) => methodValues.set(row.getCell(1).text, row.getCell(2).value));
    expect(methodValues.get('reweighted')).toBe(String(envelope.tabs.method.reweighted));
    expect(methodValues.get('tier baselines[1] / merged')).toBe(String(envelope.tabs.method.tier_baselines[0].merged));
    expect(methodValues.get('quarter decay[4] / factor')).toBe(envelope.tabs.method.quarter_decay[3].factor);
    expect(methodValues.get('overrides')).toBe('[]');
    for (const name of ['Method']) {
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
          // Merged Summary cells reference their master; count the stored string once.
          if (cell.value === formula && cell.type !== ExcelJS.ValueType.Merge) cells.push(cell);
        })
      );
      expect(cells).toHaveLength(1);
      expect(cells[0]?.type).toBe(ExcelJS.ValueType.String);
      expect(cells[0]?.formula).toBeUndefined();
    }
  });
  it('writes numeric formats, real dates, blank unknowns and numeric single-threaded contacts', async () => {
    const envelope = member360Fixture();
    envelope.tabs.member_ranking[1].engaged_contacts = 1;
    envelope.tabs.member_ranking[0].renewal_date = null;
    envelope.tabs.member_ranking[0].annual_value = null;
    const bytes = await buildMember360Workbook(envelope);
    const output = new ExcelJS.Workbook();
    await output.xlsx.load(bytes);
    const sheet = output.getWorksheet('Member Ranking');
    expect(sheet?.getCell('D2').value).toBe(25000);
    expect(sheet?.getCell('D2').numFmt).toBe('"$"#,##0');
    expect(sheet?.getCell('E2').value).toEqual(new Date('2026-11-17T00:00:00Z'));
    expect(sheet?.getCell('E2').numFmt).toBe('yyyy-mm-dd');
    expect(sheet?.getCell('D3').value).toBeNull();
    expect(sheet?.getCell('E3').value).toBeNull();
    expect(sheet?.getCell('O2').value).toBeNull();
    for (const column of ['G', 'J', 'K', 'L', 'M', 'N', 'O']) expect(sheet?.getCell(`${column}2`).numFmt).toBe('0.0');
    expect(sheet?.getCell('F2').numFmt).toBe('0');
    expect(sheet?.getCell('Q2').value).toBe(1);
    expect(sheet?.getCell('Q2').numFmt).toBe('[=1]0" (single-threaded)";0');
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('xl/worksheets/sheet2.xml')?.async('string');
    expect(xml).toMatch(/<c r="E2" s="\d+"><v>\d+<\/v><\/c>/);
    expect(xml).toMatch(/<c r="Q2" s="\d+"><v>1<\/v><\/c>/);
  });
  it('writes one shared category scale, a separate engagement scale and guarded risk rules', async () => {
    const zip = await JSZip.loadAsync(await buildMember360Workbook(member360Fixture()));
    const xml = (await zip.file('xl/worksheets/sheet2.xml')?.async('string')) ?? '';
    const scales = [...xml.matchAll(/<conditionalFormatting sqref="([^"]+)">(<cfRule[^]*?)<\/conditionalFormatting>/g)].filter((match) =>
      match[2].includes('type="colorScale"')
    );
    expect(scales.map((match) => match[1])).toEqual(['G2:G3', 'J2:O3']);
    for (const [, , rule] of scales) {
      expect([...rule.matchAll(/<cfvo type="num" val="(\d+)"\/>/g)].map((match) => Number(match[1]))).toEqual([0, 50, 100]);
      expect(rule.match(/<color rgb=/g)).toHaveLength(3);
    }
    expect(xml).toContain('AND(ISNUMBER(F2),F2&lt;=120)');
    expect(xml).toContain('AND(ISNUMBER(F2),F2&gt;120,F2&lt;=240)');
    for (const tier of ENGAGEMENT_TIERS) expect(xml).toContain(`H2=&quot;${tier}&quot;`);
    expect(xml).toContain('U2=&quot;High&quot;');
    expect(xml).toContain('Q2=1');
    const actions = (await zip.file('xl/worksheets/sheet4.xml')?.async('string')) ?? '';
    expect(actions).toContain('AND(ISNUMBER(E2),E2&lt;=120)');
    expect(actions).toContain('AND(ISNUMBER(E2),E2&gt;120,E2&lt;=240)');
    expect(actions).toContain('B2=&quot;High&quot;');
    for (const tier of ENGAGEMENT_TIERS) expect(actions).toContain(`D2=&quot;${tier}&quot;`);
    const priorities = [...xml.matchAll(/<cfRule[^>]+priority="(\d+)"/g)].map((match) => match[1]);
    expect(new Set(priorities).size).toBe(priorities.length);
    const styles = await zip.file('xl/styles.xml')?.async('string');
    for (const color of [lfxColors.red[50], lfxColors.red[800], lfxColors.amber[50], lfxColors.amber[800], lfxColors.emerald[50], lfxColors.emerald[800]]) {
      expect(styles).toContain(`rgb="FF${color.replace('#', '')}"`);
    }
  });
  it('keeps renewal boundaries numeric without recoloring unknowns as zero', async () => {
    const envelope = member360Fixture();
    const seed = envelope.tabs.member_ranking[0];
    const days = [null, -1, 120, 121, 240, 241];
    envelope.tabs.member_ranking = days.map((daysToRenewal, index) => ({
      ...seed,
      rank: index + 1,
      engagement_score: 100 - index,
      days_to_renewal: daysToRenewal,
    }));
    const output = new ExcelJS.Workbook();
    await output.xlsx.load(await buildMember360Workbook(envelope));
    expect(days.map((_, index) => output.getWorksheet('Member Ranking')?.getCell(`F${index + 2}`).value)).toEqual(days);
  });
  it('lays out the QBR blocks and optional signed movers while preserving watchlist order', async () => {
    const envelope = member360Fixture();
    const summary = envelope.tabs.summary;
    summary.movers = {
      gainers: [{ member_organization: SYNTHETIC_ORG_NAME, delta: 4.5 }],
      decliners: [{ member_organization: SYNTHETIC_SECOND_ORG_LEGAL_NAME, delta: -2 }],
    };
    const output = new ExcelJS.Workbook();
    await output.xlsx.load(await buildMember360Workbook(envelope));
    const sheet = output.getWorksheet('Summary');
    expect(sheet?.getCell('C2').value).toBe(summary.project_name);
    expect(sheet?.getCell('C3').value).toContain(summary.analysis_window.start);
    expect(sheet?.getCell('B4').value).toEqual(new Date(`${summary.run_date}T00:00:00Z`));
    expect(sheet?.getCell('D4').value).toBe(summary.member_count);
    expect(sheet?.getCell('B5').value).toBe(summary.total_membership_value);
    expect(sheet?.getCell('B5').numFmt).toBe('"$"#,##0');
    expect(sheet?.getCell('A17').text).toBe('Movers');
    expect(sheet?.getCell('B19').value).toBe(4.5);
    expect(sheet?.getCell('D19').value).toBe(-2);
    expect(sheet?.getCell('B19').numFmt).toBe('+0.0;-0.0;0.0');
    expect(sheet?.getCell('A25').value).toBe(summary.watchlist[0].member_organization);
    for (let i = 0; i < ENGAGEMENT_TIERS.length; i++) {
      const tier = ENGAGEMENT_TIERS[i];
      expect(sheet?.getCell(`A${8 + i}`).value).toBe(tier);
      expect(sheet?.getCell(`B${8 + i}`).value).toBe(summary.tier_distribution[tier]);
    }
    expect(sheet?.views[0]).toMatchObject({ state: 'frozen', ySplit: 5 });
    expect(sheet?.pageSetup.printArea).toMatch(/^A1:F\d+$/);
    const cells: string[] = [];
    sheet?.eachRow((row) => row.eachCell((cell) => cells.push(cell.text)));
    expect(cells).toContain('Action load per team');
    expect(cells).toContain('High priority');
    expect(cells).toContain(`Used: ${summary.data_coverage.sources_used[0]}`);
    expect(cells).toContain(`Unavailable: ${summary.data_coverage.sources_unavailable[0]}`);
  });
  it('omits missing movers and explicitly represents empty watchlists and coverage', async () => {
    const envelope = member360Fixture();
    envelope.tabs.summary.watchlist = [];
    envelope.tabs.summary.data_coverage = { sources_used: [], sources_unavailable: [] };
    const output = new ExcelJS.Workbook();
    await output.xlsx.load(await buildMember360Workbook(envelope));
    const sheet = output.getWorksheet('Summary');
    expect(sheet?.getCell('A17').text).toBe('Watchlist · renewal within 120 days');
    expect(sheet?.getCell('A18').text).toBe('None');
    expect(sheet?.getTables()).toHaveLength(2);
    const cells: string[] = [];
    sheet?.eachRow((row) => row.eachCell((cell) => cells.push(cell.text)));
    expect(cells).not.toContain('Movers');
    expect(cells).toContain('Used: None');
    expect(cells).toContain('Unavailable: None');
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
