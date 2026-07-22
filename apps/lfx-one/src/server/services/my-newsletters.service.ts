// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MyNewsletterArchiveResponse, MyNewsletterListItem, Newsletter, Project } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { logger } from './logger.service';
import { NewsletterServiceClient } from './newsletter-service.client';
import { ProjectService } from './project.service';
import { CommitteeService } from './committee.service';

/**
 * Recipient-facing newsletter archive service.
 * Lists and fetches sent newsletters that target committees the user belongs to.
 * Enriches project UIDs with project/foundation names and slugs server-side.
 */
export class MyNewslettersService {
  private newsletterClient = new NewsletterServiceClient();
  private projectService = new ProjectService();
  private committeeService = new CommitteeService();

  /**
   * List recipient archive: sent newsletters for committees the user belongs to.
   * Returns empty list without upstream call if user has zero committees.
   * Enriches project data (name, slug, foundation) from NATS project service.
   */
  public async listArchive(req: Request, pageToken?: string): Promise<MyNewsletterArchiveResponse> {
    const startTime = logger.startOperation(req, 'list_my_newsletters_archive');

    try {
      // Resolve user's committee UIDs via query service
      const committeeUids = await this.committeeService.getMyCommitteeUids(req);

      if (committeeUids.size === 0) {
        logger.debug(req, 'list_my_newsletters_archive', 'User has no committees, returning empty list', {
          committee_count: 0,
        });
        logger.success(req, 'list_my_newsletters_archive', startTime, { newsletter_count: 0 });
        return { newsletters: [] };
      }

      // Fetch archive from upstream service
      const committeeUidList = Array.from(committeeUids);
      logger.debug(req, 'list_my_newsletters_archive', 'Fetching archive from upstream', {
        committee_count: committeeUidList.length,
        page_token: pageToken ? 'present' : 'absent',
      });

      const archiveResponse = await this.newsletterClient.archiveList(req, committeeUidList, pageToken);

      logger.debug(req, 'list_my_newsletters_archive', 'Fetched newsletters from upstream', {
        newsletter_count: archiveResponse.newsletters.length,
      });

      // Enrich with project data (name, slug, foundation name/slug)
      const enriched = await this.enrichNewslettersWithProjectData(req, archiveResponse.newsletters);

      logger.success(req, 'list_my_newsletters_archive', startTime, {
        newsletter_count: enriched.length,
        has_next_page: !!archiveResponse.next_page_token,
      });

      return {
        newsletters: enriched,
        next_page_token: archiveResponse.next_page_token,
      };
    } catch (error) {
      logger.error(req, 'list_my_newsletters_archive', startTime, error as Error, {});
      throw error;
    }
  }

  /**
   * Fetch a specific newsletter from the recipient archive.
   * Upstream verification is authoritative (403/404 propagate).
   * Service logs tracing only; controller logs operation boundary.
   */
  public async getArchiveDetail(req: Request, newsletterUid: string): Promise<Newsletter> {
    logger.debug(req, 'get_my_newsletter_detail', 'Fetching from upstream archive', { newsletter_uid: newsletterUid });

    try {
      // Upstream is authoritative for membership check (403) and existence (404/not-sent)
      const newsletter = await this.newsletterClient.archiveDetail(req, newsletterUid);

      logger.debug(req, 'get_my_newsletter_detail', 'Fetched newsletter detail', {
        newsletter_id: newsletter.id,
        subject: newsletter.subject,
      });

      return newsletter;
    } catch (error) {
      logger.warning(req, 'get_my_newsletter_detail', 'Failed to fetch (403/404 expected for access control)', {
        newsletter_uid: newsletterUid,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Enrich list items with project/foundation name and slug.
   * Batches project lookups in groups of 25. Missing projects → items with empty fields + warning log.
   * Also fetches parent_uid projects (foundations) in the same batch.
   */
  private async enrichNewslettersWithProjectData(req: Request, items: MyNewsletterListItem[]): Promise<MyNewsletterListItem[]> {
    if (items.length === 0) {
      return [];
    }

    // Extract unique project UIDs from items
    const projectUids = Array.from(new Set(items.map((item) => item.project_uid)));

    logger.debug(req, 'enrich_newsletters_project_data', 'Starting project enrichment', {
      item_count: items.length,
      unique_projects: projectUids.length,
    });

    // Batch fetch initial projects in groups of 25
    const projects: (Project | null)[] = [];
    const batchSize = 25;

    // First pass: fetch project UIDs from items
    for (let i = 0; i < projectUids.length; i += batchSize) {
      const batch = projectUids.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (uid) => {
          try {
            return await this.projectService.getProjectById(req, uid, false);
          } catch {
            return null;
          }
        })
      );
      projects.push(...results);
    }

    // Second pass: collect parent UIDs and fetch those too
    const parentUids = Array.from(
      new Set(
        projects
          .filter((p): p is Project => p !== null)
          .map((p) => p.parent_uid)
          .filter((uid): uid is string => uid !== undefined && uid !== null)
      )
    );

    const parentProjects: (Project | null)[] = [];
    for (let i = 0; i < parentUids.length; i += batchSize) {
      const batch = parentUids.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (uid) => {
          try {
            return await this.projectService.getProjectById(req, uid, false);
          } catch {
            return null;
          }
        })
      );
      parentProjects.push(...results);
    }

    // Combine all fetched projects into map
    const projectMap = new Map<string, Project>();
    [projects, parentProjects]
      .flatMap((arr) => arr)
      .filter((p): p is Project => p !== null)
      .forEach((p) => projectMap.set(p.uid, p));

    logger.debug(req, 'enrich_newsletters_project_data', 'Project enrichment complete', {
      resolved: projectMap.size,
      unresolved: projectUids.length - projectMap.size,
    });

    // Enrich items: add project name/slug and foundation name/slug
    return items.map((item) => {
      const project = projectMap.get(item.project_uid);

      if (!project) {
        logger.warning(req, 'enrich_newsletters_project_data', 'Project not found for newsletter', {
          newsletter_id: item.id,
          project_uid: item.project_uid,
        });
        return {
          ...item,
          project_name: item.project_name || '',
          project_slug: item.project_slug || '',
          foundation_name: '',
          foundation_slug: '',
        };
      }

      // Resolve foundation: if project has parent_uid, look up that; otherwise project IS the foundation
      const foundationUid = project.parent_uid || project.uid;
      const foundationProject = foundationUid === project.uid ? project : projectMap.get(foundationUid);

      return {
        ...item,
        project_name: project.name,
        project_slug: project.slug,
        foundation_name: foundationProject?.name || '',
        foundation_slug: foundationProject?.slug || '',
      };
    });
  }
}
