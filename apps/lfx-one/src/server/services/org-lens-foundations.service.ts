// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  GovernanceParticipationBucket,
  MembershipTierClass,
  OrgLensFoundationProject,
  OrgLensFoundationRow,
  OrgLensFoundationsAndProjectsResponse,
  OrgLensFoundationsStatStrip,
  OrgLensRowKind,
  OrgRoleBadge,
  ProjectInfluenceBucket,
  VotingStatusBadge,
} from '@lfx-one/shared/interfaces';

import { SnowflakeService } from './snowflake.service';

/**
 * Raw row shape returned by the joined query (foundations rollup LEFT
 * JOIN per-project detail on (account_id, foundation_id)). One row per
 * (account_id, foundation_id, project_id); foundations with zero
 * involved projects emit a single row with all PROJECT_* columns null.
 * Sentinel foundation_id '__outside_lf__' identifies the Outside-LF
 * umbrella row.
 *
 * Kept private to this service — only cross-layer types live in
 * @lfx-one/shared.
 */
interface RawRow {
  ACCOUNT_ID: string;
  ACCOUNT_NAME: string;
  FOUNDATION_ID: string;
  FOUNDATION_SLUG: string | null;
  FOUNDATION_NAME: string;
  FOUNDATION_LOGO_URL: string | null;
  IS_MEMBER: boolean;
  IS_OUTSIDE_LF: boolean;
  MEMBERSHIP_TIER_CLASS: MembershipTierClass | null;
  MEMBERSHIP_TIER_DISPLAY_NAME: string | null;
  TIER_RANK: number | null;
  PROJECT_COUNT_LF: number;
  INFLUENCE_LEADING_COUNT: number;
  INFLUENCE_CONTRIBUTING_COUNT: number;
  INFLUENCE_PARTICIPATING_COUNT: number;
  INFLUENCE_SILENT_COUNT: number;
  BOARD_MEMBER_SEAT_COUNT: number;
  COMMITTEE_MEMBER_SEAT_COUNT: number;
  MEETINGS_THIS_WEEK_TOTAL: number;
  MEETINGS_THIS_WEEK_BOARD: number;
  MEETINGS_THIS_WEEK_TECHNICAL: number;
  MEETINGS_THIS_WEEK_MARKETING: number;
  MEETINGS_THIS_WEEK_WORKING_GROUP: number;
  MEETINGS_THIS_WEEK_OTHER: number;
  GOVERNANCE_ATTENDANCE_PCT: number | null;
  GOVERNANCE_PARTICIPATION_BUCKET: GovernanceParticipationBucket | null;
  ORG_ROLE: OrgRoleBadge;
  VOTING_STATUS: VotingStatusBadge;
  ROW_KIND: OrgLensRowKind;
  PROJECT_ID: string | null;
  PROJECT_SLUG: string | null;
  PROJECT_NAME: string | null;
  PROJECT_IS_LF_PROJECT: boolean | null;
  PROJECT_INFLUENCE_MAX_BUCKET: ProjectInfluenceBucket | null;
  PROJECT_MAINTAINERS_COUNT: number | null;
  PROJECT_CONTRIBUTORS_COUNT: number | null;
  PROJECT_COLLABORATORS_COUNT: number | null;
  PROJECT_COMMITS_COUNT: number | null;
}

/**
 * Service for the Org Lens "Foundations and Projects" section.
 *
 * Reads from two pre-aggregated upstream tables:
 * - the foundations rollup — one row per (account_id, foundation_id)
 * - the per-project detail — one row per (account_id, foundation_id, project_id)
 *
 * Single Snowflake query per render.
 * Returns an empty envelope (200 + empty rows) for orgs with zero
 * engagement — NEVER a 404.
 */
export class OrgLensFoundationsService {
  private snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  public async getFoundationsAndProjects(accountId: string): Promise<OrgLensFoundationsAndProjectsResponse> {
    // Single LEFT JOIN against the two pre-aggregated rollups. ORDER BY is
    // CASE-guarded so `project_count_lf` only sorts non-member LF rows and
    // NEVER member rows (which sort by tier_rank then foundation_name).
    // Inner projects array is sorted by commits DESC.
    const query = `
      SELECT
        f.ACCOUNT_ID,
        f.ACCOUNT_NAME,
        f.FOUNDATION_ID,
        f.FOUNDATION_SLUG,
        f.FOUNDATION_NAME,
        f.FOUNDATION_LOGO_URL,
        f.IS_MEMBER,
        f.IS_OUTSIDE_LF,
        f.MEMBERSHIP_TIER_CLASS,
        f.MEMBERSHIP_TIER_DISPLAY_NAME,
        f.TIER_RANK,
        f.PROJECT_COUNT_LF,
        f.INFLUENCE_LEADING_COUNT,
        f.INFLUENCE_CONTRIBUTING_COUNT,
        f.INFLUENCE_PARTICIPATING_COUNT,
        f.INFLUENCE_SILENT_COUNT,
        f.BOARD_MEMBER_SEAT_COUNT,
        f.COMMITTEE_MEMBER_SEAT_COUNT,
        f.MEETINGS_THIS_WEEK_TOTAL,
        f.MEETINGS_THIS_WEEK_BOARD,
        f.MEETINGS_THIS_WEEK_TECHNICAL,
        f.MEETINGS_THIS_WEEK_MARKETING,
        f.MEETINGS_THIS_WEEK_WORKING_GROUP,
        f.MEETINGS_THIS_WEEK_OTHER,
        f.GOVERNANCE_ATTENDANCE_PCT,
        f.GOVERNANCE_PARTICIPATION_BUCKET,
        f.ORG_ROLE,
        f.VOTING_STATUS,
        f.ROW_KIND,
        p.PROJECT_ID                                   AS PROJECT_ID,
        p.PROJECT_SLUG                                 AS PROJECT_SLUG,
        p.PROJECT_NAME                                 AS PROJECT_NAME,
        p.IS_LF_PROJECT                                AS PROJECT_IS_LF_PROJECT,
        p.INFLUENCE_MAX_BUCKET                         AS PROJECT_INFLUENCE_MAX_BUCKET,
        p.MAINTAINERS_COUNT                            AS PROJECT_MAINTAINERS_COUNT,
        p.CONTRIBUTORS_COUNT                           AS PROJECT_CONTRIBUTORS_COUNT,
        p.COLLABORATORS_COUNT                          AS PROJECT_COLLABORATORS_COUNT,
        p.COMMITS_COUNT                                AS PROJECT_COMMITS_COUNT
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_LENS_FOUNDATIONS_AND_PROJECTS f
      LEFT JOIN ANALYTICS.PLATINUM_LFX_ONE.ORG_LENS_FOUNDATION_PROJECTS_DETAIL p
        ON p.ACCOUNT_ID = f.ACCOUNT_ID
        AND p.FOUNDATION_ID = f.FOUNDATION_ID
      WHERE f.ACCOUNT_ID = ?
      ORDER BY
        CASE WHEN f.IS_OUTSIDE_LF THEN 2 WHEN f.IS_MEMBER THEN 0 ELSE 1 END,
        CASE WHEN f.IS_MEMBER THEN f.TIER_RANK END ASC NULLS LAST,
        CASE WHEN NOT f.IS_MEMBER AND NOT f.IS_OUTSIDE_LF THEN f.PROJECT_COUNT_LF END DESC NULLS LAST,
        f.FOUNDATION_NAME ASC,
        p.COMMITS_COUNT DESC NULLS LAST
    `;

    const result = await this.snowflakeService.execute<RawRow>(query, [accountId]);

    if (result.rows.length === 0) {
      return this.emptyResponse(accountId);
    }

    return this.shapeResponse(accountId, result.rows);
  }

  private shapeResponse(accountId: string, rawRows: RawRow[]): OrgLensFoundationsAndProjectsResponse {
    const accountName = rawRows[0].ACCOUNT_NAME ?? 'Unknown Account';

    // Group rows by foundation_id; the first raw row per foundation_id
    // carries the foundation-level columns. SQL ORDER BY preserves the
    // foundation sort + commits DESC inside each foundation.
    const rowsByFoundation = new Map<string, OrgLensFoundationRow>();

    // Stat-strip running totals.
    const tierBreakdown: Partial<Record<MembershipTierClass, number>> = {};
    let foundationsTotal = 0;
    let projectsLeading = 0;
    let projectsContributing = 0;
    let projectsParticipating = 0;
    let projectsSilent = 0;
    let boardMembers = 0;
    let committeeMembers = 0;
    let mtwBoard = 0;
    let mtwTechnical = 0;
    let mtwMarketing = 0;
    let mtwWorkingGroup = 0;
    let mtwOther = 0;

    for (const raw of rawRows) {
      let row = rowsByFoundation.get(raw.FOUNDATION_ID);
      if (!row) {
        // Normalize the Outside-LF umbrella row's slug at the wire boundary.
        // dbt emits FOUNDATION_ID='__outside_lf__' and FOUNDATION_SLUG also
        // equal to '__outside_lf__' (literal sentinel string, NOT null) for
        // the umbrella row. The wire value MUST be the kebab-case slug
        // 'outside-lf'. We force this for any row_kind='outside_lf'
        // regardless of what dbt sends — the sentinel is an internal
        // implementation detail and MUST NOT leak into testids, telemetry
        // payloads, or future routing keys.
        const foundationSlug = raw.ROW_KIND === 'outside_lf' ? 'outside-lf' : (raw.FOUNDATION_SLUG ?? raw.FOUNDATION_ID);
        row = {
          foundationId: raw.FOUNDATION_ID,
          foundationSlug,
          foundationName: raw.FOUNDATION_NAME,
          foundationLogoUrl: raw.FOUNDATION_LOGO_URL,
          rowKind: raw.ROW_KIND,
          membershipTierClass: raw.MEMBERSHIP_TIER_CLASS,
          membershipTierDisplayName: raw.MEMBERSHIP_TIER_DISPLAY_NAME,
          projectCount: raw.PROJECT_COUNT_LF ?? 0,
          badges: {
            orgRole: raw.ORG_ROLE,
            votingStatus: raw.VOTING_STATUS,
            // Outside LF emits NULL bucket → render em-dash.
            governanceParticipation: raw.GOVERNANCE_PARTICIPATION_BUCKET ?? '—',
            governanceAttendancePct: raw.GOVERNANCE_ATTENDANCE_PCT,
          },
          projects: [],
        };
        rowsByFoundation.set(raw.FOUNDATION_ID, row);

        // Foundations tile: count member foundations only.
        if (row.rowKind === 'member' && row.membershipTierClass) {
          foundationsTotal += 1;
          tierBreakdown[row.membershipTierClass] = (tierBreakdown[row.membershipTierClass] ?? 0) + 1;
        }

        // Governance + meetings tiles: LF foundations only.
        // Outside-LF emits zero from dbt, but skip to be explicit.
        if (row.rowKind !== 'outside_lf') {
          boardMembers += raw.BOARD_MEMBER_SEAT_COUNT ?? 0;
          committeeMembers += raw.COMMITTEE_MEMBER_SEAT_COUNT ?? 0;
          mtwBoard += raw.MEETINGS_THIS_WEEK_BOARD ?? 0;
          mtwTechnical += raw.MEETINGS_THIS_WEEK_TECHNICAL ?? 0;
          mtwMarketing += raw.MEETINGS_THIS_WEEK_MARKETING ?? 0;
          mtwWorkingGroup += raw.MEETINGS_THIS_WEEK_WORKING_GROUP ?? 0;
          mtwOther += raw.MEETINGS_THIS_WEEK_OTHER ?? 0;
        }
      }

      if (raw.PROJECT_ID && raw.PROJECT_INFLUENCE_MAX_BUCKET) {
        const project: OrgLensFoundationProject = {
          projectId: raw.PROJECT_ID,
          projectSlug: raw.PROJECT_SLUG ?? raw.PROJECT_ID,
          projectName: raw.PROJECT_NAME ?? raw.PROJECT_ID,
          isLfProject: raw.PROJECT_IS_LF_PROJECT === true,
          influence: raw.PROJECT_INFLUENCE_MAX_BUCKET,
          maintainers: raw.PROJECT_MAINTAINERS_COUNT ?? 0,
          contributors: raw.PROJECT_CONTRIBUTORS_COUNT ?? 0,
          collaborators: raw.PROJECT_COLLABORATORS_COUNT ?? 0,
          commits: raw.PROJECT_COMMITS_COUNT ?? 0,
        };
        row.projects.push(project);

        // Projects tile: count every project on every row (including
        // Outside-LF) per the influence bucket.
        switch (project.influence) {
          case 'Leading':
            projectsLeading += 1;
            break;
          case 'Contributing':
            projectsContributing += 1;
            break;
          case 'Participating':
            projectsParticipating += 1;
            break;
          case 'Silent':
            projectsSilent += 1;
            break;
        }
      }
    }

    const rows = Array.from(rowsByFoundation.values());

    const statStrip: OrgLensFoundationsStatStrip = {
      foundations: { total: foundationsTotal, breakdown: tierBreakdown },
      projects: {
        total: projectsLeading + projectsContributing + projectsParticipating + projectsSilent,
        leading: projectsLeading,
        contributing: projectsContributing,
        participating: projectsParticipating,
        silent: projectsSilent,
      },
      governanceRoles: { total: boardMembers + committeeMembers, boardMembers, committeeMembers },
      meetingsThisWeek: {
        total: mtwBoard + mtwTechnical + mtwMarketing + mtwWorkingGroup + mtwOther,
        board: mtwBoard,
        technical: mtwTechnical,
        marketing: mtwMarketing,
        workingGroup: mtwWorkingGroup,
        other: mtwOther,
      },
    };

    return { accountId, accountName, statStrip, rows };
  }

  private emptyResponse(accountId: string): OrgLensFoundationsAndProjectsResponse {
    return {
      accountId,
      accountName: '',
      statStrip: {
        foundations: { total: 0, breakdown: {} },
        projects: { total: 0, leading: 0, contributing: 0, participating: 0, silent: 0 },
        governanceRoles: { total: 0, boardMembers: 0, committeeMembers: 0 },
        meetingsThisWeek: { total: 0, board: 0, technical: 0, marketing: 0, workingGroup: 0, other: 0 },
      },
      rows: [],
    };
  }
}
