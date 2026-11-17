// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getExportRows: vi.fn() }));
vi.mock('../services/foundation-participating-orgs.service', () => ({
  FoundationParticipatingOrgsService: class {
    public getExportRows = mocks.getExportRows;
  },
}));
// The utils barrel pulls in @angular/forms, which cannot load in the server's Node runtime; only the CSV helper is needed.
vi.mock('@lfx-one/shared/utils', async () => await vi.importActual('../../../../../packages/shared/src/utils/file.utils'));
vi.mock('../services/logger.service', () => ({ logger: { startOperation: vi.fn(() => 0), success: vi.fn() } }));

import { FoundationParticipatingOrgsController } from './foundation-participating-orgs.controller';

const ROW = {
  row: {
    name: 'Synthetic Company',
    isMember: true,
    membershipTierClass: 'Gold',
    otherMemberships: [],
    commits: 10,
    commitsChange: 0.1,
    contributors: 3,
    contributorsChange: 0,
  },
  lines: [],
};

async function exportCsv(query: Record<string, string>) {
  mocks.getExportRows.mockResolvedValue({ items: [ROW], truncated: false });
  const headers: Record<string, string> = {};
  const res = {
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    send: vi.fn(),
    status: vi.fn(() => res),
    end: vi.fn(),
  } as Partial<Response> as Response;
  const next = vi.fn();
  await new FoundationParticipatingOrgsController().export({ query } as unknown as Request, res, next);
  return { headers, next };
}

describe('FoundationParticipatingOrgsController export file name', () => {
  beforeEach(() => vi.clearAllMocks());

  it('names a foundation-wide export after the foundation only', async () => {
    const { headers, next } = await exportCsv({ foundationSlug: 'synthetic-foundation', range: '12mo', kind: 'summary' });
    expect(next).not.toHaveBeenCalled();
    expect(headers['Content-Disposition']).toContain('participating-companies-synthetic-foundation-summary-12mo-');
  });

  it('adds the project to the file name of a project-scoped export', async () => {
    const { headers, next } = await exportCsv({ foundationSlug: 'synthetic-foundation', projectSlug: 'project-1', range: '12mo', kind: 'summary' });
    expect(next).not.toHaveBeenCalled();
    expect(headers['Content-Disposition']).toContain('participating-companies-synthetic-foundation-project-1-summary-12mo-');
  });
});
