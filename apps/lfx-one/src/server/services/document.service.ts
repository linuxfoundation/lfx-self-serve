// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CommitteeLinkQueryResult,
  GroupsIOArtifactQueryResult,
  MeetingAttachment,
  MyCommittee,
  MyDocumentItem,
  MyDocumentSource,
  PastMeetingAttachment,
  PastMeetingRecordingQueryResult,
  PastMeetingSummaryQueryResult,
  PastMeetingTranscriptQueryResult,
  QueryServiceResponse,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { CommitteeService } from './committee.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { UserService } from './user.service';

type MeetingDetails = Map<string, { title: string; project_uid: string }>;

/**
 * Service for aggregating documents across a user's groups, meetings, and mailing lists.
 *
 * Uses a 4-stage query model:
 *   Stage 1: Fetch committee memberships and past occurrence IDs in parallel
 *   Stage 2: Fetch all raw attachments/recordings/artifacts in parallel
 *   Stage 3: Single batched meeting detail fetch (title + project_uid), then map to MyDocumentItem
 *   Stage 4: Batched HTTP lookup to resolve foundation display names for meeting-sourced documents
 */
export class DocumentService {
  private readonly microserviceProxy: MicroserviceProxyService;
  private readonly committeeService: CommitteeService;
  private readonly userService: UserService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
    this.committeeService = new CommitteeService();
    this.userService = new UserService();
  }

  /**
   * Fetches all documents relevant to the current user across their groups and meetings.
   * Optionally scoped to a specific project via project_uid query param.
   */
  public async getMyDocuments(req: Request, query: Record<string, any> = {}): Promise<MyDocumentItem[]> {
    const projectUid = query['project_uid'] as string | undefined;

    logger.info(req, 'get_my_documents', 'Starting 4-stage document aggregation', { project_uid: projectUid });

    // Stage 1 — Fetch committee memberships and past occurrence IDs in parallel
    const [myCommittees, occurrenceIds] = await Promise.all([
      this.committeeService.getMyCommittees(req, projectUid).catch((err) => {
        logger.warning(req, 'get_my_documents', 'Failed to fetch committee memberships, returning empty', {
          error: err instanceof Error ? err.message : 'Unknown error',
        });
        return [] as MyCommittee[];
      }),
      this.userService.getPastMeetingOccurrenceIds(req).catch((err) => {
        logger.warning(req, 'get_my_documents', 'Failed to fetch past meeting occurrence IDs, returning empty', {
          error: err instanceof Error ? err.message : 'Unknown error',
        });
        return [] as string[];
      }),
    ]);

    // Stage 2 — Fetch all raw items in parallel (no meeting enrichment yet)
    const [committeeLinkItems, groupsioItems, rawMeetingAttachments, rawPastAttachments, rawPastRecordings, rawTranscripts, rawSummaries] = await Promise.all([
      this.getCommitteeDocuments(req, myCommittees),
      this.getGroupsIOArtifacts(req, myCommittees),
      this.fetchRawMeetingAttachments(req),
      this.fetchRawPastMeetingAttachments(req, occurrenceIds),
      this.fetchRawPastMeetingRecordings(req, occurrenceIds),
      this.fetchRawPastMeetingTranscripts(req, occurrenceIds),
      this.fetchRawPastMeetingSummaries(req, occurrenceIds),
    ]);

    // Stage 3 — Batch all unique meeting IDs across all meeting-linked sources into ONE fetch
    const allMeetingIds = [
      ...new Set(
        [
          ...rawMeetingAttachments.map((a) => a.meeting_id),
          ...rawPastAttachments.map((a) => a.meeting_id),
          ...rawPastRecordings.map((r) => r.meeting_id),
          ...rawTranscripts.map((t) => t.meeting_id),
          ...rawSummaries.map((s) => s.meeting_id),
        ].filter(Boolean)
      ),
    ];

    const meetingDetails =
      allMeetingIds.length > 0 ? await this.fetchMeetingDetails(req, allMeetingIds) : new Map<string, { title: string; project_uid: string }>();

    const meetingAttachmentItems = this.mapMeetingAttachments(rawMeetingAttachments, meetingDetails);
    const pastMeetingItems = [
      ...this.mapPastMeetingAttachments(rawPastAttachments, meetingDetails),
      ...this.mapPastMeetingRecordings(rawPastRecordings, meetingDetails),
      ...this.mapPastMeetingTranscripts(rawTranscripts, meetingDetails),
      ...this.mapPastMeetingSummaries(rawSummaries, meetingDetails),
    ];

    const allDocuments = [...committeeLinkItems, ...groupsioItems, ...meetingAttachmentItems, ...pastMeetingItems];

    // Stage 4 — Resolve foundation names for meeting-sourced docs via project service HTTP
    // Committee and mailing list docs already have foundation names from committee service data.
    const meetingSourced: MyDocumentSource[] = ['file', 'recording', 'transcript', 'summary', 'meeting'];
    const foundationUids = [...new Set(allDocuments.filter((d) => meetingSourced.includes(d.source) && d.foundationUid).map((d) => d.foundationUid as string))];

    const foundationNames = await this.fetchProjectNames(req, foundationUids);

    const enrichedDocuments = allDocuments.map((doc) => {
      if (meetingSourced.includes(doc.source) && doc.foundationUid) {
        const name = foundationNames.get(doc.foundationUid);
        return name ? { ...doc, foundationName: name } : doc;
      }
      return doc;
    });

    logger.info(req, 'get_my_documents', 'Completed 4-stage document aggregation', {
      committee_docs: committeeLinkItems.length,
      mailing_list_artifacts: groupsioItems.length,
      meeting_attachments: meetingAttachmentItems.length,
      past_meeting_items: pastMeetingItems.length,
      total: enrichedDocuments.length,
    });

    return enrichedDocuments;
  }

  // ─── Committee / Group Documents ────────────────────────────────────────────

  private async getCommitteeDocuments(req: Request, myCommittees: MyCommittee[]): Promise<MyDocumentItem[]> {
    if (myCommittees.length === 0) {
      return [];
    }

    logger.debug(req, 'get_my_documents', 'Fetching committee links using filters_or', {
      committee_count: myCommittees.length,
    });

    const filtersOr = myCommittees.map((c) => `committee_uid:${c.uid}`);

    // Fetch committee link documents (links and folders) via filters_or
    // We use v=1 for the new filters_or param (requires query service PR #41)
    const linkAttachments = await fetchAllQueryResources<CommitteeLinkQueryResult>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<CommitteeLinkQueryResult>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        v: '1',
        type: 'committee_link',
        filters_or: filtersOr,
        ...(pageToken && { page_token: pageToken }),
      })
    ).catch((err) => {
      logger.warning(req, 'get_my_documents', 'Failed to fetch committee links via query service, falling back', {
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      return [];
    });

    const committeeMap = new Map(myCommittees.map((c) => [c.uid, c]));

    return linkAttachments
      .filter((link) => link.url) // skip folders
      .map((link): MyDocumentItem => {
        const committee = link.committee_uid ? committeeMap.get(link.committee_uid) : undefined;
        return {
          id: `committee_link:${link.uid}`,
          name: link.name,
          source: 'link' as MyDocumentSource,
          foundationName: committee?.foundation_name || committee?.project_name || '',
          foundationUid: committee?.project_uid || undefined,
          groupOrMeetingName: committee?.name || '',
          groupOrMeetingUid: committee?.uid || link.committee_uid || '',
          date: link.created_at || '',
          url: link.url,
        };
      });
  }

  // ─── GroupsIO / Mailing List Artifacts ──────────────────────────────────────

  private async getGroupsIOArtifacts(req: Request, myCommittees: MyCommittee[]): Promise<MyDocumentItem[]> {
    if (myCommittees.length === 0) {
      return [];
    }

    const filtersOr = myCommittees.map((c) => `committee_uid:${c.uid}`);

    logger.debug(req, 'get_my_documents', 'Fetching groupsio artifacts via filters_or', {
      committee_count: myCommittees.length,
    });

    const artifacts = await fetchAllQueryResources<GroupsIOArtifactQueryResult>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<GroupsIOArtifactQueryResult>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        v: '1',
        type: 'groupsio_artifact',
        filters_or: filtersOr,
        ...(pageToken && { page_token: pageToken }),
      })
    ).catch((err) => {
      logger.warning(req, 'get_my_documents', 'Failed to fetch groupsio artifacts', {
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      return [];
    });

    const committeeMap = new Map(myCommittees.map((c) => [c.uid, c]));

    return artifacts.map((a): MyDocumentItem => {
      const committee = a.committee_uid ? committeeMap.get(a.committee_uid) : undefined;
      const url = a.type === 'link' ? a.link_url : (a.download_url ?? a.link_url);
      return {
        id: `groupsio_artifact:${a.artifact_id}`,
        name: a.filename || a.link_url || a.artifact_id,
        source: 'mailing_list' as MyDocumentSource,
        foundationName: committee?.foundation_name || committee?.project_name || '',
        foundationUid: committee?.project_uid || a.project_uid || undefined,
        groupOrMeetingName: committee?.name || '',
        groupOrMeetingUid: committee?.uid || a.committee_uid || '',
        date: a.created_at || '',
        url,
        mailingListId: a.group_id ? String(a.group_id) : undefined,
        fileType: a.media_type,
      };
    });
  }

  // ─── Foundation Name Resolution ─────────────────────────────────────────────

  /**
   * Resolves a batch of project UIDs to display names via the project service HTTP API.
   * Uses bounded parallelism (10 concurrent) to avoid overwhelming upstream.
   * UIDs that fail or return no name are silently omitted from the result map.
   */
  private async fetchProjectNames(req: Request, uids: string[]): Promise<Map<string, string>> {
    if (uids.length === 0) return new Map();

    logger.debug(req, 'get_my_documents', 'Resolving foundation names via project service', { uid_count: uids.length });

    const CONCURRENCY = 10;
    const nameMap = new Map<string, string>();

    for (let i = 0; i < uids.length; i += CONCURRENCY) {
      const batch = uids.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((uid) =>
          this.microserviceProxy.proxyRequest<{ name: string }>(req, 'LFX_V2_SERVICE', `/projects/${uid}`, 'GET').catch((err) => {
            logger.debug(req, 'get_my_documents', 'Failed to fetch project name, skipping', {
              uid,
              error: err instanceof Error ? err.message : String(err),
            });
            return null;
          })
        )
      );
      batch.forEach((uid, j) => {
        const p = results[j];
        if (p?.name) nameMap.set(uid, p.name);
      });
    }

    return nameMap;
  }

  // ─── Meeting Enrichment ─────────────────────────────────────────────────────

  /**
   * Fetches meeting details (title, project_uid, project_name) for a set of meeting IDs
   * using bounded parallelism (10 concurrent requests) to avoid overwhelming upstream.
   * Returns a map of meeting_id → enrichment data; missing/failed IDs are silently omitted.
   */
  private async fetchMeetingDetails(req: Request, meetingIds: string[]): Promise<MeetingDetails> {
    const CONCURRENCY = 10;
    const map: MeetingDetails = new Map();

    for (let i = 0; i < meetingIds.length; i += CONCURRENCY) {
      const batch = meetingIds.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((id) =>
          this.microserviceProxy.proxyRequest<{ title: string; project_uid: string }>(req, 'LFX_V2_SERVICE', `/itx/meetings/${id}`, 'GET').catch((err) => {
            logger.debug(req, 'fetch_meeting_details', 'Failed to fetch meeting details, skipping', {
              meeting_id: id,
              error: err instanceof Error ? err.message : String(err),
            });
            return null;
          })
        )
      );
      batch.forEach((id, j) => {
        const m = results[j];
        if (m?.title) map.set(id, m);
      });
    }

    return map;
  }

  // ─── Upcoming Meeting Attachments ───────────────────────────────────────────

  private async fetchRawMeetingAttachments(req: Request): Promise<MeetingAttachment[]> {
    logger.debug(req, 'get_my_documents', 'Fetching user meeting registrations for attachments');

    const email = (req.oidc?.user?.['email'] as string | undefined)?.toLowerCase();

    // Delegate registrant lookup to UserService which handles email+username dual lookup
    // with M2M tokens (required because registrant queries search across all participants
    // in the index and require application-level credentials)
    const meetingIds = await this.userService.getUserRegisteredMeetingIds(req, email).catch(() => new Set<string>());

    if (meetingIds.size === 0) {
      return [];
    }

    const filtersOr = Array.from(meetingIds).map((id) => `meeting_id:${id}`);

    logger.debug(req, 'get_my_documents', 'Fetching meeting attachments via filters_or', {
      meeting_count: meetingIds.size,
    });

    return fetchAllQueryResources<MeetingAttachment>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<MeetingAttachment>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        v: '1',
        type: 'v1_meeting_attachment',
        filters_or: filtersOr,
        ...(pageToken && { page_token: pageToken }),
      })
    ).catch((err) => {
      logger.warning(req, 'get_my_documents', 'Failed to fetch meeting attachments', {
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      return [];
    });
  }

  private mapMeetingAttachments(attachments: MeetingAttachment[], meetingDetails: MeetingDetails): MyDocumentItem[] {
    return attachments.map((a): MyDocumentItem => {
      const meeting = meetingDetails.get(a.meeting_id);
      return {
        id: `meeting_attachment:${a.uid}`,
        name: a.name,
        source: a.type === 'file' ? ('file' as MyDocumentSource) : ('meeting' as MyDocumentSource),
        foundationName: '',
        foundationUid: meeting?.project_uid || undefined,
        groupOrMeetingName: meeting?.title || '',
        groupOrMeetingUid: a.meeting_id,
        date: a.created_at,
        url: a.link,
        attachmentUid: a.uid,
        meetingId: a.meeting_id,
        fileType: a.file_content_type,
      };
    });
  }

  // ─── Past Meeting Items (Attachments + Recordings) ──────────────────────────

  private async fetchRawPastMeetingAttachments(req: Request, occurrenceIds: string[]): Promise<PastMeetingAttachment[]> {
    if (occurrenceIds.length === 0) {
      return [];
    }

    const filtersOr = occurrenceIds.map((id) => `meeting_and_occurrence_id:${id}`);

    logger.debug(req, 'get_my_documents', 'Fetching past meeting attachments via filters_or', {
      occurrence_count: occurrenceIds.length,
    });

    return fetchAllQueryResources<PastMeetingAttachment>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<PastMeetingAttachment>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        v: '1',
        type: 'v1_past_meeting_attachment',
        filters_or: filtersOr,
        ...(pageToken && { page_token: pageToken }),
      })
    ).catch((err) => {
      logger.warning(req, 'get_my_documents', 'Failed to fetch past meeting attachments', {
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      return [];
    });
  }

  private mapPastMeetingAttachments(attachments: PastMeetingAttachment[], meetingDetails: MeetingDetails): MyDocumentItem[] {
    return attachments.map((a): MyDocumentItem => {
      const meeting = meetingDetails.get(a.meeting_id);
      return {
        id: `past_meeting_attachment:${a.uid}`,
        name: a.name,
        source: a.type === 'file' ? ('file' as MyDocumentSource) : ('meeting' as MyDocumentSource),
        foundationName: '',
        foundationUid: meeting?.project_uid || undefined,
        groupOrMeetingName: meeting?.title || '',
        groupOrMeetingUid: a.meeting_and_occurrence_id,
        date: a.created_at,
        url: a.link,
        attachmentUid: a.uid,
        pastMeetingId: a.meeting_and_occurrence_id,
        fileType: a.file_content_type,
      };
    });
  }

  private async fetchRawPastMeetingRecordings(req: Request, occurrenceIds: string[]): Promise<PastMeetingRecordingQueryResult[]> {
    if (occurrenceIds.length === 0) {
      return [];
    }

    const filtersOr = occurrenceIds.map((id) => `meeting_and_occurrence_id:${id}`);

    logger.debug(req, 'get_my_documents', 'Fetching past meeting recordings via filters_or', {
      occurrence_count: occurrenceIds.length,
    });

    return fetchAllQueryResources<PastMeetingRecordingQueryResult>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<PastMeetingRecordingQueryResult>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        v: '1',
        type: 'v1_past_meeting_recording',
        filters_or: filtersOr,
        ...(pageToken && { page_token: pageToken }),
      })
    ).catch((err) => {
      logger.warning(req, 'get_my_documents', 'Failed to fetch past meeting recordings', {
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      return [];
    });
  }

  private mapPastMeetingRecordings(recordings: PastMeetingRecordingQueryResult[], meetingDetails: MeetingDetails): MyDocumentItem[] {
    return recordings.map((r): MyDocumentItem => {
      const meeting = meetingDetails.get(r.meeting_id);
      const url = r.sessions?.[0]?.share_url ?? r.recording_files?.[0]?.play_url;
      return {
        id: `past_meeting_recording:${r.id}`,
        name: r.title || 'Recording',
        source: 'recording' as MyDocumentSource,
        foundationName: '',
        foundationUid: meeting?.project_uid || undefined,
        groupOrMeetingName: meeting?.title || '',
        groupOrMeetingUid: r.meeting_and_occurrence_id,
        date: r.start_time || r.created_at,
        url,
        pastMeetingId: r.meeting_and_occurrence_id,
        fileType: r.recording_files?.[0]?.file_type,
      };
    });
  }

  // ─── Past Meeting Transcripts ────────────────────────────────────────────────

  private async fetchRawPastMeetingTranscripts(req: Request, occurrenceIds: string[]): Promise<PastMeetingTranscriptQueryResult[]> {
    if (occurrenceIds.length === 0) {
      return [];
    }

    const filtersOr = occurrenceIds.map((id) => `meeting_and_occurrence_id:${id}`);

    logger.debug(req, 'get_my_documents', 'Fetching past meeting transcripts via filters_or', {
      occurrence_count: occurrenceIds.length,
    });

    return fetchAllQueryResources<PastMeetingTranscriptQueryResult>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<PastMeetingTranscriptQueryResult>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        v: '1',
        type: 'v1_past_meeting_transcript',
        filters_or: filtersOr,
        ...(pageToken && { page_token: pageToken }),
      })
    ).catch((err) => {
      logger.warning(req, 'get_my_documents', 'Failed to fetch past meeting transcripts', {
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      return [];
    });
  }

  private mapPastMeetingTranscripts(transcripts: PastMeetingTranscriptQueryResult[], meetingDetails: MeetingDetails): MyDocumentItem[] {
    return transcripts.map((t): MyDocumentItem => {
      const meeting = meetingDetails.get(t.meeting_id);
      const url = t.sessions?.[0]?.share_url ?? t.recording_files?.[0]?.download_url;
      return {
        id: `past_meeting_transcript:${t.id}`,
        name: t.title || 'Transcript',
        source: 'transcript' as MyDocumentSource,
        foundationName: '',
        foundationUid: meeting?.project_uid || undefined,
        groupOrMeetingName: meeting?.title || '',
        groupOrMeetingUid: t.meeting_and_occurrence_id,
        date: t.start_time || t.created_at,
        url,
        pastMeetingId: t.meeting_and_occurrence_id,
      };
    });
  }

  // ─── Past Meeting Summaries ──────────────────────────────────────────────────

  private async fetchRawPastMeetingSummaries(req: Request, occurrenceIds: string[]): Promise<PastMeetingSummaryQueryResult[]> {
    if (occurrenceIds.length === 0) {
      return [];
    }

    const filtersOr = occurrenceIds.map((id) => `meeting_and_occurrence_id:${id}`);

    logger.debug(req, 'get_my_documents', 'Fetching past meeting summaries via filters_or', {
      occurrence_count: occurrenceIds.length,
    });

    return fetchAllQueryResources<PastMeetingSummaryQueryResult>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<PastMeetingSummaryQueryResult>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        v: '1',
        type: 'v1_past_meeting_summary',
        filters_or: filtersOr,
        ...(pageToken && { page_token: pageToken }),
      })
    ).catch((err) => {
      logger.warning(req, 'get_my_documents', 'Failed to fetch past meeting summaries', {
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      return [];
    });
  }

  private mapPastMeetingSummaries(summaries: PastMeetingSummaryQueryResult[], meetingDetails: MeetingDetails): MyDocumentItem[] {
    return summaries.map((s): MyDocumentItem => {
      const meeting = meetingDetails.get(s.meeting_id);
      return {
        id: `past_meeting_summary:${s.id}`,
        name: s.summary_title || s.zoom_meeting_topic || 'Meeting Summary',
        source: 'summary' as MyDocumentSource,
        foundationName: '',
        foundationUid: meeting?.project_uid || undefined,
        groupOrMeetingName: meeting?.title || '',
        groupOrMeetingUid: s.meeting_and_occurrence_id,
        date: s.summary_start_time || s.created_at,
        pastMeetingId: s.meeting_and_occurrence_id,
      };
    });
  }
}
