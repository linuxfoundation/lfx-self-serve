// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BEHAVIORAL_CLASS_TONE } from '../constants/committees.constants';
import { CommitteeMemberRole } from '../enums/committee-member.enum';
import { CdpProjectAffiliation, MyCommittee, ProfileGroupItem, ProfileInvolvementItem } from '../interfaces';
import { getGroupBehavioralClass, getGroupCommands } from './committee.utils';
import { formatYearMonth } from './date-time.utils';

/**
 * The Profile page's Foundations & projects involvement (#6085): the user's LFX projects, read the way the hub's affiliations
 * tab reads them. The first role decides the Maintainer or Contributor badge; the dates span the whole involvement, every role
 * (or, with no roles, every project affiliation), and a project is current while any of those is open. Current projects come
 * first, then the newest start, then by name. `lfxSlugs` null keeps every project, as the hub does when the slug list is unavailable.
 */
export function buildProfileInvolvement(affiliations: CdpProjectAffiliation[], lfxSlugs: ReadonlySet<string> | null): ProfileInvolvementItem[] {
  return affiliations
    .filter((project) => project.projectSlug && (!lfxSlugs || lfxSlugs.has(project.projectSlug)))
    .map((project): ProfileInvolvementItem => {
      const spans = (project.roles.length > 0 ? project.roles : project.affiliations.filter((affiliation) => affiliation.type === 'project')).map((span) => ({
        start: span.startDate || '',
        end: span.endDate || '',
      }));
      const current = spans.length === 0 || spans.some((span) => !span.end);
      const start =
        spans
          .map((span) => span.start)
          .filter(Boolean)
          .sort()[0] ?? '';
      const end = current
        ? ''
        : (spans
            .map((span) => span.end)
            .sort()
            .at(-1) ?? '');
      return {
        id: project.id,
        name: project.projectName,
        logo: project.projectLogo,
        role: project.roles[0]?.role === 'Maintainer' ? 'Maintainer' : 'Contributor',
        current,
        years: involvementLabel(start.slice(0, 4), end.slice(0, 4)),
        period: involvementLabel(formatYearMonth(start), formatYearMonth(end)),
        start,
      };
    })
    .sort((a, b) => Number(b.current) - Number(a.current) || b.start.localeCompare(a.start) || a.name.localeCompare(b.name));
}

// "Since {from}" while current, "{from} – {to}" once ended, or just "{from}" when both ends match; '' without a start.
function involvementLabel(from: string, to: string): string {
  if (!from) return '';
  if (!to) return `Since ${from}`;
  return from === to ? from : `${from} – ${to}`;
}

/** The order group types show in on the Profile page: boards first, then technical and other committees, then working groups. */
const PROFILE_GROUP_TYPE_ORDER = ['Board', 'Technical', 'Committee', 'Working group'];

/**
 * The Profile page's Group participation (#6086): the user's group seats, each with the design's type (Board, Technical,
 * Committee or Working group, else the group's own category) in its Groups page colour. Boards come first, then technical
 * and other committees, then working groups, then the rest, each by name.
 */
export function buildProfileGroups(committees: MyCommittee[]): ProfileGroupItem[] {
  return committees
    .map((committee): ProfileGroupItem => {
      const behavioralClass = getGroupBehavioralClass(committee.category);
      const org = committee.foundation_name || committee.project_name || '';
      const name = committee.display_name || committee.name;
      return {
        uid: committee.uid,
        commands: getGroupCommands(committee) ?? ['/groups', committee.uid],
        queryParams: committee.project_slug ? { project: committee.project_slug } : null,
        ariaLabel: org ? `${name}, ${org}` : name,
        org,
        orgLogo: committee.project_logo_url || '',
        name,
        description: committee.description?.trim() || '',
        type: profileGroupType(behavioralClass, committee.category),
        typeTone: BEHAVIORAL_CLASS_TONE[behavioralClass],
        // A seat with no named role reads as a plain membership.
        role: committee.my_role && committee.my_role !== CommitteeMemberRole.NONE ? committee.my_role : 'Member',
        members: committee.total_members === 1 ? '1 member' : `${committee.total_members ?? 0} members`,
      };
    })
    .sort((a, b) => typeRank(a.type) - typeRank(b.type) || a.name.localeCompare(b.name));
}

// The design's four types; a group outside them keeps its own category.
function profileGroupType(behavioralClass: ReturnType<typeof getGroupBehavioralClass>, category: string | undefined): string {
  if (behavioralClass === 'governing-board') return 'Board';
  // Technical committees go by their full name or their TSC, TOC or TAC abbreviation.
  if (behavioralClass === 'oversight-committee') return /technical|^t[soa]c$/i.test(category?.trim() ?? '') ? 'Technical' : 'Committee';
  if (behavioralClass === 'working-group') return 'Working group';
  return category?.trim() || 'Group';
}

function typeRank(type: string): number {
  const rank = PROFILE_GROUP_TYPE_ORDER.indexOf(type);
  return rank === -1 ? PROFILE_GROUP_TYPE_ORDER.length : rank;
}
