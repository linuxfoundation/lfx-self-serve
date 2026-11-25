// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CDP_VIEW_OUTCOME_LOCALS_KEY } from '@lfx-one/shared/constants';
import type { Request, Response } from 'express';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../services/logger.service';
import { cdpCompanyViewer, logCdpCompanyViewOnFinish } from './cdp-company-view-log.helper';

vi.mock('../services/logger.service', () => ({ logger: { info: vi.fn(), warning: vi.fn(), debug: vi.fn() } }));

const SUBJECT = 'auth0|synthetic-user';
const OTHER_SUBJECT = 'auth0|synthetic-other';
const OPERATOR_SUBJECT = 'auth0|synthetic-operator';

const signedIn = (sub: string): Request => ({ oidc: { user: { sub } } }) as unknown as Request;
const viewingAs = (operator: string, target: string): Request =>
  ({ impersonationActive: true, oidc: { user: { sub: operator } }, appSession: { impersonationUser: { sub: target } } }) as unknown as Request;

/** One page response for `req`, finished with `outcome`; returns the single `cdp_company_view` record logged. */
function viewRecord(req: Request, outcome = 'ok'): { operation: string; metadata: Record<string, unknown> } {
  const res = Object.assign(new EventEmitter(), { locals: { [CDP_VIEW_OUTCOME_LOCALS_KEY]: outcome } }) as unknown as Response;
  logCdpCompanyViewOnFinish(req, res, '1a2b3c4d-0000-4000-8000-000000000001', 'page');
  res.emit('finish');
  expect(logger.info).toHaveBeenCalledTimes(1);
  const [, operation, , metadata] = vi.mocked(logger.info).mock.calls[0];
  vi.mocked(logger.info).mockClear();
  return { operation, metadata: metadata as Record<string, unknown> };
}

describe('cdp_company_view log', () => {
  beforeEach(() => {
    vi.stubEnv('PCC_AUTH0_SECRET', 'synthetic-test-secret');
    vi.mocked(logger.info).mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('logs exactly {viewer, cdp_id, section, outcome} once per response', () => {
    const { operation, metadata } = viewRecord(signedIn(SUBJECT));

    expect(operation).toBe('cdp_company_view');
    expect(Object.keys(metadata).sort()).toEqual(['cdp_id', 'outcome', 'section', 'viewer']);
    expect(metadata).toMatchObject({ cdp_id: '1a2b3c4d-0000-4000-8000-000000000001', section: 'page', outcome: 'ok' });
  });

  it('never carries the subject or the handle inside it', () => {
    const { metadata } = viewRecord(signedIn(SUBJECT));
    const serialized = JSON.stringify(metadata);

    expect(serialized).not.toContain(SUBJECT);
    expect(serialized).not.toContain('synthetic-user');
    expect(metadata['viewer']).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('gives the same subject the same viewer across calls, and different subjects different viewers', () => {
    const first = viewRecord(signedIn(SUBJECT)).metadata['viewer'];
    const again = viewRecord(signedIn(SUBJECT)).metadata['viewer'];
    const other = viewRecord(signedIn(OTHER_SUBJECT)).metadata['viewer'];

    expect(again).toBe(first);
    expect(other).not.toBe(first);
  });

  it("names a 'view as' session's target, never the operator", () => {
    const { metadata } = viewRecord(viewingAs(OPERATOR_SUBJECT, SUBJECT));

    expect(metadata['viewer']).toBe(cdpCompanyViewer(signedIn(SUBJECT)));
    expect(metadata['viewer']).not.toBe(cdpCompanyViewer(signedIn(OPERATOR_SUBJECT)));
    expect(JSON.stringify(metadata)).not.toContain('synthetic-operator');
  });

  it('names no viewer, rather than the raw subject, when the key secret is not configured', () => {
    vi.stubEnv('PCC_AUTH0_SECRET', '');

    expect(viewRecord(signedIn(SUBJECT)).metadata['viewer']).toBeNull();
  });
});
