// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Page, Route } from '@playwright/test';

import type { ProjectApplication, ProjectApplicationAnswers } from '@lfx-one/shared/interfaces';

/**
 * Stateful route mocks for the project-application BFF (#3037). Each write mutates an in-memory list
 * and bumps `revision`, and every mutation asserts the `If-Match` it received equals the held
 * revision (a mismatch returns 412), so the specs prove the UI sends the right revision.
 */

export const PROPOSAL_UID = '3f2b8c1e-7a4d-4e1b-9c2a-5d6e7f8a9b0c';
export const PARENT_PROJECT_UID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

export interface ProjectApplicationMockState {
  applications: ProjectApplication[];
  requests: { method: string; path: string; ifMatch: string | null; body: unknown }[];
  isFormationTeam: boolean;
}

export function buildProposal(overrides: Partial<ProjectApplication> = {}): ProjectApplication {
  return {
    uid: PROPOSAL_UID,
    state: 'submitted',
    revision: 1,
    submitter_username: 'e2e-user',
    submitter_name: 'Casey Example',
    submitter_email: 'casey@example.org',
    target_parent_uid: null,
    application: {
      project_name: 'Harbor Signals',
      project_repository_url: 'https://github.com/harbor-signals/core',
      contributing_organization: 'Harbor Labs',
      legal_contact_email: 'legal@harbor-labs.example',
      license: 'Apache-2.0',
      mission_statement: 'The Mission of the Project is to share signals.',
      description: 'A shared signals exchange.',
      future_question: 'kept',
    },
    created_at: '2026-09-20T10:00:00Z',
    updated_at: '2026-09-21T10:00:00Z',
    ...overrides,
  };
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) });
}

export async function mockProjectApplicationApis(
  page: Page,
  initial: ProjectApplication[] = [],
  isFormationTeam = false
): Promise<ProjectApplicationMockState> {
  const state: ProjectApplicationMockState = { applications: [...initial], requests: [], isFormationTeam };

  await page.route('**/api/project-applications**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/project-applications/, '');
    const method = request.method();
    const ifMatch = request.headers()['if-match'] ?? null;
    const body = request.postDataJSON?.() ?? null;
    state.requests.push({ method, path, ifMatch, body });

    if (method === 'GET' && path === '/mine') return json(route, 200, state.applications);
    if (method === 'GET' && path === '/queue') return json(route, 200, state.applications);
    if (method === 'GET' && path === '/access') return json(route, 200, { is_formation_team: state.isFormationTeam });

    if (method === 'POST' && (path === '' || path === '/')) {
      const created = buildProposal({
        uid: PROPOSAL_UID,
        revision: 1,
        application: (body as { application: ProjectApplicationAnswers }).application,
        created_at: '2026-09-27T10:00:00Z',
        updated_at: '2026-09-27T10:00:00Z',
      });
      state.applications = [created, ...state.applications.filter((app) => app.uid !== created.uid)];
      return json(route, 201, { application: created, etag: null });
    }

    const match = /^\/([^/]+)(?:\/(withdraw|accept|deny))?$/.exec(path);
    const current = match ? state.applications.find((app) => app.uid === match[1]) : undefined;
    if (!match || !current) return json(route, 404, { error: 'Not found' });
    if (ifMatch !== String(current.revision)) return json(route, 412, { error: 'The application changed since it was loaded', code: 'PRECONDITION_FAILED' });

    if (method === 'DELETE') {
      state.applications = state.applications.filter((app) => app.uid !== current.uid);
      return route.fulfill({ status: 204, body: '' });
    }

    const action = match[2];
    let next: ProjectApplication;
    if (method === 'PUT') {
      next = { ...current, application: (body as { application: ProjectApplicationAnswers }).application, revision: current.revision + 1 };
    } else if (action === 'accept') {
      // The BFF revises (parent) then accepts: two revisions.
      next = {
        ...current,
        application: {
          ...(body as { application: ProjectApplicationAnswers }).application,
          parent_project_uid: (body as { parent_project_uid: string }).parent_project_uid,
        },
        state: 'accepted',
        revision: current.revision + 2,
      };
    } else {
      next = { ...current, state: action === 'withdraw' ? 'withdrawn' : 'denied', revision: current.revision + 1 };
    }
    next.updated_at = '2026-09-27T12:00:00Z';
    state.applications = state.applications.map((app) => (app.uid === next.uid ? next : app));
    return json(route, 200, { application: next, etag: String(next.revision) });
  });

  await page.route('**/api/projects/search*', (route) => json(route, 200, [{ uid: PARENT_PROJECT_UID, slug: 'harbor-foundation', name: 'Harbor Foundation' }]));

  return state;
}
