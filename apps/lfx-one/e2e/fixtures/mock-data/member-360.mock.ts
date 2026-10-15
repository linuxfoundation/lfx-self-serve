// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_DOCUMENT_TYPES } from '@lfx-one/shared/constants';
import type { Member360Envelope, MktgDocumentListItem, MktgRevisionResponse, Project } from '@lfx-one/shared/interfaces';
import { SYNTHETIC_ORG_NAME, SYNTHETIC_SECOND_ORG_LEGAL_NAME } from './synthetic-org.mock';

export const MEMBER_360_PROJECT: Project = {
  uid: 'sample-project',
  slug: 'sample-foundation',
  name: 'Sample Foundation',
  description: 'Synthetic test project',
  writer: true,
  public: true,
  parent_uid: '',
  stage: 'graduated',
  category: 'project',
  funding_model: [],
  charter_url: '',
  legal_entity_type: '',
  legal_entity_name: '',
  legal_parent_uid: '',
  autojoin_enabled: false,
  formation_date: '2026-01-01',
  logo_url: '',
  repository_url: '',
  website_url: '',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  mailing_list_count: 0,
};

export function member360DocumentType() {
  const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey === 'member-360');
  if (!type) throw new Error('Member 360 document type is missing from the test catalog.');
  return type;
}

export const MEMBER_360_DOCUMENT_ID = 'run-0123456789abcdef01234567';
export const MEMBER_360_REVISION_ID = `000001-${'a'.repeat(64)}`;
export const MEMBER_360_STORED_DOCUMENT: MktgDocumentListItem = {
  agentKey: 'member-360',
  documentId: MEMBER_360_DOCUMENT_ID,
  revisionCount: 1,
  approvedCurrent: null,
  latestRevisionId: MEMBER_360_REVISION_ID,
  createdAt: '2026-10-01T12:00:00Z',
  updatedAt: '2026-10-01T12:00:00Z',
};
export function member360Revision(): MktgRevisionResponse {
  const revision = {
    id: MEMBER_360_REVISION_ID,
    number: 1,
    createdAt: '2026-10-01T12:00:00Z',
    origin: 'generated' as const,
    restoredFromNumber: null,
    intakeMode: 'form' as const,
    status: '',
    contentSha256: 'a'.repeat(64),
    format: 'markdown' as const,
    commentCount: 0,
    latest: true,
    approval: null,
    author: null,
  };
  const envelope = member360Fixture();
  return {
    project: MEMBER_360_PROJECT.uid,
    type: member360DocumentType(),
    documentId: MEMBER_360_DOCUMENT_ID,
    revisions: [revision],
    approvedCurrent: null,
    approval: null,
    revision,
    markdown: 'Synthetic summary',
    sidecar: { member360: envelope },
    member360: envelope,
  };
}

export function member360Fixture(): Member360Envelope {
  const envelope: Member360Envelope = {
    contract: 'member-360-output/v1',
    kind: 'member-360',
    project: 'sample-foundation',
    project_name: 'Sample Foundation',
    version: 1,
    period: {
      window_start: '2025-10-01',
      window_end: '2026-09-30',
      focus_quarter: '2026-Q3',
      label: '2026-Q3',
    },
    run_date: '2026-10-01',
    summary_markdown: 'Synthetic evidence from the sample foundation. Synthetic evidence from the sample foundation. ',
    tabs: {
      summary: {
        project_name: 'Sample Foundation',
        analysis_window: {
          start: '2025-10-01',
          end: '2026-09-30',
        },
        run_date: '2026-10-01',
        member_count: 2,
        total_membership_value: 50000,
        tier_distribution: {
          Champion: 1,
          Engaged: 0,
          Passive: 0,
          'At Risk': 1,
          Dormant: 0,
        },
        movers: null,
        watchlist: [
          {
            member_organization: SYNTHETIC_ORG_NAME,
            days_to_renewal: 47,
            engagement_score: 38,
            engagement_tier: 'At Risk',
          },
        ],
        action_load: [
          {
            owner: 'Marketing',
            actions: 0,
            high_priority: 0,
          },
          {
            owner: 'Member Success',
            actions: 1,
            high_priority: 1,
          },
          {
            owner: 'Sales',
            actions: 1,
            high_priority: 0,
          },
        ],
        data_coverage: {
          sources_used: ['LFX Platform connector'],
          sources_unavailable: ['Web research', 'Uploaded trackers', 'HubSpot', 'Social listening', 'Google Drive'],
        },
      },
      member_ranking: [
        {
          rank: 2,
          member_organization: SYNTHETIC_ORG_NAME,
          membership_tier: 'General',
          annual_value: 25000,
          renewal_date: '2026-11-17',
          days_to_renewal: 47,
          engagement_score: 38,
          engagement_tier: 'At Risk',
          trend: null,
          committees_score: 40,
          events_score: 40,
          speaking_score: 40,
          content_score: 40,
          community_programs_score: 40,
          marketing_social_score: null,
          last_meaningful_engagement: null,
          engaged_contacts: 0,
          key_contact: null,
          top_gaps: ['No speaking activity in this window'],
          recommended_next_action: 'Schedule renewal review before 17 November',
          action_owner: 'Member Success',
          priority: 'High',
        },
        {
          rank: 1,
          member_organization: SYNTHETIC_SECOND_ORG_LEGAL_NAME,
          membership_tier: 'General',
          annual_value: 25000,
          renewal_date: '2026-11-17',
          days_to_renewal: 312,
          engagement_score: 92,
          engagement_tier: 'Champion',
          trend: null,
          committees_score: 40,
          events_score: 40,
          speaking_score: 40,
          content_score: 40,
          community_programs_score: 40,
          marketing_social_score: null,
          last_meaningful_engagement: null,
          engaged_contacts: 0,
          key_contact: null,
          top_gaps: [],
          recommended_next_action: 'Schedule renewal review before 17 November',
          action_owner: 'Sales',
          priority: 'Low',
        },
      ],
      category_detail: [
        {
          member_organization: SYNTHETIC_ORG_NAME,
          categories: {
            committees: {
              status: 'scored',
              raw_count: 0,
              recency_weighted_count: 0,
              tier_peer_median: 0,
              score: 0,
            },
            events: {
              status: 'scored',
              raw_count: 0,
              recency_weighted_count: 0,
              tier_peer_median: 0,
              score: 0,
            },
            speaking: {
              status: 'scored',
              raw_count: 0,
              recency_weighted_count: 0,
              tier_peer_median: 0,
              score: 0,
            },
            content: {
              status: 'scored',
              raw_count: 0,
              recency_weighted_count: 0,
              tier_peer_median: 0,
              score: 0,
            },
            community_programs: {
              status: 'scored',
              raw_count: 0,
              recency_weighted_count: 0,
              tier_peer_median: 0,
              score: 0,
            },
            marketing_social: {
              status: 'scored',
              raw_count: 0,
              recency_weighted_count: 0,
              tier_peer_median: 0,
              score: 0,
            },
          },
        },
      ],
      actions_by_team: [
        {
          owner: 'Member Success',
          priority: 'High',
          member_organization: SYNTHETIC_ORG_NAME,
          engagement_tier: 'At Risk',
          days_to_renewal: 47,
          recommended_action: 'Schedule renewal review before 17 November',
          supporting_rationale: 'Renewal within 120 days and engagement at risk.',
          suggested_deadline: '2026-10-15',
          routing_rule: 1,
        },
        {
          owner: 'Sales',
          priority: 'High',
          member_organization: SYNTHETIC_SECOND_ORG_LEGAL_NAME,
          engagement_tier: 'At Risk',
          days_to_renewal: 47,
          recommended_action: 'Schedule renewal review before 17 November',
          supporting_rationale: 'Renewal within 120 days and engagement at risk.',
          suggested_deadline: '2026-10-15',
          routing_rule: 1,
        },
      ],
      evidence: [
        {
          member_organization: SYNTHETIC_ORG_NAME,
          category: 'committees',
          date: '2026-09-30',
          description: 'Member committee attendance',
          source: 'LFX Platform connector',
          signal_weight: 1,
        },
      ],
      method: {
        analysis_window: {
          start: '2025-10-01',
          end: '2026-09-30',
        },
        focus_quarter: '2026-Q3',
        run_date: '2026-10-01',
        weights_default: {
          committees: 0,
          events: 0,
          speaking: 0,
          content: 0,
          community_programs: 0,
          marketing_social: 0,
        },
        weights_used: {
          committees: 0,
          events: 0,
          speaking: 0,
          content: 0,
          community_programs: 0,
          marketing_social: 0,
        },
        reweighted: false,
        categories_no_data: [
          {
            category: 'committees',
            reason: 'Synthetic evidence from the sample foundation. ',
          },
        ],
        quarter_decay: [
          {
            quarter: '2026-Q3',
            factor: 1,
          },
          {
            quarter: '2026-Q2',
            factor: 0.75,
          },
          {
            quarter: '2026-Q1',
            factor: 0.5,
          },
          {
            quarter: '2025-Q4',
            factor: 0.25,
          },
        ],
        tier_baselines: [
          {
            baseline_group: 'Synthetic evidence from the sample foundation. ',
            tiers: ['Synthetic evidence from the sample foundation. '],
            member_count: 1,
            merged: false,
            medians: {},
          },
        ],
        routing_rule_version: 'Synthetic evidence from the sample foundation. ',
        data_sources: [
          {
            source: 'lfx_platform',
            label: 'lfx_platform',
            status: 'used',
          },
          {
            source: 'uploaded_trackers',
            label: 'uploaded_trackers',
            status: 'not_wired',
          },
          {
            source: 'hubspot',
            label: 'hubspot',
            status: 'not_wired',
          },
          {
            source: 'social_listening',
            label: 'social_listening',
            status: 'not_wired',
          },
          {
            source: 'web_research',
            label: 'web_research',
            status: 'not_wired',
          },
          {
            source: 'google_drive',
            label: 'google_drive',
            status: 'not_wired',
          },
        ],
        overrides: [],
        notes: ['Synthetic fixture only'],
      },
    },
    content_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    warnings: [],
    inputs: {
      trackers_provided: false,
      prior_run_provided: false,
      weight_overrides_provided: false,
    },
    intake: {
      completed_at: '2026-10-01T12:00:00.000Z',
      mode: 'form',
    },
    generated_at: '2026-10-01T12:00:00.000Z',
    agent: {
      agent_version: '1.0.0',
      prompt_manifest_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    project_uid: 'sample-project',
    project_slug: 'sample-foundation',
  };
  // SHA-256 of JSON.stringify(envelope.tabs); pinned so browser unit tests need no node crypto.
  envelope.content_sha256 = '547deb4170de08dfa3a0f879ae80b35eb3b198f2beb38ace2d13cd7e5f5b3db5';
  return envelope;
}
