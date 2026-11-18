// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_ORG_PROJECTS_WORKSPACE_ID } from '@lfx-one/shared/constants';
import type { OrgLensProject, OrgLensProjectPerson, OrgLensProjectsResponse, OrgProjectsWorkspacesResponse } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { redactForEmployeeView } from './org-lens-employee-view.helper';

const PROJECTS_PAGE = 'projects';

/**
 * Projects rows list the employees behind each count (`maintainers`, `contributors`, `participants`), each with a
 * member id, a display name and an avatar. The page only needs how many there are, so for the all employee view each
 * person is replaced by an opaque placeholder: no member id, no name, no avatar. The length of each array (the
 * company-level count the table shows and sorts by) is kept.
 */
function anonymizePeople(people: OrgLensProjectPerson[], slug: string, role: string): OrgLensProjectPerson[] {
  return people.map((_, index) => ({ id: `${slug}:${role}:${index}`, name: '', avatarUrl: '' }));
}

function anonymizeProject(project: OrgLensProject): OrgLensProject {
  return {
    ...project,
    maintainers: anonymizePeople(project.maintainers, project.slug, 'maintainer'),
    contributors: anonymizePeople(project.contributors, project.slug, 'contributor'),
    participants: anonymizePeople(project.participants, project.slug, 'participant'),
  };
}

/** The `GET /lens/projects` payload for the caller's view: untouched in the full view, people removed in the all employee view. */
export function redactProjectsForEmployeeView(req: Request, orgUid: string, response: OrgLensProjectsResponse): OrgLensProjectsResponse {
  // Fails closed: redactForEmployeeView answers the employee view before the gate has resolved. The anonymisation is
  // applied inside the same switch by redacting first, then anonymising only when the payload was actually redacted.
  const redacted = redactForEmployeeView(req, orgUid, response, { page: PROJECTS_PAGE });
  if (redacted === response) return response;
  return { ...redacted, projects: redacted.projects.map(anonymizeProject) };
}

/**
 * Workspace names are typed by company admins and can contain a person's name or email address. In the all employee
 * view every user-created workspace is renamed to a neutral `Workspace N` (the system default keeps its own name), so
 * the page's workspace selector still works; ids, project slugs and counts are unchanged.
 */
export function redactWorkspacesForEmployeeView(req: Request, orgUid: string, response: OrgProjectsWorkspacesResponse): OrgProjectsWorkspacesResponse {
  const redacted = redactForEmployeeView(req, orgUid, response, { page: PROJECTS_PAGE });
  if (redacted === response) return response;
  let custom = 0;
  return {
    ...response,
    workspaces: response.workspaces.map((workspace) =>
      workspace.id === DEFAULT_ORG_PROJECTS_WORKSPACE_ID ? workspace : { ...workspace, name: `Workspace ${++custom}` }
    ),
  };
}
