// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import ExcelJS from 'exceljs';
import { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { member360Fixture } from '../../../e2e/fixtures/mock-data/member-360.mock';
import { SYNTHETIC_ORG_NAME, SYNTHETIC_SECOND_ORG_LEGAL_NAME } from '../../../e2e/fixtures/mock-data/synthetic-org.mock';
import * as workbookUtils from '../utils/member-360-workbook.util';
import { Member360WorkbookService } from './member-360-workbook.service';

const mocks = vi.hoisted(() => ({ getProjectById: vi.fn(), getDocument: vi.fn(), getRevision: vi.fn() }));
vi.mock('./project.service', () => ({
  ProjectService: class {
    public getProjectById = mocks.getProjectById;
  },
}));
vi.mock('./mktg-document-store.service', () => ({
  MktgDocumentStoreService: class {
    public getDocument = mocks.getDocument;
    public getRevision = mocks.getRevision;
  },
}));
vi.mock('./logger.service', () => ({ logger: { debug: vi.fn() } }));
const req = {} as Request;
const doc = 'run-0123456789abcdef01234567';

describe('Member 360 stored workbook boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getProjectById.mockResolvedValue({ uid: 'sample-project', writer: true });
    mocks.getDocument.mockResolvedValue({ revisions: [{ id: 'revision-1' }] });
    mocks.getRevision.mockResolvedValue({ member360: member360Fixture() });
  });
  afterEach(() => vi.restoreAllMocks());
  it.each([{ body: [1, 2, 3] }, { body: 'company\nSample member' }])('rejects a non-Buffer tracker body before parsing: %j', async ({ body }) => {
    const csvParser = vi.spyOn(workbookUtils, 'parseMember360Csv');
    const xlsxParser = vi.spyOn(workbookUtils, 'parseMember360Xlsx');
    for (const filename of ['tracker.csv', 'tracker.xlsx']) {
      await expect(new Member360WorkbookService().parseTracker(req, 'sample-project', filename, body as unknown as Buffer)).rejects.toMatchObject({
        statusCode: 400,
        validationErrors: [expect.objectContaining({ field: 'tracker' })],
      });
    }
    expect(csvParser).not.toHaveBeenCalled();
    expect(xlsxParser).not.toHaveBeenCalled();
  });
  it('refuses a non-writer before any stored document read or parsing', async () => {
    mocks.getProjectById.mockResolvedValue({ uid: 'sample-project', writer: false });
    await expect(new Member360WorkbookService().download(req, 'sample-project', doc)).rejects.toThrow('write access');
    await expect(new Member360WorkbookService().parseTracker(req, 'sample-project', 'tracker.xlsx', Buffer.from('invalid zip'))).rejects.toThrow(
      'write access'
    );
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });
  it('rejects path-shaped project or document identifiers before upstream access', async () => {
    await expect(new Member360WorkbookService().download(req, '../other', doc)).rejects.toThrow();
    await expect(new Member360WorkbookService().download(req, 'sample-project', '../other')).rejects.toThrow();
    expect(mocks.getProjectById).not.toHaveBeenCalled();
  });
  it('builds all six tabs from the stored run and ignores request body tabs', async () => {
    const result = await new Member360WorkbookService().download({ body: { tabs: { injected: true } } } as Request, 'sample-project', doc);
    expect(result.filename).toBe('Member360_sample-foundation_2026-Q3.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(new Uint8Array(result.bytes).buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Summary', 'Member Ranking', 'Category Detail', 'Actions by Team', 'Evidence', 'Method']);
    expect(workbook.getWorksheet('Member Ranking')!.getCell('B2').text).toBe(SYNTHETIC_SECOND_ORG_LEGAL_NAME);
  });
  it('does not build a missing or hash-invalid stored envelope', async () => {
    mocks.getRevision.mockResolvedValue({ member360: { ...member360Fixture(), content_sha256: '0'.repeat(64) } });
    await expect(new Member360WorkbookService().download(req, 'sample-project', doc)).rejects.toThrow('not found');
    mocks.getDocument.mockResolvedValue(null);
    await expect(new Member360WorkbookService().download(req, 'sample-project', doc)).rejects.toThrow('not found');
  });
  it('refuses a stored envelope for a different project', async () => {
    mocks.getRevision.mockResolvedValue({ member360: { ...member360Fixture(), project_uid: 'other-project' } });
    await expect(new Member360WorkbookService().download(req, 'sample-project', doc)).rejects.toThrow('not found');
  });
  it('parses CSV to the form contract without persisting the upload', async () => {
    expect(
      await new Member360WorkbookService().parseTracker(
        req,
        'sample-project',
        'speaking.csv',
        Buffer.from(`company,session\n${SYNTHETIC_ORG_NAME},Sample session`)
      )
    ).toEqual({ filename: 'speaking.csv', rows: [{ company: SYNTHETIC_ORG_NAME, session: 'Sample session' }] });
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });
  it('preserves the parser reason and the service parsed-size reason', async () => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet('One');
    book.addWorksheet('Two');
    await expect(
      new Member360WorkbookService().parseTracker(req, 'sample-project', 'tracker.xlsx', Buffer.from(await book.xlsx.writeBuffer()))
    ).rejects.toMatchObject({ validationErrors: [expect.objectContaining({ message: expect.stringContaining('one tracker sheet') })] });
    const csv = Buffer.from(`company,note\n${SYNTHETIC_ORG_NAME},${'\\'.repeat(3 * 1024 * 1024)}`);
    await expect(new Member360WorkbookService().parseTracker(req, 'sample-project', 'tracker.csv', csv)).rejects.toMatchObject({
      validationErrors: [expect.objectContaining({ message: 'Parsed tracker exceeds 5 MB.' })],
    });
  });
  it.each(
    [
      ['tracker.csv'],
      ['a.csv', 'b.csv'],
      null,
      undefined,
      42,
      { toString: () => 'tracker.csv' },
      '../tracker.csv',
      'dir\\tracker.csv',
      'a'.repeat(201) + '.csv',
      'bad\nname.csv',
    ].map((filename) => ({ filename }))
  )('rejects non-string or unsafe tracker filenames: %j', async ({ filename }) => {
    await expect(new Member360WorkbookService().parseTracker(req, 'sample-project', filename, Buffer.from('company\nAcme Motors'))).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });
  it('rejects unsupported files and malformed tracker rows as validation errors', async () => {
    await expect(new Member360WorkbookService().parseTracker(req, 'sample-project', 'tracker.xls', Buffer.from('old format'))).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(new Member360WorkbookService().parseTracker(req, 'sample-project', 'tracker.csv', Buffer.from('company,company\na,b'))).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
