// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Server-only workbook assembly and bounded tracker parsing. No ExcelJS in the client bundle.
import {
  CATEGORY_KEYS,
  CATEGORY_LABELS,
  MEMBER_360_RANKING_COLUMNS,
  MEMBER_360_MAX_BYTES,
  MEMBER_360_MAX_TRACKER_ROWS,
  MEMBER_360_MAX_TRACKER_COLUMNS,
  MEMBER_360_MAX_ZIP_ENTRIES,
  PRIORITIES,
  lfxColors,
} from '@lfx-one/shared/constants';
import { Member360Envelope, Member360Tracker } from '@lfx-one/shared/interfaces';
import { trackerSchema, rankMember360Rows } from '@lfx-one/shared/server';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { ServiceValidationError } from '../errors';

function trackerError(message: string): ServiceValidationError {
  return new ServiceValidationError([{ field: 'tracker', message, code: 'FIELD_VALIDATION_ERROR' }], message, {
    operation: 'member_360_tracker',
    service: 'member_360_workbook',
  });
}

/** RFC4180 cells, including quoted commas/newlines and escaped quotes. */
export function parseMember360Csv(text: string): string[][] {
  text = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else cell += char;
    } else if (char === ',' || char === '\n' || char === '\r') {
      row.push(cell);
      if (row.length > MEMBER_360_MAX_TRACKER_COLUMNS) throw trackerError(`Use at most ${MEMBER_360_MAX_TRACKER_COLUMNS} tracker columns.`);
      cell = '';
      closed = false;
      if (char !== ',') {
        rows.push(row);
        if (rows.length > MEMBER_360_MAX_TRACKER_ROWS + 1)
          throw trackerError(`Use at most ${MEMBER_360_MAX_TRACKER_ROWS.toLocaleString('en-US')} tracker data rows.`);
        row = [];
        if (char === '\r' && text[i + 1] === '\n') i++;
      }
    } else if (char === '"' && !cell && !closed) quoted = true;
    else {
      if (closed || char === '"') throw trackerError('Invalid CSV quoting');
      cell += char;
    }
  }
  if (quoted) throw trackerError('Unclosed CSV quote');
  if (cell || row.length || closed) rows.push([...row, cell]);
  return rows;
}

export function member360TrackerFromRows(filename: string, matrix: string[][]): Member360Tracker {
  const headers = matrix[0]?.map((value) => value.replace(/^\uFEFF/, '').trim()) ?? [];
  if (!headers.length || headers.length > MEMBER_360_MAX_TRACKER_COLUMNS || headers.some((value) => !value) || new Set(headers).size !== headers.length) {
    throw trackerError(`Use a header row with unique, non-empty column names (at most ${MEMBER_360_MAX_TRACKER_COLUMNS}).`);
  }
  const rows = matrix
    .slice(1)
    .filter((row) => row.some((value) => value.trim()))
    .map((row) => {
      if (row.length > headers.length) throw trackerError('A tracker row has more cells than the header.');
      return Object.fromEntries(headers.map((key, index) => [key, row[index] ?? '']));
    });
  const parsed = trackerSchema.safeParse({ filename, rows });
  if (!parsed.success) throw trackerError(`A tracker needs 1 to ${MEMBER_360_MAX_TRACKER_ROWS.toLocaleString('en-US')} data rows.`);
  return parsed.data;
}

export async function parseMember360Xlsx(filename: string, bytes: ArrayBuffer): Promise<Member360Tracker> {
  await validateTrackerZip(bytes);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount > MEMBER_360_MAX_TRACKER_ROWS + 1 || sheet.columnCount > MEMBER_360_MAX_TRACKER_COLUMNS)
    throw trackerError(`Use a sheet with at most ${MEMBER_360_MAX_TRACKER_ROWS.toLocaleString('en-US')} rows and ${MEMBER_360_MAX_TRACKER_COLUMNS} columns.`);
  if (workbook.worksheets.length !== 1) throw trackerError('Upload one tracker sheet per file so no sheets are silently skipped.');
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const values: string[] = [];
    for (let col = 1; col <= sheet.columnCount; col++) values.push(row.getCell(col).text);
    rows.push(values);
  });
  return member360TrackerFromRows(filename, rows);
}

/** Read real inflated bytes (not attacker-supplied ZIP sizes) before any XML parsing. */
async function validateTrackerZip(bytes: ArrayBuffer): Promise<void> {
  if (bytes.byteLength > MEMBER_360_MAX_BYTES) throw trackerError('The tracker exceeds 5 MB.');
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files);
  if (entries.length > MEMBER_360_MAX_ZIP_ENTRIES) throw trackerError('The tracker ZIP contains too many entries.');
  let expanded = 0;
  for (const entry of entries) {
    if (entry.dir) continue;
    await new Promise<void>((resolve, reject) => {
      const stream = entry.nodeStream('nodebuffer');
      stream
        .on('data', (chunk: Uint8Array) => {
          expanded += chunk.length;
          if (expanded > MEMBER_360_MAX_BYTES) {
            stream.pause();
            reject(trackerError('The expanded tracker exceeds 5 MB.'));
          }
        })
        .on('error', reject)
        .on('end', resolve)
        .resume();
    });
  }
}

/** Six structured, filterable tabs. Values beginning '=' stay text, never formulas. */
export async function buildMember360Workbook(envelope: Member360Envelope): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const generatedAt = new Date(`${envelope.tabs.summary.run_date}T00:00:00.000Z`);
  workbook.created = generatedAt;
  workbook.modified = generatedAt;
  const tabs = envelope.tabs;
  const sheet = (name: string, headers: string[], rows: (string | number | null)[][]): ExcelJS.Worksheet => {
    const result = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    if (rows.length)
      result.addTable({
        name: name.replace(/ /g, ''),
        ref: 'A1',
        headerRow: true,
        style: { theme: 'TableStyleMedium2', showRowStripes: true },
        columns: headers.map((name) => ({ name, filterButton: true })),
        rows,
      });
    else result.addRow(headers);
    result.columns.forEach((column, index) => {
      column.width = index === 0 ? 26 : 24;
    });
    return result;
  };
  // Keep each collection element's fields in separate rows, not a JSON cell
  // that can exceed Excel's 32,767-character limit for a large watchlist.
  const flatten = (value: unknown, path = ''): (string | number | null)[][] => {
    if (value === null || typeof value === 'number' || typeof value === 'string') return [[path, value]];
    if (typeof value === 'boolean') return [[path, String(value)]];
    if (Array.isArray(value)) return value.length ? value.flatMap((item, index) => flatten(item, `${path}[${index + 1}]`)) : [[path, '[]']];
    if (typeof value === 'object')
      return Object.entries(value).flatMap(([key, item]) => flatten(item, [path, key.replace(/_/g, ' ')].filter(Boolean).join(' / ')));
    return [];
  };
  sheet('Summary', ['Measure', 'Value'], flatten(tabs.summary));
  const keys = MEMBER_360_RANKING_COLUMNS.map((column) => column[1]);
  const ranking = sheet(
    'Member Ranking',
    MEMBER_360_RANKING_COLUMNS.map((column) => column[0]),
    rankMember360Rows(tabs.member_ranking).map((row) =>
      keys.map((key) => {
        const value = row[key];
        return Array.isArray(value) ? value.join('; ') : value;
      })
    )
  );
  const palette = [lfxColors.red[500], lfxColors.amber[400], lfxColors.emerald[600]].map((value) => ({ argb: `FF${value.replace('#', '')}` }));
  for (const key of ['engagement_score', ...CATEGORY_KEYS.map((key) => `${key}_score`)]) {
    const index = keys.indexOf(key as (typeof keys)[number]);
    ranking.addConditionalFormatting({
      ref: `${ranking.getColumn(index + 1).letter}2:${ranking.getColumn(index + 1).letter}${ranking.rowCount}`,
      rules: [
        {
          type: 'colorScale',
          priority: 1,
          cfvo: [
            { type: 'num', value: 0 },
            { type: 'num', value: 50 },
            { type: 'num', value: 100 },
          ],
          color: palette,
        },
      ],
    });
  }
  const detailHeaders = CATEGORY_KEYS.flatMap((key) =>
    ['raw_count', 'recency_weighted_count', 'tier_peer_median', 'score'].map((field) => `${CATEGORY_LABELS[key]}: ${field}`)
  );
  sheet(
    'Category Detail',
    ['Member', ...detailHeaders],
    tabs.category_detail.map((row) => [
      row.member_organization,
      ...CATEGORY_KEYS.flatMap<string | number>((key) => {
        const value = row.categories[key];
        return value.status === 'no_data'
          ? ['no data', 'no data', 'no data', 'no data']
          : [value.raw_count, value.recency_weighted_count, value.tier_peer_median, value.score];
      }),
    ])
  );
  sheet(
    'Actions by Team',
    ['Owner', 'Priority', 'Member', 'Engagement Tier', 'Days to Renewal', 'Recommended Action', 'Supporting Rationale', 'Suggested Deadline'],
    [...tabs.actions_by_team]
      .sort(
        (a, b) =>
          a.owner.localeCompare(b.owner) ||
          PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) ||
          (a.days_to_renewal ?? Infinity) - (b.days_to_renewal ?? Infinity)
      )
      .map((row) => [
        row.owner,
        row.priority,
        row.member_organization,
        row.engagement_tier,
        row.days_to_renewal,
        row.recommended_action,
        row.supporting_rationale,
        row.suggested_deadline,
      ])
  );
  sheet(
    'Evidence',
    ['Member', 'Category', 'Date', 'Description', 'Source'],
    tabs.evidence.map((row) => [row.member_organization, CATEGORY_LABELS[row.category], row.date, row.description, row.source])
  );
  sheet('Method', ['Setting', 'Value'], flatten(tabs.method));
  // ExcelJS otherwise stamps each ZIP entry with the download time. Normalize
  // entry dates too, so repeated downloads of a stored run are byte-identical.
  const zip = await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
  for (const entry of Object.values(zip.files)) entry.date = generatedAt;
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })).buffer;
}
