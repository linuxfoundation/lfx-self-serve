// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type {
  QueryServiceResponse,
  UpstreamFormationActivityEntry,
  UpstreamFormationActivityPage,
  UpstreamFormationChecklist,
  UpstreamFormationItem,
  UpstreamFormationItemRow,
  UpstreamFormationQueueRow,
} from '@lfx-one/shared/interfaces';
import {
  FORMATION_PEOPLE_ENRICHMENT_BATCH_SIZE,
  FORMATION_PEOPLE_ENRICHMENT_BUDGET_MS,
  FORMATION_PEOPLE_METADATA_CACHE_MAX_ENTRIES,
  FORMATION_PEOPLE_METADATA_CACHE_TTL_MS,
  LF_STAFF_EMAIL_DOMAIN,
  ROOT_PROJECT_SLUG,
} from '@lfx-one/shared/constants';
import { deriveFormationEntityType } from '@lfx-one/shared/utils';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MicroserviceError } from '../errors/microservice.error';

const getProjectById = vi.fn();
const getProjectIdBySlug = vi.fn();
const getProjectSettings = vi.fn();
const natsRequest = vi.fn();
const proxyRequest = vi.fn();
const proxyRequestWithResponse = vi.fn();
const checkSingleAccess = vi.fn();

vi.mock('./project.service', () => ({
  ProjectService: class {
    public getProjectById = getProjectById;
    public getProjectIdBySlug = getProjectIdBySlug;
    public getProjectSettings = getProjectSettings;
  },
}));
// Backs `checkFormationTeamMembership` (GH-2705) — the `team:formation#member` half of
// `can_set_status`. Mocked at the module boundary so the real class's proxy transport never runs.
vi.mock('./access-check.service', () => ({
  AccessCheckService: class {
    public checkSingleAccess = (...args: unknown[]) => checkSingleAccess(...args);
  },
}));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = (...args: unknown[]) => proxyRequest(...args);
    public proxyRequestWithResponse = (...args: unknown[]) => proxyRequestWithResponse(...args);
  },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
// NatsService backs both root-project.helper.ts lookups here (GH-2267 Phase 4, GH-2378): the hidden
// ROOT sentinel (`resolveRootProjectUid`) and the LF umbrella foundation `tlf` (
// `resolveLfFoundationRootUid`) — both resolve through the same mocked `natsRequest`, since these
// specs only need one resolved uid at a time to exercise each branch. No test in this file exercises
// the ROOT-collapse branch itself except the dedicated ROOT-collapse test below and the
// GH-2378/GH-2699 scope tests, which override this default — a resolved-but-empty response keeps every other test
// fast and keeps collapseRootParentUid a no-op.
// `root-project.helper.ts` has its own dedicated spec (`root-project.helper.spec.ts`) covering the
// cache/TTL/fail-closed behavior; this file only exercises it indirectly, through FormationService.
vi.mock('./nats.service', () => ({
  NatsService: vi.fn().mockImplementation(() => ({
    getCodec: () => ({
      encode: (v: string) => v,
      decode: (v: unknown) => v as string,
    }),
    request: natsRequest,
  })),
}));

const { FormationService } = await import('./formation.service');
const { resetRootProjectUidCacheForTests } = await import('../helpers/root-project.helper');
const { logger } = await import('./logger.service');

function buildReq(): Request {
  return { path: '/api/formations/x/items/y' } as Request;
}

/** One upstream checklist item — defaults to a plain, non-gating, `not_started` manual item. */
function rawItem(overrides: Partial<UpstreamFormationItem> = {}): UpstreamFormationItem {
  return {
    uid: '11111111-1111-4111-8111-111111111111',
    item_key: 'item-key-1',
    section_key: 'section-1',
    position: 1,
    title: 'Some item',
    gate: false,
    requires_writer: false,
    status_source: 'manual',
    is_required: true,
    // 'both' is upstream's own column default; the attribute is a required internal|external|both
    // enum, so a fixture defaulting to an unsendable value would misstate the contract (#2689).
    checklist_type: 'both',
    status: 'not_started',
    version: 1,
    ...overrides,
  };
}

/** One upstream checklist read — a single section holding whichever items the test supplies. */
function checklist(items: UpstreamFormationItem[], overrides: Partial<UpstreamFormationChecklist> = {}): UpstreamFormationChecklist {
  return {
    project_uid: 'live-project-1',
    template_uid: 'template-1',
    template_version: 1,
    lifecycle: 'live',
    sections: [{ key: 'section-1', title: 'Section', position: 1 }],
    items,
    is_activating: false,
    ...overrides,
  };
}

/** One `formation_item` index document (`/query/resources?type=formation_item`) — GH-1956. */
function itemIndexRow(overrides: Partial<UpstreamFormationItemRow> = {}): UpstreamFormationItemRow {
  return {
    object_id: 'item-1',
    formation_uid: 'formation:live-project-1',
    project_uid: 'live-project-1',
    project_name: 'Live Project',
    project_slug: 'live-project',
    lifecycle: 'live',
    item_key: 'item-key-1',
    title: 'Some item',
    status_source: 'manual',
    status: 'not_started',
    gate: false,
    requires_writer: false,
    assignee: 'alice',
    ...overrides,
  };
}

/** One `formation` index document (`/query/resources?type=formation`), assignee-tagged — GH-1956. */
function formationIndexRow(overrides: Partial<UpstreamFormationQueueRow> = {}): UpstreamFormationQueueRow {
  return {
    formation_uid: 'formation:live-project-1',
    project_uid: 'live-project-1',
    project_name: 'Live Project',
    project_slug: 'live-project',
    is_foundation: false,
    parent_uid: null,
    sub_stage: 'Formation - Engaged',
    lifecycle: 'live',
    gates_cleared: false,
    is_activating: false,
    announcement_date: null,
    progress: { not_started: 1 },
    blocked_item_titles: [],
    assignees: ['alice'],
    ...overrides,
  };
}

/** One `GET /formations/{project_uid}/activity` entry, straight off the upstream wire (no canonicalization). */
function activityEntry(overrides: Partial<UpstreamFormationActivityEntry> = {}): UpstreamFormationActivityEntry {
  return {
    ulid: 'activity-ulid-1',
    item_uid: '11111111-1111-4111-8111-111111111111',
    actor: 'sam.chen',
    set_by: 'user',
    action: 'status_changed',
    before: { status: 'not_started', assignee: null },
    after: { status: 'in_progress', assignee: null },
    at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function activityPage(entries: UpstreamFormationActivityEntry[], nextCursor = ''): UpstreamFormationActivityPage {
  return { entries, next_cursor: nextCursor };
}

/** A `proxyRequestWithResponse` resolution for one of the three write routes (GH-2576 Phase 2). */
function writeResponse(item: UpstreamFormationItem, etag?: string) {
  return { data: item, status: 200, statusText: 'OK', headers: etag !== undefined ? { etag } : {} };
}

describe('FormationService', () => {
  const service = new FormationService();

  beforeEach(() => {
    getProjectById.mockReset();
    getProjectIdBySlug.mockReset();
    getProjectSettings.mockReset();
    vi.mocked(logger.info).mockClear();
    vi.mocked(logger.warning).mockClear();
    natsRequest.mockReset();
    natsRequest.mockResolvedValue({ data: '' });
    resetRootProjectUidCacheForTests();
    FormationService.resetUserMetadataCacheForTests();
    proxyRequest.mockReset();
    proxyRequestWithResponse.mockReset();
    checkSingleAccess.mockReset();
    // Default: caller is NOT on team:formation — matching production's provisioning state and the
    // fail-closed posture; the can_set_status tests opt in explicitly.
    checkSingleAccess.mockResolvedValue(false);
    getProjectById.mockResolvedValue({ slug: 'live-project', name: 'Live Project', parent_uid: null, writer: true });
    getProjectIdBySlug.mockResolvedValue({ uid: 'live-project-1', exists: true });
    getProjectSettings.mockResolvedValue({ announcement_date: null });
  });

  describe('getFormationPeople (#2724)', () => {
    // Built from the constant rather than spelled out: check-fixture-emails.sh (GH-1674)
    // denylists the LF domain itself in spec files.
    const LF_STAFF_EMAIL = `alex.rivera@${LF_STAFF_EMAIL_DOMAIN}`;
    const LF_STAFF_EMAIL_MIXED_CASE = `Alex.Rivera@${LF_STAFF_EMAIL_DOMAIN.replace('linux', 'Linux')}`;
    const settingsWith = (overrides: Record<string, unknown> = {}) => ({
      uid: 'live-project-1',
      announcement_date: null,
      writers: [],
      auditors: [],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      ...overrides,
    });
    const metadataReply = (data: Record<string, unknown>) => ({ data: JSON.stringify({ success: true, username: 'x', data }) });

    it('throws ResourceNotFoundError when the project does not exist for this caller', async () => {
      getProjectIdBySlug.mockResolvedValue({ uid: undefined, exists: false });

      await expect(service.getFormationPeople(buildReq(), 'does-not-exist')).rejects.toThrow(/not found/i);
      expect(proxyRequest).not.toHaveBeenCalled();
      expect(getProjectSettings).not.toHaveBeenCalled();
    });

    it.each([403, 404])('masks a checklist %s as not-found and never reads settings — the checklist read is the gate', async (status) => {
      proxyRequest.mockRejectedValue(new MicroserviceError('denied', status, 'DENIED', { operation: 'x', service: 'x', path: '/x' }));

      await expect(service.getFormationPeople(buildReq(), 'live-project')).rejects.toThrow(/not found/i);
      expect(getProjectSettings).not.toHaveBeenCalled();
    });

    it('degrades a refused settings read to an unavailable list instead of failing (global-grant staff)', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem()]));
      getProjectSettings.mockRejectedValue(new MicroserviceError('forbidden', 403, 'FORBIDDEN', { operation: 'x', service: 'x', path: '/x' }));

      const result = await service.getFormationPeople(buildReq(), 'live-project');

      expect(result).toEqual({ state: 'unavailable', people: [] });
      expect(logger.warning).toHaveBeenCalledWith(
        expect.anything(),
        'get_formation_people',
        expect.stringMatching(/unavailable/i),
        expect.objectContaining({ status_code: 403 })
      );
      expect(natsRequest).not.toHaveBeenCalled();
    });

    it('builds the list from settings roles: writers manage, auditors view, staff by LF domain, pending when username-less', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem()]));
      getProjectSettings.mockResolvedValue(
        settingsWith({
          writers: [{ name: 'Alex Rivera', email: LF_STAFF_EMAIL_MIXED_CASE, username: 'alex.rivera' }],
          auditors: [
            { name: 'Sam Chen', email: 'sam.chen@cascade-data.example', username: 'sam.chen' },
            { name: 'Jordan Lee', email: 'jordan.lee@partner-corp.example' },
          ],
        })
      );
      natsRequest.mockResolvedValue({ data: JSON.stringify({ success: false }) });

      const result = await service.getFormationPeople(buildReq(), 'live-project');

      expect(result.state).toBe('loaded');
      expect(result.people).toEqual([
        expect.objectContaining({ key: 'alex.rivera', role: 'manage', group: 'staff', is_pending: false }),
        expect.objectContaining({
          key: 'jordan.lee@partner-corp.example',
          username: null,
          role: 'view',
          group: 'invited',
          is_pending: true,
        }),
        expect.objectContaining({ key: 'sam.chen', role: 'view', group: 'invited', is_pending: false }),
      ]);
      // One metadata read per person WITH a username — the pending entry has no account to look up.
      expect(natsRequest).toHaveBeenCalledTimes(2);
      expect(natsRequest.mock.calls.map((call) => call[1]).sort()).toEqual(['alex.rivera', 'sam.chen']);
    });

    it('enriches title, organization and a fallback avatar from user metadata, keeping a settings avatar', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem()]));
      getProjectSettings.mockResolvedValue(
        settingsWith({
          writers: [{ name: 'Alex Rivera', email: LF_STAFF_EMAIL, username: 'alex.rivera', avatar: 'https://cdn.example/settings.png' }],
          auditors: [{ name: 'Sam Chen', email: 'sam.chen@cascade-data.example', username: 'sam.chen' }],
        })
      );
      natsRequest.mockImplementation(async (_subject: string, username: string) => {
        if (username === 'alex.rivera') return metadataReply({ job_title: ' Program Manager ', organization: '', picture: 'https://cdn.example/meta-a.png' });
        return metadataReply({ job_title: 'Partner contact', organization: 'Cascade Data', picture: 'https://cdn.example/meta-s.png' });
      });

      const result = await service.getFormationPeople(buildReq(), 'live-project');

      expect(result.people).toEqual([
        expect.objectContaining({ key: 'alex.rivera', job_title: 'Program Manager', organization: null, avatar: 'https://cdn.example/settings.png' }),
        expect.objectContaining({ key: 'sam.chen', job_title: 'Partner contact', organization: 'Cascade Data', avatar: 'https://cdn.example/meta-s.png' }),
      ]);
    });

    it('tolerates one failed metadata lookup — that person stays unenriched, the rest and the response are unaffected', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem()]));
      getProjectSettings.mockResolvedValue(
        settingsWith({
          writers: [{ name: 'Alex Rivera', email: LF_STAFF_EMAIL, username: 'alex.rivera' }],
          auditors: [{ name: 'Sam Chen', email: 'sam.chen@cascade-data.example', username: 'sam.chen' }],
        })
      );
      natsRequest.mockImplementation(async (_subject: string, username: string) => {
        if (username === 'alex.rivera') throw new Error('nats timeout');
        return metadataReply({ job_title: 'Partner contact' });
      });

      const result = await service.getFormationPeople(buildReq(), 'live-project');

      expect(result.state).toBe('loaded');
      expect(result.people).toEqual([
        expect.objectContaining({ key: 'alex.rivera', job_title: null, organization: null }),
        expect.objectContaining({ key: 'sam.chen', job_title: 'Partner contact' }),
      ]);
      expect(logger.warning).toHaveBeenCalledWith(
        expect.anything(),
        'enrich_formation_people',
        expect.stringMatching(/lookup failed/i),
        expect.objectContaining({ err: expect.any(Error) })
      );
    });

    it('leaves a malformed profile (non-string metadata fields) unenriched instead of failing the endpoint', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem()]));
      getProjectSettings.mockResolvedValue(
        settingsWith({
          writers: [{ name: 'Kim Park', email: 'kim.park@partner-corp.example', username: 'kim.park' }],
          auditors: [{ name: 'Sam Chen', email: 'sam.chen@cascade-data.example', username: 'sam.chen' }],
        })
      );
      natsRequest.mockImplementation(async (_subject: string, username: string) => {
        if (username === 'sam.chen')
          return metadataReply({ job_title: 123 as unknown as string, organization: ['x'] as unknown as string, picture: null as unknown as string });
        return metadataReply({ job_title: 'Program Manager' });
      });

      const result = await service.getFormationPeople(buildReq(), 'live-project');

      expect(result.state).toBe('loaded');
      expect(result.people).toEqual([
        expect.objectContaining({ key: 'kim.park', job_title: 'Program Manager' }),
        expect.objectContaining({ key: 'sam.chen', job_title: null, organization: null, avatar: null }),
      ]);
    });

    it('memoises only the three rendered fields, never the raw profile and its PII', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem()]));
      getProjectSettings.mockResolvedValue(settingsWith({ writers: [{ name: 'Sam Chen', email: 'sam.chen@cascade-data.example', username: 'sam.chen' }] }));
      natsRequest.mockResolvedValue(
        metadataReply({
          job_title: ' Partner contact ',
          organization: '',
          picture: 'https://cdn.example/s.png',
          address: '1 Main St',
          phone_number: '555-0100',
          postal_code: '00000',
          bio: 'private',
        })
      );

      const result = await service.getFormationPeople(buildReq(), 'live-project');

      expect(result.people[0]).toEqual(expect.objectContaining({ job_title: 'Partner contact', organization: null, avatar: 'https://cdn.example/s.png' }));
      await expect(FormationService.userMetadataCacheValueForTests('sam.chen')).resolves.toEqual({
        name: null,
        job_title: 'Partner contact',
        organization: null,
        picture: 'https://cdn.example/s.png',
      });
    });

    it('treats an explicit metadata miss (success: false) as nothing to show, without a warning', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem()]));
      getProjectSettings.mockResolvedValue(settingsWith({ writers: [{ name: 'Sam Chen', email: 'sam.chen@cascade-data.example', username: 'sam.chen' }] }));
      natsRequest.mockResolvedValue({ data: JSON.stringify({ success: false, error: 'not found' }) });

      const result = await service.getFormationPeople(buildReq(), 'live-project');

      expect(result.people[0]).toEqual(expect.objectContaining({ job_title: null, organization: null, avatar: null }));
      expect(logger.warning).not.toHaveBeenCalled();
    });

    it('memoises each person’s metadata across requests, including a resolved miss, but not a transport failure', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem()]));
      getProjectSettings.mockResolvedValue(
        settingsWith({
          writers: [{ name: 'Sam Chen', email: 'sam.chen@cascade-data.example', username: 'sam.chen' }],
          auditors: [{ name: 'Kim Park', email: 'kim.park@partner-corp.example', username: 'kim.park' }],
        })
      );
      natsRequest.mockImplementation(async (_subject: string, username: string) => {
        if (username === 'kim.park') return { data: JSON.stringify({ success: false }) };
        return metadataReply({ job_title: 'Partner contact' });
      });

      await service.getFormationPeople(buildReq(), 'live-project');
      const second = await service.getFormationPeople(buildReq(), 'live-project');

      // Two people, two reads total — the second request served both from the memo.
      expect(natsRequest).toHaveBeenCalledTimes(2);
      // Name-sorted: Kim Park (resolved miss → null) before Sam Chen.
      expect(second.people.map((p) => p.job_title)).toEqual([null, 'Partner contact']);

      // A transport failure is not memoised: the next read retries.
      FormationService.resetUserMetadataCacheForTests();
      natsRequest.mockRejectedValueOnce(new Error('nats timeout')).mockRejectedValueOnce(new Error('nats timeout'));
      await service.getFormationPeople(buildReq(), 'live-project');
      await service.getFormationPeople(buildReq(), 'live-project');
      expect(natsRequest).toHaveBeenCalledTimes(6);
    });

    it('shares one in-flight lookup between concurrent requests for the same person', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem()]));
      getProjectSettings.mockResolvedValue(settingsWith({ writers: [{ name: 'Sam Chen', email: 'sam.chen@cascade-data.example', username: 'sam.chen' }] }));
      natsRequest.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return metadataReply({ job_title: 'Partner contact' });
      });

      // SSR pre-render plus client hydration on first load: both miss an empty memo at once.
      const [first, second] = await Promise.all([
        service.getFormationPeople(buildReq(), 'live-project'),
        service.getFormationPeople(buildReq(), 'live-project'),
      ]);

      expect(natsRequest).toHaveBeenCalledTimes(1);
      expect(first.people[0].job_title).toBe('Partner contact');
      expect(second.people[0].job_title).toBe('Partner contact');
    });

    it('re-reads a person’s metadata once the memo TTL has elapsed', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-09-18T12:00:00Z'));
        proxyRequest.mockResolvedValue(checklist([rawItem()]));
        getProjectSettings.mockResolvedValue(settingsWith({ writers: [{ name: 'Sam Chen', email: 'sam.chen@cascade-data.example', username: 'sam.chen' }] }));
        natsRequest.mockResolvedValue(metadataReply({ job_title: 'Partner contact' }));

        await service.getFormationPeople(buildReq(), 'live-project');
        vi.setSystemTime(new Date(Date.now() + FORMATION_PEOPLE_METADATA_CACHE_TTL_MS - 1));
        await service.getFormationPeople(buildReq(), 'live-project');
        expect(natsRequest).toHaveBeenCalledTimes(1);

        vi.setSystemTime(new Date(Date.now() + 1));
        await service.getFormationPeople(buildReq(), 'live-project');
        expect(natsRequest).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('evicts expired memo entries on the next write, so the map does not grow with every user ever seen', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-09-18T12:00:00Z'));
        proxyRequest.mockResolvedValue(checklist([rawItem()]));
        natsRequest.mockResolvedValue(metadataReply({ job_title: 'Partner contact' }));

        getProjectSettings.mockResolvedValue(settingsWith({ writers: [{ name: 'Sam Chen', email: 'sam.chen@cascade-data.example', username: 'sam.chen' }] }));
        await service.getFormationPeople(buildReq(), 'live-project');
        expect(FormationService.userMetadataCacheSizeForTests()).toBe(1);

        vi.setSystemTime(new Date(Date.now() + FORMATION_PEOPLE_METADATA_CACHE_TTL_MS));
        getProjectSettings.mockResolvedValue(settingsWith({ writers: [{ name: 'Kim Park', email: 'kim.park@partner-corp.example', username: 'kim.park' }] }));
        await service.getFormationPeople(buildReq(), 'live-project');

        // sam.chen expired and was dropped by kim.park's write — only the live entry remains.
        expect(FormationService.userMetadataCacheSizeForTests()).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('caps the memo at FORMATION_PEOPLE_METADATA_CACHE_MAX_ENTRIES by evicting the oldest live entry', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem()]));
      natsRequest.mockResolvedValue(metadataReply({ job_title: 'Partner contact' }));
      const writers = Array.from({ length: FORMATION_PEOPLE_METADATA_CACHE_MAX_ENTRIES + 1 }, (_, i) => ({
        // Zero-padded so the name sort matches insertion order and "oldest" is deterministic.
        name: `Person ${String(i).padStart(5, '0')}`,
        email: `person${i}@partner-corp.example`,
        username: `person${i}`,
      }));
      getProjectSettings.mockResolvedValue(settingsWith({ writers }));

      await service.getFormationPeople(buildReq(), 'live-project');

      expect(FormationService.userMetadataCacheSizeForTests()).toBe(FORMATION_PEOPLE_METADATA_CACHE_MAX_ENTRIES);
      // The first person written is the one evicted; the last is still memoised.
      natsRequest.mockClear();
      getProjectSettings.mockResolvedValue(settingsWith({ writers: [writers[0], writers[writers.length - 1]] }));
      await service.getFormationPeople(buildReq(), 'live-project');
      expect(natsRequest).toHaveBeenCalledTimes(1);
      expect(natsRequest.mock.calls[0][1]).toBe('person0');
    });

    it('stops enriching once the wall-clock budget is spent and returns the rest unenriched, logging once', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-09-18T12:00:00Z'));
        proxyRequest.mockResolvedValue(checklist([rawItem()]));
        const writers = Array.from({ length: FORMATION_PEOPLE_ENRICHMENT_BATCH_SIZE + 2 }, (_, i) => ({
          name: `Person ${String(i).padStart(2, '0')}`,
          email: `person${i}@partner-corp.example`,
          username: `person${i}`,
        }));
        getProjectSettings.mockResolvedValue(settingsWith({ writers }));
        natsRequest.mockImplementation(async () => {
          // A slow responder: each read burns the whole budget, so only the first batch is issued.
          vi.setSystemTime(new Date(Date.now() + FORMATION_PEOPLE_ENRICHMENT_BUDGET_MS + 1));
          return metadataReply({ job_title: 'Partner contact' });
        });

        const result = await service.getFormationPeople(buildReq(), 'live-project');

        expect(result.state).toBe('loaded');
        expect(result.people).toHaveLength(writers.length);
        expect(natsRequest).toHaveBeenCalledTimes(FORMATION_PEOPLE_ENRICHMENT_BATCH_SIZE);
        expect(result.people.filter((p) => p.job_title === 'Partner contact')).toHaveLength(FORMATION_PEOPLE_ENRICHMENT_BATCH_SIZE);
        expect(result.people.filter((p) => p.job_title === null)).toHaveLength(2);
        // One summary line for the skipped people — not a warning per person.
        expect(logger.warning).toHaveBeenCalledTimes(1);
        expect(logger.warning).toHaveBeenCalledWith(
          expect.anything(),
          'enrich_formation_people',
          expect.stringMatching(/budget/i),
          expect.objectContaining({ skipped: 2 })
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns an empty loaded list, with no metadata reads, for a formation nobody has been added to', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem()]));
      getProjectSettings.mockResolvedValue(settingsWith());

      const result = await service.getFormationPeople(buildReq(), 'live-project');

      expect(result).toEqual({ state: 'loaded', people: [] });
      expect(natsRequest).not.toHaveBeenCalled();
    });
  });

  describe('getProjectFormation', () => {
    it('throws ResourceNotFoundError when the project does not exist for this caller', async () => {
      getProjectIdBySlug.mockResolvedValue({ uid: undefined, exists: false });

      await expect(service.getProjectFormation(buildReq(), 'does-not-exist')).rejects.toThrow(/not found/i);
      expect(getProjectById).not.toHaveBeenCalled();
    });

    it('maps a live checklist read to FormationChecklistResponse', async () => {
      getProjectSettings.mockResolvedValue({ announcement_date: '2026-10-01' });
      proxyRequest.mockResolvedValue(
        checklist([rawItem({ gate: true, section_key: 'legal_and_entity' })], {
          sections: [{ key: 'legal_and_entity', title: 'Legal and entity', position: 1 }],
        })
      );

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.template).not.toBeNull();
      expect(result.template?.uid).toBe('template-1');
      expect(result.template?.sections).toEqual([{ key: 'legal_and_entity', title: 'Legal and entity', items: [] }]);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].template_item_key).toBe('item-key-1');
      expect(result.formation.announcement_date).toBe('2026-10-01');
      expect(result.formation.gating_items_total).toBe(1);
      expect(result.formation.gating_items_open).toBe(1);

      // ?v=1 is appended by MicroserviceProxyService.proxyRequest itself (DEFAULT_QUERY_PARAMS), not
      // by this call site — the path carries no query string of its own.
      const getCall = proxyRequest.mock.calls.find((call) => call[3] === 'GET' || call[3] === undefined);
      expect(getCall![2]).toBe('/formations/live-project-1');
    });

    it('resolves can_write from the ACCESS-CHECKED project read (GH-2694) — the writer flag the assignment route is gated on', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem()]));

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.can_write).toBe(true);
      // The single-project read with `access: true` (never a batch check — LFXV2-2823); the
      // access-less cached variant can't answer this, its `writer` is never populated.
      expect(getProjectById).toHaveBeenCalledWith(expect.anything(), 'live-project-1', true);
    });

    it('reports can_write false when the access check does not confirm writer (fail-closed)', async () => {
      // checkSingleAccess degrades to false inside getProjectById on an access-check failure, so an
      // absent/false writer flag is the only shape this service ever sees for a non-writer.
      getProjectById.mockResolvedValue({ slug: 'live-project', name: 'Live Project', parent_uid: null });
      proxyRequest.mockResolvedValue(checklist([rawItem()]));

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.can_write).toBe(false);
    });

    it('resolves can_set_status as writer AND team:formation membership (GH-2705)', async () => {
      checkSingleAccess.mockResolvedValue(true);
      proxyRequest.mockResolvedValue(checklist([rawItem()]));

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.can_set_status).toBe(true);
      expect(checkSingleAccess).toHaveBeenCalledWith(expect.anything(), { resource: 'team', id: 'formation', access: 'member' });
    });

    it('reports can_set_status false for a writer who is not on team:formation — the shipped production defect (GH-2705)', async () => {
      // beforeEach default: writer true, membership false. The gateway's set_item_status rule ANDs
      // writer_guard with team membership, so the writer half alone must not offer status controls.
      proxyRequest.mockResolvedValue(checklist([rawItem()]));

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.can_write).toBe(true);
      expect(result.can_set_status).toBe(false);
    });

    it('reports can_set_status false for a team member who is not a writer on this project', async () => {
      checkSingleAccess.mockResolvedValue(true);
      getProjectById.mockResolvedValue({ slug: 'live-project', name: 'Live Project', parent_uid: null });
      proxyRequest.mockResolvedValue(checklist([rawItem()]));

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.can_set_status).toBe(false);
    });

    it('masks an upstream 404 on the checklist read as a not-found Formation', async () => {
      proxyRequest.mockRejectedValue(new MicroserviceError('not found', 404, 'NOT_FOUND'));

      await expect(service.getProjectFormation(buildReq(), 'live-project')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('masks an upstream 403 on the checklist read identically to a 404 (enumeration-oracle guard)', async () => {
      proxyRequest.mockRejectedValue(new MicroserviceError('forbidden', 403, 'FORBIDDEN'));
      const forbidden = await service.getProjectFormation(buildReq(), 'live-project').catch((error: Error) => error);

      proxyRequest.mockRejectedValue(new MicroserviceError('not found', 404, 'NOT_FOUND'));
      const notFound = await service.getProjectFormation(buildReq(), 'live-project').catch((error: Error) => error);

      expect(forbidden).toMatchObject({ statusCode: 404 });
      expect((forbidden as Error).message).toBe((notFound as Error).message);
    });

    it('collapses a ROOT-parented project to parent_uid null, independent of is_foundation', async () => {
      getProjectById.mockResolvedValue({
        slug: 'live-project',
        name: 'Live Project',
        parent_uid: 'root-uid',
        writer: true,
        stage: 'Active',
        legal_entity_type: 'Corporation',
        funding: 'Funded',
        funding_model: ['Membership'],
      });
      natsRequest.mockResolvedValue({ data: 'root-uid' });
      proxyRequest.mockResolvedValue(checklist([rawItem()]));

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.formation.parent_uid).toBeNull();
      expect(result.formation.is_foundation).toBe(true);
      // `Active` is not a Formation sub-stage — the derivation must not fall through to 'engaged'
      // (GH-2328), even though this project's checklist is still reachable and live.
      expect(result.formation.sub_stage).toBeNull();
      expect(result.formation.sub_stage_raw).toBe('Active');
    });

    it.each([
      ['Formation - Exploratory', 'exploratory'],
      ['Formation - Engaged', 'engaged'],
      ['Formation - On Hold', 'on_hold'],
      ['Formation - Disengaged', null],
      ['Formation - Confidential', null],
      ['Active', null],
      ['Archived', null],
      ['Some Unrecognized Stage', null],
    ] as const)('normalizes checklist sub_stage from real upstream stage string %s to %s, never guessing', async (rawStage, expected) => {
      getProjectById.mockResolvedValue({ slug: 'live-project', name: 'Live Project', parent_uid: null, writer: true, stage: rawStage });
      proxyRequest.mockResolvedValue(checklist([rawItem()]));

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.formation.sub_stage).toBe(expected);
      expect(result.formation.sub_stage_raw).toBe(rawStage);
    });

    it('reports a null sub_stage_raw as an empty string when the project record omits stage entirely', async () => {
      // Default beforeEach fixture has no `stage` at all — the honest raw value is '', not 'undefined'.
      proxyRequest.mockResolvedValue(checklist([rawItem()]));

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.formation.sub_stage).toBeNull();
      expect(result.formation.sub_stage_raw).toBe('');
    });

    it('reports is_foundation false for a top-level project that fails computeIsFoundation, despite parent_uid null', async () => {
      // parent_uid collapsing to null must not itself imply is_foundation — the two are independent
      // axes (see deriveFormationEntityType). A project missing computeIsFoundation's criteria
      // (no stage/funding/funding_model set here) stays is_foundation:false even with no parent.
      proxyRequest.mockResolvedValue(checklist([rawItem()]));

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.formation.parent_uid).toBeNull();
      expect(result.formation.is_foundation).toBe(false);
    });

    it('counts a skipped gating item as still outstanding, matching upstream gate accounting', async () => {
      // Upstream's own gate accounting (gateSummaryFromItems/isActivating) treats `skipped` as not
      // yet done — only `status === 'done'` clears a gate. The live queue's gates_cleared is sourced
      // from that same projection, so this checklist path must agree.
      proxyRequest.mockResolvedValue(checklist([rawItem({ gate: true, status: 'skipped', skip_reason: 'Not applicable' })]));

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.formation.gating_items_total).toBe(1);
      expect(result.formation.gating_items_open).toBe(1);
    });

    it('degrades announcement_date to null when the project-settings read fails', async () => {
      getProjectSettings.mockRejectedValue(new Error('settings service unavailable'));
      proxyRequest.mockResolvedValue(checklist([rawItem()]));

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.formation.announcement_date).toBeNull();
    });

    it("prefers this response's own section title over the seeded template's when upstream has renamed a section", async () => {
      proxyRequest.mockResolvedValue(
        checklist([rawItem({ section_key: 'legal_and_entity' })], {
          sections: [{ key: 'legal_and_entity', title: 'Legal & Entity (renamed)', position: 1 }],
        })
      );

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.items[0].section_title).toBe('Legal & Entity (renamed)');
      expect(result.template?.sections[0].title).toBe('Legal & Entity (renamed)');
    });

    it('falls back to the raw section_key when a section is not in this response', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem({ section_key: 'unrecognized-section' })]));

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.items[0].section_title).toBe('unrecognized-section');
    });

    it('derives gating counts from the mapped checklist items', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem({ gate: true })]));

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.items).toHaveLength(1);
      expect(result.formation.gating_items_total).toBe(1);
      expect(result.formation.gating_items_open).toBe(1);
    });

    it('maps every checklist item straight through with no per-item enrichment step', async () => {
      // GH-2576 Phase 2 removed the FormationItemAccessService-backed can_complete enrichment
      // (`enrichItems`/`enrichSingle`) entirely — a gating item's completion access is enforced solely
      // by the API gateway on the write route, so there is nothing left here that can fail or drop an
      // item mid-read.
      proxyRequest.mockResolvedValue(
        checklist([rawItem({ item_key: 'item-key-1' }), rawItem({ item_key: 'item-key-2', uid: 'formation-item:live-project-1:item-key-2' })])
      );

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.items).toHaveLength(2);
      expect(result.items.map((item) => item.template_item_key)).toEqual(['item-key-1', 'item-key-2']);
    });

    it('enriches item owner.name with the display name from user metadata, replacing the username placeholder', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem({ assignee: 'sam.chen' })]));
      natsRequest.mockImplementation(async (_subject: string, username: string) => {
        if (username === 'sam.chen') return { data: JSON.stringify({ success: true, data: { given_name: 'Sam', family_name: 'Chen' } }) };
        return { data: '' };
      });

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.items[0].owner).toEqual({ username: 'sam.chen', name: 'Sam Chen' });
    });

    it('leaves owner.name as the username when metadata has no name fields', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem({ assignee: 'sam.chen' })]));
      natsRequest.mockResolvedValue({ data: JSON.stringify({ success: true, data: { job_title: 'Engineer' } }) });

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.items[0].owner).toEqual({ username: 'sam.chen', name: 'sam.chen' });
    });

    it('resolveDisplayName: given+family beats top-level name; lone part is a last resort', async () => {
      // Verifies the three-tier precedence via the process-wide metadata cache, which stores the
      // resolved name from fetchUserMetadata → resolveDisplayName.
      const mockedGetProjectSettings = getProjectSettings as ReturnType<typeof vi.fn>;
      mockedGetProjectSettings.mockResolvedValue({ announcement_date: null, writers: [{ username: 'u1' }], auditors: [{ username: 'u2' }] });

      // u1: both parts — name should be "Ada Lovelace", NOT "Ada Lovelace Full" (given+family wins)
      // u2: only given_name — falls through to top-level name "Full Name"
      natsRequest.mockImplementation(async (_subject: string, username: string) => {
        if (username === 'u1')
          return { data: JSON.stringify({ success: true, data: { given_name: 'Ada', family_name: 'Lovelace', name: 'Ada Lovelace Full' } }) };
        if (username === 'u2') return { data: JSON.stringify({ success: true, data: { given_name: 'Ada', name: 'Full Name' } }) };
        return { data: '' };
      });

      await service.getFormationPeople(buildReq(), 'live-project');

      await expect(FormationService.userMetadataCacheValueForTests('u1')).resolves.toMatchObject({ name: 'Ada Lovelace' });
      await expect(FormationService.userMetadataCacheValueForTests('u2')).resolves.toMatchObject({ name: 'Full Name' });
    });
  });

  describe('getFormationItemDetail', () => {
    const itemUid = '11111111-1111-4111-8111-111111111111';

    /** Path-aware mock: checklist for `/formations/:uid`, an activity page for `/formations/:uid/activity`. */
    function mockRoutes(activityByPage: UpstreamFormationActivityPage[]): void {
      let call = 0;
      proxyRequest.mockImplementation((_req: Request, _service: string, path: string) => {
        if (path === '/formations/live-project-1') {
          return Promise.resolve(checklist([rawItem()]));
        }
        if (path === '/formations/live-project-1/activity') {
          const page = activityByPage[Math.min(call, activityByPage.length - 1)];
          call += 1;
          return Promise.resolve(page);
        }
        throw new Error(`unexpected path: ${path}`);
      });
    }

    it('maps a real status_changed entry for the item, preserving newest-first order', async () => {
      const newer = activityEntry({ ulid: 'activity-ulid-2', at: '2026-01-02T00:00:00.000Z' });
      const older = activityEntry({ ulid: 'activity-ulid-1', at: '2026-01-01T00:00:00.000Z' });
      mockRoutes([activityPage([newer, older])]);

      const result = await service.getFormationItemDetail(buildReq(), 'live-project-1', 'item-key-1');

      expect(result.item.template_item_key).toBe('item-key-1');
      expect(result.history_state).toBe('complete');
      expect(result.history.map((entry) => entry.uid)).toEqual(['activity-ulid-2', 'activity-ulid-1']);
      expect(result.history[0]).toMatchObject({
        formation_item_uid: itemUid,
        action: 'status_changed',
        action_raw: 'status_changed',
        actor: { username: 'sam.chen', name: 'sam.chen' },
      });
    });

    it('renders an unrecognized action as unmapped — action: null, action_raw verbatim', async () => {
      mockRoutes([activityPage([activityEntry({ action: 'item_teleported' })])]);

      const result = await service.getFormationItemDetail(buildReq(), 'live-project-1', 'item-key-1');

      expect(result.history[0].action).toBeNull();
      expect(result.history[0].action_raw).toBe('item_teleported');
    });

    it('returns an empty, complete history when the upstream filtered read has no entries for this item', async () => {
      mockRoutes([activityPage([])]);

      const result = await service.getFormationItemDetail(buildReq(), 'live-project-1', 'item-key-1');

      expect(result.history).toEqual([]);
      expect(result.history_state).toBe('complete');
    });

    it('pages through a single item’s own multi-page history, threading item_uid and cursor on every page', async () => {
      mockRoutes([
        activityPage([activityEntry({ ulid: 'p1' })], 'cursor-1'),
        activityPage([activityEntry({ ulid: 'p2' })], 'cursor-2'),
        activityPage([activityEntry({ ulid: 'p3' })], ''),
      ]);

      const result = await service.getFormationItemDetail(buildReq(), 'live-project-1', 'item-key-1');

      expect(result.history.map((entry) => entry.uid)).toEqual(['p1', 'p2', 'p3']);
      expect(result.history_state).toBe('complete');
      const activityCalls = proxyRequest.mock.calls.filter((c) => c[2] === '/formations/live-project-1/activity');
      expect(activityCalls).toHaveLength(3);
      expect(activityCalls[0][4]).toEqual({ limit: 100, item_uid: itemUid });
      expect(activityCalls[1][4]).toEqual({ limit: 100, item_uid: itemUid, cursor: 'cursor-1' });
      expect(activityCalls[2][4]).toEqual({ limit: 100, item_uid: itemUid, cursor: 'cursor-2' });
    });

    it('degrades to history_state unavailable when upstream returns a repeated cursor instead of looping forever', async () => {
      mockRoutes([activityPage([activityEntry({ ulid: 'p1' })], 'cursor-1'), activityPage([activityEntry({ ulid: 'p2' })], 'cursor-1')]);

      const result = await service.getFormationItemDetail(buildReq(), 'live-project-1', 'item-key-1');

      expect(result.item.template_item_key).toBe('item-key-1');
      expect(result.history).toEqual([]);
      expect(result.history_state).toBe('unavailable');
      expect(vi.mocked(logger.warning)).toHaveBeenCalled();
    });

    it('refuses an unfiltered activity fetch and degrades to unavailable when the item resolves with no uid', async () => {
      proxyRequest.mockImplementation((_req: Request, _service: string, path: string) => {
        if (path === '/formations/live-project-1') return Promise.resolve(checklist([rawItem({ uid: '' })]));
        throw new Error(`unexpected path: ${path}`);
      });

      const result = await service.getFormationItemDetail(buildReq(), 'live-project-1', 'item-key-1');

      expect(result.history).toEqual([]);
      expect(result.history_state).toBe('unavailable');
      expect(proxyRequest.mock.calls.some((c) => c[2] === '/formations/live-project-1/activity')).toBe(false);
      expect(vi.mocked(logger.warning)).toHaveBeenCalled();
    });

    it('degrades to history_state unavailable, item still returned, when the activity fetch rejects (500)', async () => {
      proxyRequest.mockImplementation((_req: Request, _service: string, path: string) => {
        if (path === '/formations/live-project-1') return Promise.resolve(checklist([rawItem()]));
        if (path === '/formations/live-project-1/activity') return Promise.reject(new Error('upstream unavailable'));
        throw new Error(`unexpected path: ${path}`);
      });

      const result = await service.getFormationItemDetail(buildReq(), 'live-project-1', 'item-key-1');

      expect(result.item.template_item_key).toBe('item-key-1');
      expect(result.history).toEqual([]);
      expect(result.history_state).toBe('unavailable');
      expect(vi.mocked(logger.warning)).toHaveBeenCalled();
    });

    it('degrades to history_state unavailable when a later page (not just page 1) of the activity fetch rejects', async () => {
      let call = 0;
      proxyRequest.mockImplementation((_req: Request, _service: string, path: string) => {
        if (path === '/formations/live-project-1') return Promise.resolve(checklist([rawItem()]));
        if (path === '/formations/live-project-1/activity') {
          call += 1;
          if (call === 1) return Promise.resolve(activityPage([activityEntry({ ulid: 'p1' })], 'cursor-1'));
          return Promise.reject(new Error('upstream unavailable on page 2'));
        }
        throw new Error(`unexpected path: ${path}`);
      });

      const result = await service.getFormationItemDetail(buildReq(), 'live-project-1', 'item-key-1');

      expect(result.item.template_item_key).toBe('item-key-1');
      expect(result.history).toEqual([]);
      expect(result.history_state).toBe('unavailable');
      expect(vi.mocked(logger.warning)).toHaveBeenCalled();
    });

    it('degrades to history_state unavailable on a 403 from the activity route, without masking the item as not-found', async () => {
      // The checklist pre-read (getFormationItemOrThrow) already proved project#auditor access on the
      // identical relation — a 403 here cannot mean "no access" that read didn't already catch, so the
      // item itself still renders; only history degrades.
      proxyRequest.mockImplementation((_req: Request, _service: string, path: string) => {
        if (path === '/formations/live-project-1') return Promise.resolve(checklist([rawItem()]));
        if (path === '/formations/live-project-1/activity') return Promise.reject(new MicroserviceError('forbidden', 403, 'FORBIDDEN'));
        throw new Error(`unexpected path: ${path}`);
      });

      const result = await service.getFormationItemDetail(buildReq(), 'live-project-1', 'item-key-1');

      expect(result.item.template_item_key).toBe('item-key-1');
      expect(result.history_state).toBe('unavailable');
    });

    it('treats a 404 from the activity route as an empty, complete history rather than an error state', async () => {
      // The checklist pre-read already vouched for this item's uid, so a 404 here cannot mean
      // "no such item" upstream's own design names as this route's other NotFound case — it degrades
      // to an empty page, not the red error banner `history_state: 'unavailable'` renders.
      proxyRequest.mockImplementation((_req: Request, _service: string, path: string) => {
        if (path === '/formations/live-project-1') return Promise.resolve(checklist([rawItem()]));
        if (path === '/formations/live-project-1/activity') return Promise.reject(new MicroserviceError('not found', 404, 'NOT_FOUND'));
        throw new Error(`unexpected path: ${path}`);
      });

      const result = await service.getFormationItemDetail(buildReq(), 'live-project-1', 'item-key-1');

      expect(result.item.template_item_key).toBe('item-key-1');
      expect(result.history).toEqual([]);
      expect(result.history_state).toBe('complete');
    });

    it('enriches activity actor.name with the display name from user metadata, replacing the username placeholder', async () => {
      mockRoutes([activityPage([activityEntry({ actor: 'sam.chen', set_by: 'user' })])]);
      natsRequest.mockImplementation(async (_subject: string, username: string) => {
        if (username === 'sam.chen') return { data: JSON.stringify({ success: true, data: { given_name: 'Sam', family_name: 'Chen' } }) };
        return { data: '' };
      });

      const result = await service.getFormationItemDetail(buildReq(), 'live-project-1', 'item-key-1');

      expect(result.history[0].actor).toEqual({ username: 'sam.chen', name: 'Sam Chen' });
    });

    it('leaves actor.name as "System" and skips metadata lookup when actor is the system sentinel', async () => {
      mockRoutes([activityPage([activityEntry({ actor: 'system', set_by: 'system' })])]);

      const result = await service.getFormationItemDetail(buildReq(), 'live-project-1', 'item-key-1');

      expect(result.history[0].actor).toEqual({ username: 'system', name: 'System' });
      // No NATS call should be issued for the system actor.
      expect(natsRequest).not.toHaveBeenCalled();
    });
  });

  describe('getFormationItemOrThrow — project-scoped read access', () => {
    it("resolves the item only after the caller's own bearer token can read the parent project", async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem()]));

      const result = await service.getFormationItemOrThrow(buildReq(), 'live-project-1', 'item-key-1');

      expect(result.template_item_key).toBe('item-key-1');
      expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_FORMATION_SERVICE', '/formations/live-project-1', 'GET');
    });

    it('denies with the same "not found" shape as a missing item key, rather than returning item data, for a project the caller cannot see', async () => {
      proxyRequest.mockRejectedValue(new MicroserviceError('forbidden', 403, 'FORBIDDEN'));

      await expect(service.getFormationItemOrThrow(buildReq(), 'live-project-1', 'item-key-1')).rejects.toThrow(/not found/i);
    });

    it('throws ResourceNotFoundError for an item key not present in the checklist', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem({ item_key: 'other-key' })]));

      await expect(service.getFormationItemOrThrow(buildReq(), 'live-project-1', 'item-key-1')).rejects.toThrow(/not found/i);
    });

    it('gives the same address the identical error message whether the item key is missing or the project is denied — no enumeration oracle', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem({ item_key: 'other-key' })]));
      const missing = await service.getFormationItemOrThrow(buildReq(), 'live-project-1', 'item-key-1').catch((error: Error) => error);

      proxyRequest.mockRejectedValue(new MicroserviceError('forbidden', 403, 'FORBIDDEN'));
      const denied = await service.getFormationItemOrThrow(buildReq(), 'live-project-1', 'item-key-1').catch((error: Error) => error);

      expect((missing as Error).message).toBe((denied as Error).message);
    });
  });

  describe('assertFormationMutable (GH-2328)', () => {
    it('resolves without throwing for a live formation', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem()]));

      await expect(service.assertFormationMutable(buildReq(), 'live-project-1')).resolves.toBeUndefined();
    });

    it.each(['completed', 'frozen', 'archived'])('throws ConflictError CHECKLIST_READ_ONLY for lifecycle %s', async (lifecycle) => {
      proxyRequest.mockResolvedValue(checklist([rawItem()], { lifecycle: lifecycle as UpstreamFormationChecklist['lifecycle'] }));

      const error = await service.assertFormationMutable(buildReq(), 'live-project-1').catch((e: Error) => e);

      const { ConflictError } = await import('../errors');
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as InstanceType<typeof ConflictError>).code).toBe('CHECKLIST_READ_ONLY');
      expect((error as InstanceType<typeof ConflictError>).statusCode).toBe(409);
    });

    it('reuses the same upstream fetch as getFormationItemOrThrow within one request (checklistByRequestCache)', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem()]));
      const req = buildReq();

      await service.getFormationItemOrThrow(req, 'live-project-1', 'item-key-1');
      await service.assertFormationMutable(req, 'live-project-1');

      const getCalls = proxyRequest.mock.calls.filter((c) => c[3] === 'GET');
      expect(getCalls.length).toBe(1);
    });

    it('issues a fresh fetch for a different request object, rather than leaking the cache across requests', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem()]));

      await service.assertFormationMutable(buildReq(), 'live-project-1');
      await service.assertFormationMutable(buildReq(), 'live-project-1');

      const getCalls = proxyRequest.mock.calls.filter((c) => c[3] === 'GET');
      expect(getCalls.length).toBe(2);
    });
  });

  describe('updateFormationItem (PATCH item — note/evidence_link, GH-2576 Phase 2)', () => {
    it('rejects when neither note nor evidence_link is provided', async () => {
      await expect(service.updateFormationItem(buildReq(), 'live-project-1', 'item-key-1', '1', {})).rejects.toThrow(/note|evidence_link/i);
      expect(proxyRequestWithResponse).not.toHaveBeenCalled();
    });

    it('rejects a non-http/https evidence_link', async () => {
      await expect(service.updateFormationItem(buildReq(), 'live-project-1', 'item-key-1', '1', { evidence_link: 'javascript:alert(1)' })).rejects.toThrow(
        /evidence_link/i
      );
      expect(proxyRequestWithResponse).not.toHaveBeenCalled();
    });

    it('does not re-read the item before writing — no upstream GET, only the PATCH', async () => {
      const item = rawItem({ status: 'in_progress', note: 'x', version: 5 });
      proxyRequestWithResponse.mockResolvedValue(writeResponse({ ...item, note: 'updated', version: 6 }, '6'));

      await service.updateFormationItem(buildReq(), 'live-project-1', 'item-key-1', '5', { note: 'updated' });

      expect(proxyRequest).not.toHaveBeenCalled();
      expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
    });

    it('sends the caller-supplied If-Match unquoted, never a re-read version', async () => {
      const item = rawItem({ status: 'in_progress', version: 5 });
      proxyRequestWithResponse.mockResolvedValue(writeResponse({ ...item, version: 6 }, '6'));

      await service.updateFormationItem(buildReq(), 'live-project-1', 'item-key-1', '5', { note: 'x' });

      const call = proxyRequestWithResponse.mock.calls[0];
      expect(call[2]).toBe('/formations/live-project-1/items/item-key-1');
      expect(call[3]).toBe('PATCH');
      expect(call[5]).toEqual({ note: 'x' });
      expect(call[6]).toEqual({ 'If-Match': '5' });
    });

    it('forwards note and evidence_link together when both are supplied', async () => {
      const item = rawItem({ status: 'in_progress', version: 1 });
      proxyRequestWithResponse.mockResolvedValue(writeResponse({ ...item, version: 2 }, '2'));

      await service.updateFormationItem(buildReq(), 'live-project-1', 'item-key-1', '1', { note: 'x', evidence_link: 'https://example.org/doc.pdf' });

      const call = proxyRequestWithResponse.mock.calls[0];
      expect(call[5]).toEqual({ note: 'x', evidence_link: 'https://example.org/doc.pdf' });
    });

    it('never calls the project-writer check the old PATCH route used — a caller with read-only access is not refused BFF-side', async () => {
      const item = rawItem({ status: 'in_progress', version: 1 });
      proxyRequestWithResponse.mockResolvedValue(writeResponse({ ...item, version: 2 }, '2'));

      await service.updateFormationItem(buildReq(), 'live-project-1', 'item-key-1', '1', { note: 'x' });

      // getProjectById is still called (by mapLiveItem's project-cached lookup for section/slug
      // context), but never with the write-access `true` flag the old assertItemProjectWriteAccess used.
      expect(getProjectById).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), true);
    });

    it('captures the etag from the upstream response header', async () => {
      const item = rawItem({ status: 'in_progress', version: 1 });
      proxyRequestWithResponse.mockResolvedValue(writeResponse({ ...item, version: 2 }, '2'));

      const result = await service.updateFormationItem(buildReq(), 'live-project-1', 'item-key-1', '1', { note: 'x' });

      expect(result.etag).toBe('2');
      expect(result.item.version).toBe(2);
    });

    it('degrades to a stale item rather than failing when the post-write project lookup fails (Cursor Bugbot, PR #2613)', async () => {
      // The write already succeeded and persisted upstream by the time mapLiveItem's own project
      // fetch runs — a failure there must not turn an already-successful write into an error response,
      // which would make the caller retry with a now-stale If-Match and 412 even though nothing was
      // actually lost. Mirrors fetchItemActivityOrDegrade's degrade-rather-than-fail shape (#2578).
      const item = rawItem({ status: 'in_progress', version: 1 });
      proxyRequestWithResponse.mockResolvedValue(writeResponse({ ...item, note: 'x', version: 2 }, '2'));
      getProjectById.mockRejectedValueOnce(new Error('project service unavailable'));

      const result = await service.updateFormationItem(buildReq(), 'live-project-1', 'item-key-1', '1', { note: 'x' });

      expect(result.item_state).toBe('stale');
      // version/etag — everything a caller's next write needs — come from the write's own response,
      // not from the failed remap, so they're unaffected by the degradation.
      expect(result.etag).toBe('2');
      expect(result.item.version).toBe(2);
    });

    it('maps a 412 to PreconditionFailedError, distinct from a 409 conflict', async () => {
      proxyRequestWithResponse.mockRejectedValue(
        new MicroserviceError('stale version', 412, 'PRECONDITION_FAILED', { errorBody: { message: 'version_mismatch' } })
      );

      const { PreconditionFailedError } = await import('../errors');
      await expect(service.updateFormationItem(buildReq(), 'live-project-1', 'item-key-1', '1', { note: 'x' })).rejects.toBeInstanceOf(PreconditionFailedError);
    });

    it('maps a genuinely-409 reason (checklist_read_only) to ConflictError with the reason uppercased as the code', async () => {
      proxyRequestWithResponse.mockRejectedValue(new MicroserviceError('read only', 409, 'CONFLICT', { errorBody: { reason: 'checklist_read_only' } }));

      const { ConflictError } = await import('../errors');
      const error = await service.updateFormationItem(buildReq(), 'live-project-1', 'item-key-1', '1', { note: 'x' }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictError);
      expect((error as InstanceType<typeof ConflictError>).code).toBe('CHECKLIST_READ_ONLY');
    });

    // `lfx-v2-formation-service` classifies link_scheme_invalid as ErrInvalidRequest (400), not
    // ErrConflict (409) — item_mutator.go's evidence_link validation. Bypasses this method's own
    // BFF-side scheme pre-check with a scheme it accepts (https) so the upstream 400 is what's
    // actually exercised, not the pre-check's 400.
    it('maps a 400 reason (link_scheme_invalid) to InvalidRequestError with the reason uppercased as the code', async () => {
      proxyRequestWithResponse.mockRejectedValue(new MicroserviceError('bad scheme', 400, 'BAD_REQUEST', { errorBody: { reason: 'link_scheme_invalid' } }));

      const { InvalidRequestError } = await import('../errors');
      const error = await service
        .updateFormationItem(buildReq(), 'live-project-1', 'item-key-1', '1', { evidence_link: 'https://example.org/x' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(InvalidRequestError);
      expect((error as InstanceType<typeof InvalidRequestError>).code).toBe('LINK_SCHEME_INVALID');
      expect((error as InstanceType<typeof InvalidRequestError>).statusCode).toBe(400);
    });

    it('degrades an unrecognized 409 reason to a generic conflict rather than throwing an unmapped error', async () => {
      proxyRequestWithResponse.mockRejectedValue(new MicroserviceError('mystery', 409, 'CONFLICT', { errorBody: { reason: 'some_future_reason' } }));

      const { ConflictError } = await import('../errors');
      const error = await service.updateFormationItem(buildReq(), 'live-project-1', 'item-key-1', '1', { note: 'x' }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictError);
      expect((error as InstanceType<typeof ConflictError>).code).toBe('SOME_FUTURE_REASON');
    });

    it('degrades an unrecognized 400 reason to a generic InvalidRequestError rather than throwing an unmapped error', async () => {
      proxyRequestWithResponse.mockRejectedValue(new MicroserviceError('mystery', 400, 'BAD_REQUEST', { errorBody: { reason: 'some_future_reason' } }));

      const { InvalidRequestError } = await import('../errors');
      const error = await service.updateFormationItem(buildReq(), 'live-project-1', 'item-key-1', '1', { note: 'x' }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(InvalidRequestError);
      expect((error as InstanceType<typeof InvalidRequestError>).code).toBe('SOME_FUTURE_REASON');
    });

    it('percent-encodes itemKey in the PATCH path template', async () => {
      const item = rawItem({ item_key: 'item key/weird', status: 'in_progress', version: 1 });
      proxyRequestWithResponse.mockResolvedValue(writeResponse({ ...item, version: 2 }, '2'));

      await service.updateFormationItem(buildReq(), 'live-project-1', 'item key/weird', '1', { note: 'x' });

      expect(proxyRequestWithResponse.mock.calls[0][2]).toBe(`/formations/live-project-1/items/${encodeURIComponent('item key/weird')}`);
    });
  });

  describe('updateFormationItemAssignment (POST assignment, GH-2576 Phase 2 — new route)', () => {
    it('rejects when neither assignee nor due_date is provided', async () => {
      await expect(service.updateFormationItemAssignment(buildReq(), 'live-project-1', 'item-key-1', '1', {})).rejects.toThrow(/assignee|due_date/i);
      expect(proxyRequestWithResponse).not.toHaveBeenCalled();
    });

    it('does not format-validate due_date — an empty string (clear) is forwarded as-is', async () => {
      const item = rawItem({ status: 'in_progress', version: 1 });
      proxyRequestWithResponse.mockResolvedValue(writeResponse({ ...item, due_date: null, version: 2 }, '2'));

      await service.updateFormationItemAssignment(buildReq(), 'live-project-1', 'item-key-1', '1', { due_date: '' });

      expect(proxyRequestWithResponse.mock.calls[0][5]).toEqual({ due_date: '' });
    });

    it('forwards a malformed non-empty due_date rather than rejecting it BFF-side — that is due_date_invalid to catch', async () => {
      const item = rawItem({ status: 'in_progress', version: 1 });
      proxyRequestWithResponse.mockResolvedValue(writeResponse({ ...item, version: 2 }, '2'));

      await service.updateFormationItemAssignment(buildReq(), 'live-project-1', 'item-key-1', '1', { due_date: 'not-a-date' });

      expect(proxyRequestWithResponse.mock.calls[0][5]).toEqual({ due_date: 'not-a-date' });
    });

    it('sends the caller-supplied If-Match to the assignment route', async () => {
      const item = rawItem({ status: 'in_progress', version: 3 });
      proxyRequestWithResponse.mockResolvedValue(writeResponse({ ...item, version: 4 }, '4'));

      await service.updateFormationItemAssignment(buildReq(), 'live-project-1', 'item-key-1', '3', { assignee: 'sam.chen' });

      const call = proxyRequestWithResponse.mock.calls[0];
      expect(call[2]).toBe('/formations/live-project-1/items/item-key-1/assignment');
      expect(call[3]).toBe('POST');
      expect(call[6]).toEqual({ 'If-Match': '3' });
    });

    // assignee_not_on_project is ErrInvalidRequest (400) upstream (assignment.go), without any
    // BFF-side pre-validation (out of scope — #2594).
    it('passes assignee_not_on_project through as InvalidRequestError, without any BFF-side pre-validation (out of scope — #2594)', async () => {
      proxyRequestWithResponse.mockRejectedValue(
        new MicroserviceError('not on project', 400, 'BAD_REQUEST', { errorBody: { reason: 'assignee_not_on_project' } })
      );

      const { InvalidRequestError } = await import('../errors');
      const error = await service
        .updateFormationItemAssignment(buildReq(), 'live-project-1', 'item-key-1', '1', { assignee: 'not-on-project' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(InvalidRequestError);
      expect((error as InstanceType<typeof InvalidRequestError>).code).toBe('ASSIGNEE_NOT_ON_PROJECT');
    });

    it('clears assignee with an empty string', async () => {
      const item = rawItem({ status: 'in_progress', version: 1 });
      proxyRequestWithResponse.mockResolvedValue(writeResponse({ ...item, assignee: null, version: 2 }, '2'));

      await service.updateFormationItemAssignment(buildReq(), 'live-project-1', 'item-key-1', '1', { assignee: '' });

      expect(proxyRequestWithResponse.mock.calls[0][5]).toEqual({ assignee: '' });
    });
  });

  describe('updateFormationItemStatus (POST status, GH-2576 Phase 2)', () => {
    it('rejects an invalid status value', async () => {
      await expect(service.updateFormationItemStatus(buildReq(), 'live-project-1', 'item-key-1', '1', { status: 'awaiting_acceptance' })).rejects.toThrow(
        /status/i
      );
      expect(proxyRequestWithResponse).not.toHaveBeenCalled();
    });

    it('rejects when neither status nor sub_items is provided', async () => {
      await expect(service.updateFormationItemStatus(buildReq(), 'live-project-1', 'item-key-1', '1', {})).rejects.toThrow(/status|sub_items/i);
      expect(proxyRequestWithResponse).not.toHaveBeenCalled();
    });

    it('accepts all five real status values', async () => {
      const item = rawItem({ status: 'not_started', version: 1 });
      for (const status of ['not_started', 'in_progress', 'blocked', 'done', 'skipped'] as const) {
        proxyRequestWithResponse.mockResolvedValue(writeResponse({ ...item, status, version: 2 }, '2'));
        await expect(service.updateFormationItemStatus(buildReq(), 'live-project-1', 'item-key-1', '1', { status })).resolves.toMatchObject({
          item: { status },
        });
      }
    });

    it("does not duplicate upstream's transition graph — an unusual transition is forwarded, not preempted", async () => {
      const item = rawItem({ status: 'done', version: 1 });
      proxyRequestWithResponse.mockResolvedValue(writeResponse({ ...item, status: 'blocked', version: 2 }, '2'));

      // done -> blocked is not a real transition upstream, but this BFF no longer maintains its own
      // copy of the graph to preempt it — it forwards the request and lets upstream answer.
      await expect(service.updateFormationItemStatus(buildReq(), 'live-project-1', 'item-key-1', '1', { status: 'blocked' })).resolves.toBeDefined();
      expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
    });

    it('forwards reason and sub_items alongside status', async () => {
      const item = rawItem({ status: 'in_progress', version: 1 });
      proxyRequestWithResponse.mockResolvedValue(writeResponse({ ...item, status: 'blocked', version: 2 }, '2'));

      await service.updateFormationItemStatus(buildReq(), 'live-project-1', 'item-key-1', '1', {
        status: 'blocked',
        reason: 'waiting on legal',
        sub_items: [{ key: 'sub-1', status: 'done' }],
      });

      expect(proxyRequestWithResponse.mock.calls[0][5]).toEqual({
        status: 'blocked',
        reason: 'waiting on legal',
        sub_items: [{ key: 'sub-1', status: 'done' }],
      });
    });

    it('does not log the reason text on the general application logger', async () => {
      const item = rawItem({ status: 'in_progress', version: 1 });
      proxyRequestWithResponse.mockResolvedValue(writeResponse({ ...item, status: 'blocked', version: 2 }, '2'));

      await service.updateFormationItemStatus(buildReq(), 'live-project-1', 'item-key-1', '1', {
        status: 'blocked',
        reason: 'a sensitive blocking justification',
      });

      const infoCalls = vi.mocked(logger.info).mock.calls;
      // Anchor on the call actually existing — otherwise a logger.info() that fired zero times would
      // pass this assertion too, which defeats the point of the test.
      expect(infoCalls.some((call) => call[1] === 'update_formation_item_status')).toBe(true);
      expect(infoCalls.some((call) => JSON.stringify(call).includes('a sensitive blocking justification'))).toBe(false);
    });

    // blocked_reason_required is ErrInvalidRequest (400) upstream (item_status.go's
    // statusesNeedingReason), not a BFF pre-check thrown before the request reaches upstream.
    it('maps an upstream reason requiring a reason (blocked_reason_required) to InvalidRequestError, not a BFF-invented 400', async () => {
      proxyRequestWithResponse.mockRejectedValue(
        new MicroserviceError('reason required', 400, 'BAD_REQUEST', { errorBody: { reason: 'blocked_reason_required' } })
      );

      const { InvalidRequestError } = await import('../errors');
      const error = await service.updateFormationItemStatus(buildReq(), 'live-project-1', 'item-key-1', '1', { status: 'blocked' }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(InvalidRequestError);
      expect((error as InstanceType<typeof InvalidRequestError>).code).toBe('BLOCKED_REASON_REQUIRED');
      expect((error as InstanceType<typeof InvalidRequestError>).statusCode).toBe(400);
    });

    it('sends POST (not PATCH) to the status route with the caller-supplied If-Match', async () => {
      const item = rawItem({ status: 'in_progress', version: 7 });
      proxyRequestWithResponse.mockResolvedValue(writeResponse({ ...item, status: 'done', version: 8 }, '8'));

      await service.updateFormationItemStatus(buildReq(), 'live-project-1', 'item-key-1', '7', { status: 'done' });

      const call = proxyRequestWithResponse.mock.calls[0];
      expect(call[2]).toBe('/formations/live-project-1/items/item-key-1/status');
      expect(call[3]).toBe('POST');
      expect(call[6]).toEqual({ 'If-Match': '7' });
    });

    // The gateway's set_item_status rule refuses with an empty-bodied 403 when either half of its
    // writer_guard + team:formation pair fails — bare "Forbidden" explains nothing to the caller
    // (GH-2705). Status route only: a 403 on assignment/PATCH means a different guard failed.
    it('maps a gateway 403 on the status route to AuthorizationError FORMATION_TEAM_REQUIRED with an explanatory message', async () => {
      proxyRequestWithResponse.mockRejectedValue(new MicroserviceError('Forbidden', 403, 'FORBIDDEN'));

      const { AuthorizationError } = await import('../errors');
      const error = await service.updateFormationItemStatus(buildReq(), 'live-project-1', 'item-key-1', '1', { status: 'done' }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(AuthorizationError);
      expect((error as InstanceType<typeof AuthorizationError>).code).toBe('FORMATION_TEAM_REQUIRED');
      expect((error as InstanceType<typeof AuthorizationError>).statusCode).toBe(403);
      expect((error as InstanceType<typeof AuthorizationError>).message).toMatch(/formation team/i);
    });
  });

  describe('getFormationsQueue', () => {
    it('propagates a failOnPartial pagination failure instead of returning partial rows', async () => {
      const row: UpstreamFormationQueueRow = {
        formation_uid: 'formation:live-project-1',
        project_uid: 'live-project-1',
        project_name: 'Live Project',
        project_slug: 'live-project',
        is_foundation: false,
        parent_uid: null,
        sub_stage: 'Formation - Engaged',
        lifecycle: 'live',
        gates_cleared: false,
        is_activating: false,
        announcement_date: null,
        progress: {},
        blocked_item_titles: [],
        assignees: [],
      };
      proxyRequest
        .mockResolvedValueOnce({
          resources: [{ type: 'formation', id: row.formation_uid, data: row }],
          page_token: 'next-page',
        } satisfies QueryServiceResponse<UpstreamFormationQueueRow>)
        .mockRejectedValueOnce(new Error('query service unavailable'));

      await expect(service.getFormationsQueue(buildReq())).rejects.toThrow(/query service unavailable/);
    });

    it('defaults a row missing progress/assignees/blocked_item_titles/announcement_date instead of throwing', async () => {
      const row: Partial<UpstreamFormationQueueRow> = {
        formation_uid: 'formation:live-project-1',
        project_uid: 'live-project-1',
        project_name: 'Live Project',
        project_slug: 'live-project',
        is_foundation: false,
        parent_uid: '',
        sub_stage: 'Formation - Engaged',
        lifecycle: 'live',
        gates_cleared: false,
        is_activating: false,
      };
      proxyRequest.mockResolvedValue({
        resources: [{ type: 'formation', id: 'formation:live-project-1', data: row }],
      } satisfies QueryServiceResponse<Partial<UpstreamFormationQueueRow>>);

      const result = await service.getFormationsQueue(buildReq());

      expect(result.rows[0].parent_uid).toBeNull();
      expect(result.rows[0].announcement_date).toBeNull();
      expect(result.rows[0].progress).toEqual({});
      expect(result.rows[0].blocked_item_titles).toEqual([]);
      expect(result.rows[0].assignees).toEqual([]);
    });

    it('normalizes a malformed row missing sub_stage entirely to null/empty, not a throw (GH-2366)', async () => {
      const row: Partial<UpstreamFormationQueueRow> = {
        formation_uid: 'formation:live-project-1',
        project_uid: 'live-project-1',
        project_name: 'Live Project',
        project_slug: 'live-project',
        is_foundation: false,
        parent_uid: '',
        lifecycle: 'live',
        gates_cleared: false,
        is_activating: false,
      };
      proxyRequest.mockResolvedValue({
        resources: [{ type: 'formation', id: 'formation:live-project-1', data: row }],
      } satisfies QueryServiceResponse<Partial<UpstreamFormationQueueRow>>);

      const result = await service.getFormationsQueue(buildReq());

      expect(result.rows[0].sub_stage).toBeNull();
      expect(result.rows[0].sub_stage_raw).toBe('');
      expect(result.tiles.unmapped).toBe(1);
    });

    it('reads from the query service, collapses ROOT into null, filters by sub_stage/search, and rolls up tiles', async () => {
      const rowA: UpstreamFormationQueueRow = {
        formation_uid: 'formation:live-project-1',
        project_uid: 'live-project-1',
        project_name: 'Live Project',
        project_slug: 'live-project',
        is_foundation: false,
        parent_uid: null,
        sub_stage: 'Formation - Engaged',
        lifecycle: 'live',
        gates_cleared: false,
        is_activating: false,
        announcement_date: null,
        progress: {},
        blocked_item_titles: [],
        assignees: [],
      };
      const rowB: UpstreamFormationQueueRow = {
        ...rowA,
        formation_uid: 'formation:live-project-2',
        project_uid: 'live-project-2',
        project_name: 'Cascade Systems',
        sub_stage: 'Formation - On Hold',
      };
      proxyRequest.mockResolvedValue({
        resources: [
          { type: 'formation', id: rowA.formation_uid, data: rowA },
          { type: 'formation', id: rowB.formation_uid, data: rowB },
        ],
      } satisfies QueryServiceResponse<UpstreamFormationQueueRow>);

      const all = await service.getFormationsQueue(buildReq());
      expect(all.rows).toHaveLength(2);
      expect(all.tiles.total).toBe(2);
      expect(all.tiles.foundations + all.tiles.projects).toBe(all.tiles.total);
      expect(deriveFormationEntityType(rowA)).toBeDefined();

      const bySubStage = await service.getFormationsQueue(buildReq(), 'engaged');
      expect(bySubStage.rows).toHaveLength(1);
      expect(bySubStage.rows[0].project_uid).toBe('live-project-1');

      const bySearch = await service.getFormationsQueue(buildReq(), undefined, 'CASCADE');
      expect(bySearch.rows).toHaveLength(1);
      expect(bySearch.rows[0].project_uid).toBe('live-project-2');
    });

    it('normalizes every production sub_stage value (GH-2366), including the three that have no queue-taxonomy equivalent', async () => {
      const baseRow: UpstreamFormationQueueRow = {
        formation_uid: 'formation:p',
        project_uid: 'p',
        project_name: 'P',
        project_slug: 'p',
        is_foundation: false,
        parent_uid: null,
        sub_stage: 'Formation - Exploratory',
        lifecycle: 'live',
        gates_cleared: false,
        is_activating: false,
        announcement_date: null,
        progress: {},
        blocked_item_titles: [],
        assignees: [],
      };
      // `Active` is dropped from the queue entirely (LFXV2-3386) — see the dedicated exclusion
      // test below; the two unmapped survivors here are Disengaged + the unrecognized stage.
      const rawSubStages = ['Formation - Exploratory', 'Formation - Engaged', 'Formation - On Hold', 'Formation - Disengaged', 'Active', 'not-a-real-stage'];
      const rows = rawSubStages.map((rawSubStage, i) => ({
        ...baseRow,
        formation_uid: `formation:p${i}`,
        project_uid: `p${i}`,
        sub_stage: rawSubStage,
      }));
      proxyRequest.mockResolvedValue({
        resources: rows.map((row) => ({ type: 'formation', id: row.formation_uid, data: row })),
      } satisfies QueryServiceResponse<UpstreamFormationQueueRow>);

      const result = await service.getFormationsQueue(buildReq());

      expect(result.rows.map((row) => row.sub_stage)).toEqual(['exploratory', 'engaged', 'on_hold', null, null]);
      expect(result.rows.map((row) => row.sub_stage_raw)).toEqual(rawSubStages.filter((stage) => stage !== 'Active'));
      expect(result.tiles).toMatchObject({ exploratory: 1, engaged: 1, on_hold: 1, unmapped: 2, total: 5 });

      // An unmapped row is never counted in a stage filter — same as `null !== 'engaged'`.
      const engagedOnly = await service.getFormationsQueue(buildReq(), 'engaged');
      expect(engagedOnly.rows).toHaveLength(1);
      expect(engagedOnly.rows[0].project_uid).toBe('p1');
      // Tiles stay scoped to the full queue even when `rows` is narrowed by the subStage filter —
      // `buildQueueTilesFromRows` runs on `inFormationRows`, before filtering (formation.service.ts).
      expect(engagedOnly.tiles).toMatchObject({ exploratory: 1, engaged: 1, on_hold: 1, unmapped: 2, total: 5 });
    });

    // LFXV2-3386: a project that completed (or was retired from) Formation is dropped from the
    // queue's rows AND tiles — but only via the named Active/Archived deny-list: Disengaged,
    // unknown stages (GH-2366 fail-open), and gates-cleared rows still in `Formation - *` all stay.
    it('excludes post-Formation (Active/Archived) rows from rows and tiles, keeping gates-cleared and unknown-stage rows', async () => {
      const baseRow: UpstreamFormationQueueRow = {
        formation_uid: 'formation:p',
        project_uid: 'p',
        project_name: 'P',
        project_slug: 'p',
        is_foundation: false,
        parent_uid: null,
        sub_stage: 'Formation - Engaged',
        lifecycle: 'live',
        gates_cleared: false,
        is_activating: false,
        announcement_date: null,
        progress: {},
        blocked_item_titles: [],
        assignees: [],
      };
      const rows: UpstreamFormationQueueRow[] = [
        { ...baseRow, formation_uid: 'formation:active', project_uid: 'active', sub_stage: 'Active' },
        { ...baseRow, formation_uid: 'formation:archived', project_uid: 'archived', sub_stage: 'Archived' },
        { ...baseRow, formation_uid: 'formation:ready', project_uid: 'ready', gates_cleared: true, is_activating: true },
        { ...baseRow, formation_uid: 'formation:unknown', project_uid: 'unknown', sub_stage: 'not-a-real-stage' },
      ];
      proxyRequest.mockResolvedValue({
        resources: rows.map((row) => ({ type: 'formation', id: row.formation_uid, data: row })),
      } satisfies QueryServiceResponse<UpstreamFormationQueueRow>);

      const result = await service.getFormationsQueue(buildReq());

      expect(result.rows.map((row) => row.project_uid)).toEqual(['ready', 'unknown']);
      expect(result.rows.find((row) => row.project_uid === 'ready')?.gates_cleared).toBe(true);
      expect(result.tiles).toMatchObject({ engaged: 1, unmapped: 1, total: 2, foundations: 0, projects: 2 });
    });

    // GH-2367: scope the queue to the selected foundation via query-service's `parent` param.
    describe('foundation scoping (GH-2367)', () => {
      const rowA: UpstreamFormationQueueRow = {
        formation_uid: 'formation:live-project-1',
        project_uid: 'live-project-1',
        project_name: 'Live Project',
        project_slug: 'live-project',
        is_foundation: false,
        parent_uid: null,
        sub_stage: 'Formation - Engaged',
        lifecycle: 'live',
        gates_cleared: false,
        is_activating: false,
        announcement_date: null,
        progress: {},
        blocked_item_titles: [],
        assignees: [],
      };
      const rowB: UpstreamFormationQueueRow = {
        ...rowA,
        formation_uid: 'formation:live-project-2',
        project_uid: 'live-project-2',
        project_name: 'Cascade Systems',
        sub_stage: 'Formation - On Hold',
      };

      beforeEach(() => {
        proxyRequest.mockResolvedValue({
          resources: [
            { type: 'formation', id: rowA.formation_uid, data: rowA },
            { type: 'formation', id: rowB.formation_uid, data: rowB },
          ],
        } satisfies QueryServiceResponse<UpstreamFormationQueueRow>);
      });

      it('sends no `parent` param when no foundation is selected', async () => {
        await service.getFormationsQueue(buildReq());

        const call = proxyRequest.mock.calls.find((c) => c[2] === '/query/resources');
        expect(call).toBeDefined();
        const params = call?.[4] as Record<string, unknown>;
        expect(params).not.toHaveProperty('parent');
        expect(params).toMatchObject({ type: 'formation' });
      });

      it('sends `parent: project:<uid>` exactly when a foundation is selected', async () => {
        await service.getFormationsQueue(buildReq(), undefined, undefined, 'aaif-uid-1');

        const call = proxyRequest.mock.calls.find((c) => c[2] === '/query/resources');
        const params = call?.[4] as Record<string, unknown>;
        expect(params).toMatchObject({ type: 'formation', parent: 'project:aaif-uid-1' });
      });

      it('counts tiles over the foundation-scoped rows, not a global set', async () => {
        proxyRequest.mockResolvedValue({
          resources: [{ type: 'formation', id: rowA.formation_uid, data: rowA }],
        } satisfies QueryServiceResponse<UpstreamFormationQueueRow>);

        const result = await service.getFormationsQueue(buildReq(), undefined, undefined, 'aaif-uid-1');
        expect(result.tiles.total).toBe(1);
      });

      it('still applies subStage/search to rows without affecting tiles, with a foundation selected', async () => {
        const result = await service.getFormationsQueue(buildReq(), 'engaged', undefined, 'aaif-uid-1');

        expect(result.tiles.total).toBe(2);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].project_uid).toBe('live-project-1');
      });

      it('still propagates failOnPartial with a foundation selected', async () => {
        proxyRequest
          .mockResolvedValueOnce({
            resources: [{ type: 'formation', id: rowA.formation_uid, data: rowA }],
            page_token: 'next-page',
          } satisfies QueryServiceResponse<UpstreamFormationQueueRow>)
          .mockRejectedValueOnce(new Error('query service unavailable'));

        await expect(service.getFormationsQueue(buildReq(), undefined, undefined, 'aaif-uid-1')).rejects.toThrow(/query service unavailable/);
      });

      // GH-2378/GH-2699: the route always seeds a `foundation_uid`, and the seeded value on the
      // default landing is the LF umbrella foundation `tlf`'s uid (NavigationService's default
      // selection) — *not* the hidden NATS ROOT sentinel. `tlf`'s *immediate* children are only a
      // handful of formations, so the `parent` filter must not be sent when the selected foundation
      // is `tlf` itself (GH-2378); instead the BFF partitions the fetch-all result to parentless
      // rows plus tlf's direct children (GH-2699). Most tests here mock `natsRequest` to answer
      // both `resolveRootProjectUid` (ROOT sentinel) and `resolveLfFoundationRootUid` (`tlf`)
      // identically, since they only need one resolved uid to exercise the `foundationUid`
      // comparison; the partition tests route by slug to give the two lookups distinct outcomes.
      describe('when the selected foundation is the LF umbrella foundation (tlf)', () => {
        it('sends no `parent` param when `foundationUid` is the tlf uid', async () => {
          natsRequest.mockResolvedValue({ data: 'tlf-uid-1' });

          await service.getFormationsQueue(buildReq(), undefined, undefined, 'tlf-uid-1');

          const call = proxyRequest.mock.calls.find((c) => c[2] === '/query/resources');
          const params = call?.[4] as Record<string, unknown>;
          expect(params).not.toHaveProperty('parent');
          expect(params).toMatchObject({ type: 'formation' });
        });

        it("partitions the fetch-all result to parentless rows and tlf's direct children (GH-2699)", async () => {
          // Distinct uids for the two slug lookups, routed by the identity-codec payload: the ROOT
          // sentinel collapse and the tlf partition are different comparisons and must not share a
          // value here, or a sentinel-parented fixture couldn't be told apart from a tlf child.
          natsRequest.mockImplementation(async (_subject: unknown, slug: unknown) => ({ data: slug === ROOT_PROJECT_SLUG ? 'root-uid-1' : 'tlf-uid-1' }));
          const rowRootParented: UpstreamFormationQueueRow = { ...rowA, parent_uid: 'root-uid-1' };
          const rowTlfChild: UpstreamFormationQueueRow = {
            ...rowB,
            formation_uid: 'formation:tlf-child-1',
            project_uid: 'tlf-child-1',
            project_name: 'Umbrella Child Fixture',
            parent_uid: 'tlf-uid-1',
          };
          const rowForeignChild: UpstreamFormationQueueRow = {
            ...rowA,
            formation_uid: 'formation:foreign-child-1',
            project_uid: 'foreign-child-1',
            project_name: 'Foreign Child Fixture',
            parent_uid: 'aaif-uid-1',
          };
          proxyRequest.mockResolvedValue({
            resources: [
              { type: 'formation', id: rowRootParented.formation_uid, data: rowRootParented },
              { type: 'formation', id: rowTlfChild.formation_uid, data: rowTlfChild },
              { type: 'formation', id: rowForeignChild.formation_uid, data: rowForeignChild },
            ],
          } satisfies QueryServiceResponse<UpstreamFormationQueueRow>);

          const result = await service.getFormationsQueue(buildReq(), undefined, undefined, 'tlf-uid-1');

          // The fetch stays unfiltered (no `parent` param); the partition is the BFF's. The
          // ROOT-parented row survives via the ROOT→null collapse, the tlf child via the
          // direct-parent match; the other foundation's child renders under that foundation only.
          const params = (proxyRequest.mock.calls.find((c) => c[2] === '/query/resources')?.[4] ?? {}) as Record<string, unknown>;
          expect(params).not.toHaveProperty('parent');
          expect(result.rows.map((row) => row.project_uid)).toEqual(['live-project-1', 'tlf-child-1']);
          expect(result.tiles).toMatchObject({ engaged: 1, on_hold: 1, total: 2 });
        });

        it('warns and excludes sentinel-parented rows when the ROOT sentinel cannot be resolved under LF root scope', async () => {
          // ROOT lookup fails (empty → null, never cached) while tlf resolves: without the
          // sentinel, collapseRootParentUid leaves the raw sentinel parent_uid in place, so the
          // parentless bucket fails both partition arms and drops out of the LF view — the
          // warning is the only signal of that under-report.
          natsRequest.mockImplementation(async (_subject: unknown, slug: unknown) => ({ data: slug === ROOT_PROJECT_SLUG ? '' : 'tlf-uid-1' }));
          const rowSentinelParented: UpstreamFormationQueueRow = { ...rowA, parent_uid: 'root-uid-1' };
          const rowTlfChild: UpstreamFormationQueueRow = {
            ...rowB,
            formation_uid: 'formation:tlf-child-1',
            project_uid: 'tlf-child-1',
            project_name: 'Umbrella Child Fixture',
            parent_uid: 'tlf-uid-1',
          };
          proxyRequest.mockResolvedValue({
            resources: [
              { type: 'formation', id: rowSentinelParented.formation_uid, data: rowSentinelParented },
              { type: 'formation', id: rowTlfChild.formation_uid, data: rowTlfChild },
            ],
          } satisfies QueryServiceResponse<UpstreamFormationQueueRow>);

          const result = await service.getFormationsQueue(buildReq(), undefined, undefined, 'tlf-uid-1');

          expect(result.rows.map((row) => row.project_uid)).toEqual(['tlf-child-1']);
          expect(vi.mocked(logger.warning)).toHaveBeenCalledWith(
            expect.anything(),
            'get_formations_queue',
            expect.stringContaining('ROOT sentinel uid unresolved'),
            { foundationUid: 'tlf-uid-1' }
          );
        });

        it('still sends `parent` when the tlf uid cannot be resolved (fail-safe)', async () => {
          // Default beforeEach mock: natsRequest resolves to `{ data: '' }`, so
          // resolveLfFoundationRootUid returns null. Falling back to sending `parent` as given
          // keeps an ordinary foundation correct; when the uid really was tlf, GH-2368's ancestry
          // chain means this shows the wide subtree view until the transient lookup failure clears
          // (a null is never cached) — warned, as asserted below.
          await service.getFormationsQueue(buildReq(), undefined, undefined, 'tlf-uid-1');

          const call = proxyRequest.mock.calls.find((c) => c[2] === '/query/resources');
          const params = call?.[4] as Record<string, unknown>;
          expect(params).toMatchObject({ type: 'formation', parent: 'project:tlf-uid-1' });
          expect(vi.mocked(logger.warning)).toHaveBeenCalledWith(
            expect.anything(),
            'get_formations_queue',
            expect.stringContaining('LF foundation root uid unresolved'),
            { foundationUid: 'tlf-uid-1' }
          );
        });

        it('still sends `parent: project:<uid>` for an ordinary (non-root) foundation once a tlf uid is resolved', async () => {
          natsRequest.mockResolvedValue({ data: 'tlf-uid-1' });

          await service.getFormationsQueue(buildReq(), undefined, undefined, 'aaif-uid-1');

          const call = proxyRequest.mock.calls.find((c) => c[2] === '/query/resources');
          const params = call?.[4] as Record<string, unknown>;
          expect(params).toMatchObject({ type: 'formation', parent: 'project:aaif-uid-1' });
        });
      });
    });
  });

  describe('getMyFormationWork (GH-1956)', () => {
    /** Routes `proxyRequest` by `type` so item-query and formation-query mocks stay independent of call order. */
    function mockQueryResources(itemRows: UpstreamFormationItemRow[], formationRows: UpstreamFormationQueueRow[]): void {
      proxyRequest.mockImplementation((...args: unknown[]) => {
        const params = args[4] as { type: string };
        if (params.type === 'formation_item') {
          return Promise.resolve({ resources: itemRows.map((row) => ({ type: 'formation_item', id: row.object_id, data: row })) });
        }
        return Promise.resolve({ resources: formationRows.map((row) => ({ type: 'formation', id: row.formation_uid, data: row })) });
      });
    }

    it('queries the item index by assignee tag, stripping an auth-provider-prefixed username first', async () => {
      // At least one live item, so the formation-aggregate query actually fires — see the
      // dedicated "no assigned live items" test below for the early-return path.
      mockQueryResources([itemIndexRow({ object_id: 'item-1' })], [formationIndexRow()]);

      await service.getMyFormationWork(buildReq(), 'auth0|alice');

      const itemCall = proxyRequest.mock.calls.find((c) => (c[4] as { type: string }).type === 'formation_item');
      const formationCall = proxyRequest.mock.calls.find((c) => (c[4] as { type: string }).type === 'formation');
      expect(itemCall?.[4]).toMatchObject({ type: 'formation_item', tags_all: ['assignee:alice', 'lifecycle:live'] });
      expect(formationCall?.[4]).toMatchObject({ type: 'formation', tags_all: ['assignee:alice', 'lifecycle:live'] });
    });

    it('returns a complete empty result and skips the formation-aggregate query entirely when the caller has no assigned live items', async () => {
      mockQueryResources([], []);

      const result = await service.getMyFormationWork(buildReq(), 'alice');

      expect(result).toEqual({ formations: [], items: [], state: 'complete' });
      expect(proxyRequest.mock.calls.find((c) => (c[4] as { type: string }).type === 'formation')).toBeUndefined();
      expect(getProjectById).not.toHaveBeenCalled();
    });

    it('builds items[] from open, live-checklist items only, mapping can_write, and reports state complete', async () => {
      getProjectById.mockResolvedValue({ slug: 'live-project', name: 'Live Project', parent_uid: null, writer: true });
      mockQueryResources(
        [
          itemIndexRow({ object_id: 'item-open', status: 'in_progress', gate: true }),
          itemIndexRow({ object_id: 'item-done', status: 'done' }),
          itemIndexRow({ object_id: 'item-skipped', status: 'skipped' }),
          itemIndexRow({ object_id: 'item-completed-checklist', status: 'not_started', lifecycle: 'completed' }),
        ],
        [formationIndexRow({ progress: { in_progress: 1, done: 1, skipped: 1, not_started: 1 } })]
      );

      const result = await service.getMyFormationWork(buildReq(), 'alice');

      expect(result.state).toBe('complete');
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        item_uid: 'item-open',
        project_uid: 'live-project-1',
        status: 'in_progress',
        is_gating: true,
        can_write: true,
      });

      // The item on a completed checklist must not leak into formations[]'s bucket counts either —
      // items[] and formations[] apply the same lifecycle gate, not two independently-drifting ones.
      expect(result.formations[0]).toMatchObject({ assigned_to_do: 1, assigned_done: 1, assigned_skipped: 1 });
    });

    it('never returns an item/formation from a non-live checklist even if the lifecycle:live tag is somehow ignored upstream (client-side backstop)', async () => {
      mockQueryResources(
        [itemIndexRow({ object_id: 'item-completed', status: 'not_started', lifecycle: 'completed', formation_uid: 'formation:completed-project' })],
        [formationIndexRow({ formation_uid: 'formation:completed-project', lifecycle: 'completed' })]
      );

      const result = await service.getMyFormationWork(buildReq(), 'alice');

      expect(result.items).toEqual([]);
      expect(result.formations).toEqual([]);
    });

    // #2732: the `assignee:` tag is the primary filter; this backstop guarantees that a tag-matching
    // or projection defect can never surface someone else's (or an unassigned) item on a caller's
    // dashboard — Pending Actions lists only items assigned to the signed-in user.
    it('never returns an index row assigned to someone else, or unassigned, even if the assignee tag is somehow ignored upstream (client-side backstop)', async () => {
      getProjectById.mockResolvedValue({ slug: 'live-project', name: 'Live Project', parent_uid: null, writer: false });
      mockQueryResources(
        [
          itemIndexRow({ object_id: 'item-mine', assignee: 'alice' }),
          itemIndexRow({ object_id: 'item-theirs', assignee: 'bob' }),
          itemIndexRow({ object_id: 'item-unassigned', assignee: undefined }),
        ],
        [formationIndexRow({ progress: { not_started: 3 } })]
      );

      const result = await service.getMyFormationWork(buildReq(), 'auth0|alice');

      expect(result.items.map((item) => item.item_uid)).toEqual(['item-mine']);
      expect(result.formations[0]).toMatchObject({ assigned_to_do: 1, assigned_done: 0, assigned_skipped: 0 });
      // A drop means the upstream tag or projection misbehaved — surfaced at WARN, not buried at DEBUG.
      expect(vi.mocked(logger.warning)).toHaveBeenCalledWith(
        expect.anything(),
        'get_my_formation_work',
        expect.stringContaining('not assigned to the caller'),
        { dropped: 2 }
      );
    });

    it('returns a complete empty result, skipping the formation-aggregate query, when every returned row belongs to someone else', async () => {
      mockQueryResources([itemIndexRow({ object_id: 'item-theirs', assignee: 'bob' })], [formationIndexRow()]);

      const result = await service.getMyFormationWork(buildReq(), 'alice');

      expect(result).toEqual({ formations: [], items: [], state: 'complete' });
      expect(proxyRequest.mock.calls.find((c) => (c[4] as { type: string }).type === 'formation')).toBeUndefined();
      expect(getProjectById).not.toHaveBeenCalled();
      // A total drop is the loudest case, not a silent one: the WARN is gated on any mismatch, so
      // zero survivors out of a non-empty tag match still logs the full count (#2734 review).
      expect(vi.mocked(logger.warning)).toHaveBeenCalledWith(
        expect.anything(),
        'get_my_formation_work',
        expect.stringContaining('not assigned to the caller'),
        { dropped: 1 }
      );
    });

    it('keeps a blocked item in items[] — isAssignedItemOpen treats every non-terminal status as still open', async () => {
      mockQueryResources([itemIndexRow({ object_id: 'item-blocked', status: 'blocked' })], [formationIndexRow()]);

      const result = await service.getMyFormationWork(buildReq(), 'alice');

      expect(result.items.map((item) => item.item_uid)).toEqual(['item-blocked']);
    });

    it('resolves can_write once per distinct project_uid, not once per item', async () => {
      getProjectById.mockResolvedValue({ slug: 'live-project', name: 'Live Project', parent_uid: null, writer: false });
      mockQueryResources(
        [itemIndexRow({ object_id: 'item-1', status: 'not_started' }), itemIndexRow({ object_id: 'item-2', status: 'in_progress' })],
        [formationIndexRow()]
      );

      const result = await service.getMyFormationWork(buildReq(), 'alice');

      expect(getProjectById).toHaveBeenCalledTimes(1);
      expect(getProjectById).toHaveBeenCalledWith(expect.anything(), 'live-project-1', true);
      expect(result.items.every((item) => item.can_write === false)).toBe(true);
    });

    it('a project whose write-access lookup fails stays read-only (fail-closed) rather than throwing', async () => {
      getProjectById.mockRejectedValue(new Error('project lookup failed'));
      mockQueryResources([itemIndexRow({ object_id: 'item-1', status: 'not_started' })], [formationIndexRow()]);

      const result = await service.getMyFormationWork(buildReq(), 'alice');

      expect(result.state).toBe('complete');
      expect(result.items[0].can_write).toBe(false);
    });

    it('stamps can_set_status per row as can_write AND team:formation membership, checked once per request (GH-2705)', async () => {
      checkSingleAccess.mockResolvedValue(true);
      mockQueryResources(
        [itemIndexRow({ object_id: 'item-1', status: 'not_started' }), itemIndexRow({ object_id: 'item-2', status: 'in_progress' })],
        [formationIndexRow()]
      );

      const result = await service.getMyFormationWork(buildReq(), 'alice');

      expect(checkSingleAccess).toHaveBeenCalledTimes(1);
      expect(checkSingleAccess).toHaveBeenCalledWith(expect.anything(), { resource: 'team', id: 'formation', access: 'member' });
      expect(result.items.every((item) => item.can_set_status === true)).toBe(true);
    });

    it('a writer who is not on team:formation gets can_write true but can_set_status false on every row (GH-2705)', async () => {
      // beforeEach default: membership false.
      mockQueryResources([itemIndexRow({ object_id: 'item-1', status: 'not_started' })], [formationIndexRow()]);

      const result = await service.getMyFormationWork(buildReq(), 'alice');

      expect(result.items[0].can_write).toBe(true);
      expect(result.items[0].can_set_status).toBe(false);
    });

    it('builds formations[] bucket counts from every assigned item on the formation, including done/skipped, and whole-formation totals from the formation-aggregate row', async () => {
      mockQueryResources(
        [
          itemIndexRow({ object_id: 'item-todo', status: 'not_started' }),
          itemIndexRow({ object_id: 'item-in-progress', status: 'in_progress' }),
          itemIndexRow({ object_id: 'item-done', status: 'done' }),
          itemIndexRow({ object_id: 'item-skipped', status: 'skipped' }),
        ],
        [formationIndexRow({ progress: { not_started: 5, done: 3 }, blocked_item_titles: ['Legal review'] })]
      );

      const result = await service.getMyFormationWork(buildReq(), 'alice');

      expect(result.formations).toHaveLength(1);
      expect(result.formations[0]).toMatchObject({
        formation_uid: 'formation:live-project-1',
        sub_stage: 'engaged',
        sub_stage_raw: 'Formation - Engaged',
        assigned_to_do: 2,
        assigned_done: 1,
        assigned_skipped: 1,
        items_done: 3,
        items_total: 8,
        gating_done: 0,
        gating_total: 0,
        blocking_item_title: 'Legal review',
      });
    });

    it('excludes a formation whose project has gone Active, per isFormationStageGate — checklist lifecycle:live alone does not gate this (GH-2328)', async () => {
      mockQueryResources([itemIndexRow({ object_id: 'item-1' })], [formationIndexRow({ sub_stage: 'Active' })]);

      const result = await service.getMyFormationWork(buildReq(), 'alice');

      expect(result.formations).toEqual([]);
      // Not a data-availability failure — the aggregate row arrived, it's just out-of-gate. Never
      // reads as `state: 'partial'`, which would incorrectly suggest something is missing.
      expect(result.state).toBe('complete');
    });

    // #2734 review (Cursor Bugbot): the row's View item links into `/project/formation`, whose guard
    // admits only Formation-stage projects. Production checklists stay `live` after a project goes
    // Active (GH-2328), so gating items[] on lifecycle alone would hand out a link that bounces to
    // the overview. The per-project read the can_write fan-out already makes carries the stage.
    it('drops an open item whose project has left the Formation stage, so View item never links into a route its guard would bounce', async () => {
      getProjectById.mockResolvedValue({ slug: 'live-project', name: 'Live Project', parent_uid: null, writer: true, stage: 'Active' });
      mockQueryResources([itemIndexRow({ object_id: 'item-1' })], [formationIndexRow({ sub_stage: 'Active' })]);

      const result = await service.getMyFormationWork(buildReq(), 'alice');

      expect(result.items).toEqual([]);
      expect(result.state).toBe('complete');
    });

    it('keeps an open item on a Formation-stage project, including Confidential', async () => {
      getProjectById.mockResolvedValue({ slug: 'live-project', name: 'Live Project', parent_uid: null, writer: false, stage: 'Formation - Confidential' });
      mockQueryResources([itemIndexRow({ object_id: 'item-1' })], [formationIndexRow()]);

      const result = await service.getMyFormationWork(buildReq(), 'alice');

      expect(result.items.map((item) => item.item_uid)).toEqual(['item-1']);
    });

    it('keeps an open item whose stage is unknown because the project lookup failed, rather than hiding real work on a transient error', async () => {
      getProjectById.mockRejectedValue(new Error('project lookup failed'));
      mockQueryResources([itemIndexRow({ object_id: 'item-1' })], [formationIndexRow()]);

      const result = await service.getMyFormationWork(buildReq(), 'alice');

      expect(result.items.map((item) => item.item_uid)).toEqual(['item-1']);
    });

    it('excludes a Disengaged formation (the one terminal Formation sub-stage) but keeps a Confidential one visible to an assignee who holds access to it', async () => {
      mockQueryResources(
        [
          itemIndexRow({ object_id: 'item-disengaged', formation_uid: 'formation:disengaged', project_uid: 'disengaged-project' }),
          itemIndexRow({ object_id: 'item-confidential', formation_uid: 'formation:confidential', project_uid: 'confidential-project' }),
        ],
        [
          formationIndexRow({ formation_uid: 'formation:disengaged', project_uid: 'disengaged-project', sub_stage: 'Formation - Disengaged' }),
          formationIndexRow({ formation_uid: 'formation:confidential', project_uid: 'confidential-project', sub_stage: 'Formation - Confidential' }),
        ]
      );

      const result = await service.getMyFormationWork(buildReq(), 'alice');

      expect(result.formations.map((f) => f.formation_uid)).toEqual(['formation:confidential']);
    });

    it('drops a formation missing its aggregate row and reports state partial rather than fabricating it', async () => {
      mockQueryResources([itemIndexRow({ object_id: 'item-1', formation_uid: 'formation:orphan', project_uid: 'orphan-project' })], []);

      const result = await service.getMyFormationWork(buildReq(), 'alice');

      expect(result.formations).toEqual([]);
      expect(result.state).toBe('partial');
    });

    it('drops a formation whose aggregate row is a stale non-live mismatch, even though its item row is live (PR #2444 review)', async () => {
      // The exact scenario the lifecycle backstop exists for: the upstream lifecycle:live tag
      // failed to exclude a completed/frozen aggregate document, but the item row for the same
      // formation is genuinely live and assigned. Without the same backstop applied to
      // rawFormationRows, this would have joined and rendered as an active "My formation".
      mockQueryResources([itemIndexRow({ object_id: 'item-1', lifecycle: 'live' })], [formationIndexRow({ lifecycle: 'completed' })]);

      const result = await service.getMyFormationWork(buildReq(), 'alice');

      expect(result.formations).toEqual([]);
      expect(result.state).toBe('partial');
      expect(result.items).toHaveLength(1);
    });

    it('folds skipped into items_done alongside done, matching the queue doneCount convention', async () => {
      mockQueryResources(
        [itemIndexRow({ object_id: 'item-1', status: 'skipped' })],
        [formationIndexRow({ progress: { skipped: 3 }, sub_stage: 'Formation - Engaged' })]
      );

      const result = await service.getMyFormationWork(buildReq(), 'alice');

      expect(result.formations[0]).toMatchObject({ items_done: 3, items_total: 3 });
    });

    it('does not resolve the ROOT project uid for the Me-lens formation-aggregate read — MyFormationSummary never exposes parent_uid', async () => {
      mockQueryResources([itemIndexRow({ object_id: 'item-1' })], [formationIndexRow()]);

      await service.getMyFormationWork(buildReq(), 'alice');

      expect(natsRequest).not.toHaveBeenCalled();
    });

    it('includeFormations: false skips the formation-aggregate query and its join entirely, and never reports partial for a formation it was never asked to fetch', async () => {
      mockQueryResources([itemIndexRow({ object_id: 'item-1' })], []);

      const result = await service.getMyFormationWork(buildReq(), 'alice', { includeFormations: false });

      expect(result.formations).toEqual([]);
      expect(result.items).toHaveLength(1);
      expect(result.state).toBe('complete');
      expect(proxyRequest.mock.calls.find((c) => (c[4] as { type: string }).type === 'formation')).toBeUndefined();
    });

    it('degrades to state partial, keeping items[] trustworthy, when the formation-aggregate query itself fails', async () => {
      proxyRequest.mockImplementation((...args: unknown[]) => {
        const params = args[4] as { type: string };
        if (params.type === 'formation_item') {
          return Promise.resolve({ resources: [{ type: 'formation_item', id: 'item-1', data: itemIndexRow() }] });
        }
        return Promise.reject(new Error('formation aggregate query unavailable'));
      });

      const result = await service.getMyFormationWork(buildReq(), 'alice');

      expect(result.state).toBe('partial');
      expect(result.items).toHaveLength(1);
      expect(result.formations).toEqual([]);
    });

    it('returns state unavailable with both arrays empty when the item-assignment query itself fails', async () => {
      proxyRequest.mockRejectedValue(new Error('query service unavailable'));

      const result = await service.getMyFormationWork(buildReq(), 'alice');

      expect(result).toEqual({ formations: [], items: [], state: 'unavailable' });
      expect(getProjectById).not.toHaveBeenCalled();
    });
  });
});
