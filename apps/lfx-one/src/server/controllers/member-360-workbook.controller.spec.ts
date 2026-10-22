// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SYNTHETIC_ORG_NAME } from '../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { ServiceValidationError } from '../errors';
import { Member360WorkbookController } from './member-360-workbook.controller';

const mocks = vi.hoisted(() => ({ download: vi.fn(), parseTracker: vi.fn() }));
vi.mock('../services/member-360-workbook.service', () => ({
  Member360WorkbookService: class {
    public download = mocks.download;
    public parseTracker = mocks.parseTracker;
  },
}));
vi.mock('../services/logger.service', () => ({ logger: { startOperation: () => 0, success: vi.fn() } }));

describe('Member 360 workbook HTTP response', () => {
  beforeEach(() => vi.resetAllMocks());
  it('sends the server-built workbook as a private XLSX attachment', async () => {
    const res = { setHeader: vi.fn(), attachment: vi.fn(), send: vi.fn() };
    const next = vi.fn();
    mocks.download.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), filename: 'Member360_sample_2026-Q3.xlsx' });
    await new Member360WorkbookController().download(
      { query: { project: 'sample-project' }, params: { documentId: 'run-0123456789abcdef01234567' } } as unknown as Request,
      res as unknown as Response,
      next
    );
    expect(res.attachment).toHaveBeenCalledWith('Member360_sample_2026-Q3.xlsx');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.send).toHaveBeenCalledWith(Buffer.from([1, 2, 3]));
    expect(next).not.toHaveBeenCalled();
  });
  it('rejects repeated/non-string project query values before service access', async () => {
    const next = vi.fn();
    await new Member360WorkbookController().download({ query: { project: ['first', 'second'] }, params: {} } as unknown as Request, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it('passes raw tracker bytes to the entitled parser and returns only parsed rows', async () => {
    const res = { setHeader: vi.fn(), json: vi.fn() };
    const next = vi.fn();
    const tracker = { filename: 'Q3+sponsors — draft.csv', rows: [{ company: SYNTHETIC_ORG_NAME }] };
    mocks.parseTracker.mockResolvedValue(tracker);
    const req = {
      query: { project: 'sample-project', filename: 'ignored-query.csv' },
      headers: { 'x-file-name': encodeURIComponent(tracker.filename) },
      body: Buffer.from(`company\n${SYNTHETIC_ORG_NAME}`),
    } as unknown as Request;
    await new Member360WorkbookController().parseTracker(req, res as unknown as Response, next);
    expect(mocks.parseTracker).toHaveBeenCalledWith(req, 'sample-project', tracker.filename, req.body);
    expect(res.json).toHaveBeenCalledWith(tracker);
  });
  it.each([undefined, ['a.csv', 'b.csv'], { name: 'a.csv' }, '%E0%A4%A'].map((raw) => ({ raw })))(
    'rejects a missing, non-string or undecodable filename header: %j',
    async ({ raw }) => {
      const next = vi.fn();
      await new Member360WorkbookController().parseTracker(
        {
          query: { project: 'sample-project', filename: 'not-a-header.csv' },
          headers: { 'x-file-name': raw },
          body: Buffer.from('company\na'),
        } as unknown as Request,
        {} as Response,
        next
      );
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
      expect(mocks.parseTracker).not.toHaveBeenCalled();
    }
  );
  it('forwards the classified tracker reason unchanged', async () => {
    const error = ServiceValidationError.forField('tracker', 'Use at most 100 tracker columns.');
    mocks.parseTracker.mockRejectedValue(error);
    const next = vi.fn();
    await new Member360WorkbookController().parseTracker(
      { query: { project: 'sample-project' }, headers: { 'x-file-name': 'tracker.csv' }, body: Buffer.from('invalid') } as unknown as Request,
      {} as Response,
      next
    );
    expect(next).toHaveBeenCalledWith(error);
    expect(error.toResponse()['errors']).toEqual([expect.objectContaining({ message: 'Use at most 100 tracker columns.' })]);
  });
  it('delegates authorization errors without sending workbook bytes', async () => {
    const denied = new Error('denied');
    mocks.download.mockRejectedValue(denied);
    const res = { send: vi.fn() };
    const next = vi.fn();
    await new Member360WorkbookController().download(
      { query: { project: 'sample-project' }, params: { documentId: 'run-0123456789abcdef01234567' } } as unknown as Request,
      res as unknown as Response,
      next
    );
    expect(next).toHaveBeenCalledWith(denied);
    expect(res.send).not.toHaveBeenCalled();
  });
});
