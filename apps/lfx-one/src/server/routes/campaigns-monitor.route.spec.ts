// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MONITOR_SHARED_ACCOUNT_RESTRICTED_CODE } from '@lfx-one/shared/constants';

import { ServerFeatureFlag } from '../helpers/server-feature-flag.helper';

const { readMonitor, checkRootWriter, checkRootCampaignManager, getPersonas, checkProjectWriter, checkSingleAccess, getProjectIdBySlug } = vi.hoisted(() => ({
  readMonitor: vi.fn(),
  checkRootWriter: vi.fn(),
  checkRootCampaignManager: vi.fn(),
  getPersonas: vi.fn(),
  checkProjectWriter: vi.fn(),
  checkSingleAccess: vi.fn(),
  getProjectIdBySlug: vi.fn(),
}));

vi.mock('../utils/persona-helper', () => ({
  personaDetectionService: { checkRootWriter, checkRootCampaignManager, getPersonas, checkProjectWriter },
}));
vi.mock('../services/access-check.service', () => ({
  AccessCheckService: class {
    public checkSingleAccess = checkSingleAccess;
  },
}));
vi.mock('../services/project.service', () => ({
  ProjectService: class {
    public getProjectIdBySlug = getProjectIdBySlug;
  },
}));
vi.mock('../services/campaign-service.service', () => ({ CampaignServiceClient: class {} }));
vi.mock('../services/campaign-proxy.service', () => ({ CampaignProxyService: class {} }));
vi.mock('../services/campaign-metrics.service', () => ({
  CampaignMetricsService: class {
    public getMonitorData = readMonitor;
  },
  LinkedInMetricsService: class {},
  RedditMetricsService: class {},
  MetaMetricsService: class {},
}));
vi.mock('../controllers/audience-builder.controller', () => ({ AudienceBuilderController: class {} }));
vi.mock('../controllers/campaign-optimize.controller', () => ({ CampaignOptimizeController: class {} }));
vi.mock('../utils/shutdown', () => ({ addShutdownHook: vi.fn(), isShuttingDown: () => false }));
vi.mock('../services/logger.service', () => ({
  logger: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    getLastOperation: vi.fn(),
  },
}));

const campaignsRouter = (await import('./campaigns.route')).default;
const { apiErrorHandler } = await import('../middleware/error-handler.middleware');

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use('/api/campaigns', campaignsRouter);
  app.use(apiErrorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api/campaigns`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv(ServerFeatureFlag.MarketingOpsFga, 'true');
  checkRootWriter.mockResolvedValue(false);
  checkRootCampaignManager.mockResolvedValue(false);
  getPersonas.mockResolvedValue({ personas: ['contributor'], personaProjects: {}, isRootWriter: false, isLFStaff: false });
  checkProjectWriter.mockResolvedValue(false);
  getProjectIdBySlug.mockResolvedValue({ uid: 'acme-foundation-uid', exists: true });
  checkSingleAccess.mockResolvedValue(false);
  readMonitor.mockResolvedValue({ campaigns: [] });
});

afterEach(() => vi.unstubAllEnvs());

describe('Google monitor through the real route, authorization middleware and controller', () => {
  it.each([true, false])('admits a ROOT caller without a project grant, writer: %s', async (writer) => {
    checkRootWriter.mockResolvedValue(writer);
    checkRootCampaignManager.mockResolvedValue(!writer);

    const response = await fetch(`${baseUrl}/monitor?project=acme-foundation`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ campaigns: [] });
    expect(readMonitor).toHaveBeenCalledTimes(1);
    expect(checkSingleAccess).not.toHaveBeenCalled();
    expect(checkProjectWriter).not.toHaveBeenCalled();
  });

  it('still requires a project for a ROOT marketing caller', async () => {
    checkRootCampaignManager.mockResolvedValue(true);

    const response = await fetch(`${baseUrl}/monitor`);

    expect(response.status).toBe(400);
    expect(readMonitor).not.toHaveBeenCalled();
  });

  it('refuses a project-only campaign manager with the shared-account restriction', async () => {
    checkSingleAccess.mockResolvedValue(true);

    const response = await fetch(`${baseUrl}/monitor?project=acme-foundation`);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: MONITOR_SHARED_ACCOUNT_RESTRICTED_CODE });
    expect(readMonitor).not.toHaveBeenCalled();
  });

  it('retains the ordinary marketing denial when neither ROOT nor project access passes', async () => {
    const response = await fetch(`${baseUrl}/monitor?project=acme-foundation`);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'MARKETING_ACCESS_REQUIRED' });
    expect(readMonitor).not.toHaveBeenCalled();
  });

  it.each([true, false])('does not admit a ROOT caller to unrelated project writes, writer: %s', async (writer) => {
    checkRootWriter.mockResolvedValue(writer);
    checkRootCampaignManager.mockResolvedValue(!writer);
    getPersonas.mockResolvedValue({ personas: ['contributor'], personaProjects: {}, isRootWriter: writer, isLFStaff: false });

    const response = await fetch(`${baseUrl}/create?project=acme-foundation`, { method: 'POST' });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'MARKETING_ACCESS_REQUIRED' });
    expect(readMonitor).not.toHaveBeenCalled();
  });

  it('preserves the flag-off ED-only baseline for a ROOT marketing-only caller', async () => {
    vi.stubEnv(ServerFeatureFlag.MarketingOpsFga, 'false');
    checkRootCampaignManager.mockResolvedValue(true);

    const response = await fetch(`${baseUrl}/monitor?project=acme-foundation`);

    expect(response.status).toBe(403);
    expect(checkRootCampaignManager).not.toHaveBeenCalled();
    expect(readMonitor).not.toHaveBeenCalled();
  });
});
