// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MyNewsletterListItem, MyNewsletterArchiveResponse, Newsletter, Project } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';

// Mocks must be hoisted to be used at module load time
const mocks = vi.hoisted(() => {
  const logger = {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  };

  const newsletterClient = {
    archiveList: vi.fn(),
    archiveDetail: vi.fn(),
  };

  const committeeService = {
    getMyCommitteeUids: vi.fn(),
  };

  const projectService = {
    getProjectById: vi.fn(),
  };

  return { logger, newsletterClient, committeeService, projectService };
});

vi.mock('./logger.service', () => ({ logger: mocks.logger }));
vi.mock('./newsletter-service.client', () => ({
  NewsletterServiceClient: vi.fn(function () {
    return mocks.newsletterClient;
  }),
}));
vi.mock('./committee.service', () => ({
  CommitteeService: vi.fn(function () {
    return mocks.committeeService;
  }),
}));
vi.mock('./project.service', () => ({
  ProjectService: vi.fn(function () {
    return mocks.projectService;
  }),
}));

import { MyNewslettersService } from './my-newsletters.service';

// Destructure for test access
const { logger, newsletterClient, committeeService, projectService } = mocks;

function buildNewsletterListItem(overrides: Partial<MyNewsletterListItem> = {}): MyNewsletterListItem {
  return {
    id: 'newsletter-1',
    project_uid: 'project-1',
    project_name: '',
    project_slug: '',
    foundation_name: '',
    foundation_slug: '',
    subject: 'Test Newsletter',
    sent_at: '2024-01-01T00:00:00Z',
    committee_uids: ['committee-1'],
    ...overrides,
  };
}

function buildProject(overrides: Partial<Project> = {}): Project {
  return {
    uid: 'project-1',
    name: 'Test Project',
    slug: 'test-project',
    parent_uid: undefined,
    ...overrides,
  } as Project;
}

const mockRequest = { log: {} } as unknown as Request;

describe('MyNewslettersService', () => {
  let service: MyNewslettersService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MyNewslettersService();
  });

  describe('listArchive', () => {
    it('returns empty list without calling upstream client when user has no committees', async () => {
      committeeService.getMyCommitteeUids.mockResolvedValue(new Set());

      const result = await service.listArchive(mockRequest);

      expect(result).toEqual({ newsletters: [] });
      expect(newsletterClient.archiveList).not.toHaveBeenCalled();
      expect(logger.success).toHaveBeenCalledWith(mockRequest, 'list_my_newsletters_archive', 0, { newsletter_count: 0 });
    });

    it('fetches and enriches newsletters when user has committees', async () => {
      const committee1 = 'committee-1';
      const committee2 = 'committee-2';
      committeeService.getMyCommitteeUids.mockResolvedValue(new Set([committee1, committee2]));

      const listItem = buildNewsletterListItem();
      const archiveResponse: MyNewsletterArchiveResponse = {
        newsletters: [listItem],
        next_page_token: 'token-123',
      };

      newsletterClient.archiveList.mockResolvedValue(archiveResponse);

      const project = buildProject();
      projectService.getProjectById.mockResolvedValue(project);

      const result = await service.listArchive(mockRequest);

      expect(result.newsletters).toHaveLength(1);
      expect(result.next_page_token).toBe('token-123');
      expect(result.newsletters[0].project_name).toBe('Test Project');
      expect(result.newsletters[0].foundation_name).toBe('Test Project');
      expect(newsletterClient.archiveList).toHaveBeenCalledWith(mockRequest, [committee1, committee2], undefined);
      expect(logger.success).toHaveBeenCalledWith(
        mockRequest,
        'list_my_newsletters_archive',
        0,
        expect.objectContaining({ newsletter_count: 1, has_next_page: true })
      );
    });

    it('passes pageToken to upstream call when provided', async () => {
      const committee = 'committee-1';
      committeeService.getMyCommitteeUids.mockResolvedValue(new Set([committee]));

      const archiveResponse: MyNewsletterArchiveResponse = { newsletters: [] };
      newsletterClient.archiveList.mockResolvedValue(archiveResponse);

      await service.listArchive(mockRequest, 'page-token-456');

      expect(newsletterClient.archiveList).toHaveBeenCalledWith(mockRequest, [committee], 'page-token-456');
    });

    it('enriches newsletters with parent_uid-referenced foundation data', async () => {
      committeeService.getMyCommitteeUids.mockResolvedValue(new Set(['committee-1']));

      const listItem = buildNewsletterListItem({ project_uid: 'project-1' });
      newsletterClient.archiveList.mockResolvedValue({ newsletters: [listItem] });

      const childProject = buildProject({ uid: 'project-1', parent_uid: 'foundation-1' });
      const foundationProject = buildProject({ uid: 'foundation-1', name: 'My Foundation', slug: 'my-foundation' });

      projectService.getProjectById.mockImplementation(async (req, uid) => {
        if (uid === 'project-1') return childProject;
        if (uid === 'foundation-1') return foundationProject;
        return null;
      });

      const result = await service.listArchive(mockRequest);

      expect(result.newsletters[0].project_name).toBe('Test Project');
      expect(result.newsletters[0].foundation_name).toBe('My Foundation');
      expect(result.newsletters[0].foundation_slug).toBe('my-foundation');
    });

    it('handles newsletters where project is its own foundation (no parent_uid)', async () => {
      committeeService.getMyCommitteeUids.mockResolvedValue(new Set(['committee-1']));

      const listItem = buildNewsletterListItem({ project_uid: 'project-1' });
      newsletterClient.archiveList.mockResolvedValue({ newsletters: [listItem] });

      const project = buildProject({ uid: 'project-1', parent_uid: undefined });
      projectService.getProjectById.mockResolvedValue(project);

      const result = await service.listArchive(mockRequest);

      expect(result.newsletters[0].project_name).toBe('Test Project');
      expect(result.newsletters[0].foundation_name).toBe('Test Project');
      expect(result.newsletters[0].foundation_slug).toBe('test-project');
    });

    it('keeps item with empty foundation fields when project lookup fails', async () => {
      committeeService.getMyCommitteeUids.mockResolvedValue(new Set(['committee-1']));

      const listItem = buildNewsletterListItem({ project_uid: 'missing-project' });
      newsletterClient.archiveList.mockResolvedValue({ newsletters: [listItem] });

      projectService.getProjectById.mockRejectedValue(new Error('Not found'));

      const result = await service.listArchive(mockRequest);

      expect(result.newsletters[0].project_name).toBe('');
      expect(result.newsletters[0].project_slug).toBe('');
      expect(result.newsletters[0].foundation_name).toBe('');
      expect(result.newsletters[0].foundation_slug).toBe('');
      expect(logger.warning).toHaveBeenCalledWith(
        mockRequest,
        'enrich_newsletters_project_data',
        'Project not found for newsletter',
        expect.objectContaining({ project_uid: 'missing-project' })
      );
    });

    it('batches project lookups in groups of 25', async () => {
      committeeService.getMyCommitteeUids.mockResolvedValue(new Set(['committee-1']));

      // Create 51 newsletters with unique project UIDs (2 batches: 25 + 26)
      const items = Array.from({ length: 51 }, (_, i) =>
        buildNewsletterListItem({
          project_uid: `project-${i}`,
        })
      );

      newsletterClient.archiveList.mockResolvedValue({ newsletters: items });

      projectService.getProjectById.mockImplementation(async (req, uid) => buildProject({ uid, name: `Project ${uid}`, slug: `project-${uid}` }));

      await service.listArchive(mockRequest);

      // Verify that getProjectById was called 51 times total (batching is internal)
      expect(projectService.getProjectById).toHaveBeenCalledTimes(51);
    });

    it('propagates upstream errors', async () => {
      committeeService.getMyCommitteeUids.mockResolvedValue(new Set(['committee-1']));

      const error = new Error('Upstream service error');
      newsletterClient.archiveList.mockRejectedValue(error);

      await expect(service.listArchive(mockRequest)).rejects.toBe(error);
      expect(logger.error).toHaveBeenCalledWith(mockRequest, 'list_my_newsletters_archive', 0, error, {});
    });
  });

  describe('getArchiveDetail', () => {
    it('fetches and returns full newsletter from upstream', async () => {
      const newsletter: Newsletter = {
        id: 'newsletter-1',
        project_uid: 'project-1',
        subject: 'Full Newsletter',
        body_html: '<p>Content</p>',
        status: 'sent',
        committee_uids: ['committee-1'],
        created_by: 'user-1',
        created_at: '2024-01-01T00:00:00Z',
      } as Newsletter;

      newsletterClient.archiveDetail.mockResolvedValue(newsletter);

      const result = await service.getArchiveDetail(mockRequest, 'newsletter-1');

      expect(result).toEqual(newsletter);
      expect(newsletterClient.archiveDetail).toHaveBeenCalledWith(mockRequest, 'newsletter-1');
      expect(logger.debug).toHaveBeenCalledWith(mockRequest, 'get_my_newsletter_detail', 'Fetching from upstream archive', { newsletter_uid: 'newsletter-1' });
    });

    it('propagates 403 (non-member) errors from upstream', async () => {
      const error = new Error('Forbidden');
      (error as any).statusCode = 403;

      newsletterClient.archiveDetail.mockRejectedValue(error);

      await expect(service.getArchiveDetail(mockRequest, 'newsletter-1')).rejects.toBe(error);
      expect(logger.warning).toHaveBeenCalledWith(
        mockRequest,
        'get_my_newsletter_detail',
        'Failed to fetch (403/404 expected for access control)',
        expect.objectContaining({ newsletter_uid: 'newsletter-1' })
      );
    });

    it('propagates 404 (not found / not sent) errors from upstream', async () => {
      const error = new Error('Not found');
      (error as any).statusCode = 404;

      newsletterClient.archiveDetail.mockRejectedValue(error);

      await expect(service.getArchiveDetail(mockRequest, 'newsletter-1')).rejects.toBe(error);
      expect(logger.warning).toHaveBeenCalledWith(
        mockRequest,
        'get_my_newsletter_detail',
        'Failed to fetch (403/404 expected for access control)',
        expect.objectContaining({ newsletter_uid: 'newsletter-1' })
      );
    });

    it('logs unexpected errors at warning level', async () => {
      const error = new Error('Unexpected error');

      newsletterClient.archiveDetail.mockRejectedValue(error);

      await expect(service.getArchiveDetail(mockRequest, 'newsletter-1')).rejects.toBe(error);
      expect(logger.warning).toHaveBeenCalledWith(
        mockRequest,
        'get_my_newsletter_detail',
        expect.any(String),
        expect.objectContaining({
          newsletter_uid: 'newsletter-1',
          error: 'Unexpected error',
        })
      );
    });
  });
});
