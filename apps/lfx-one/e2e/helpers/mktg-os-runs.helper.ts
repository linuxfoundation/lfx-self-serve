// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
  LENS_COOKIE_KEY,
  MKTG_DOCUMENT_TYPES,
  MKTG_OS_AGENTS_ENABLED_FLAG,
  PERSONA_COOKIE_KEY,
  SELECTED_PROJECT_COOKIE_KEY,
} from '@lfx-one/shared/constants';
import type { MktgDocumentRunProgress, MktgRevisionResponse, MktgRevisionSummary, PersistedPersonaState, Project } from '@lfx-one/shared/interfaces';
import { expect, Page, Route } from '@playwright/test';
import { getMktgSessionOutcome } from '@lfx-one/shared/utils/mktg-session-event.utils';

import { mockProjects } from '../fixtures/mock-data/projects.mock';
import { ApiMockHelper } from './api-mock.helper';
import { suppressCookieBanner } from './account-settings-email.helper';

export const RUN_PROJECT = { uid: 'p0000000-0000-0000-0000-000000000719', slug: 'synthetic-orbit', name: 'Synthetic Orbit' };
export const RUN_REVISION_ID = `000001-${'a'.repeat(64)}`;
export const DATA_LOAD_TIMEOUT = 20_000;
export const FAILED_RUN_REPLY = 'The batch intake was rejected. <b>Provide project sources.</b>';
const failedSession = [
  JSON.stringify({ type: 'agent_notification_message', content: { type: 'text', data: FAILED_RUN_REPLY } }),
  JSON.stringify({ type: 'runtime_done', task: { id: 'synthetic-task', entity_type: 'EntTaskAgent' } }),
];

function revision(number: number): MktgRevisionSummary {
  return {
    id: `00000${number}-${(number === 1 ? 'a' : 'b').repeat(64)}`,
    number,
    createdAt: '2026-10-15T12:00:00.000Z',
    origin: 'generated',
    restoredFromNumber: null,
    intakeMode: 'form',
    status: 'Draft — for review',
    contentSha256: (number === 1 ? 'a' : 'b').repeat(64),
    commentCount: 0,
    latest: true,
  };
}

export function runRevision(agentKey = 'brand-kit', number = 2): MktgRevisionResponse {
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === agentKey);
  if (!type) {
    throw new Error(`Unknown Marketing OS document type in run fixture: ${agentKey}`);
  }
  const current = revision(number);
  return {
    project: RUN_PROJECT.uid,
    type,
    documentId: 'living',
    revisions: [current],
    revision: current,
    markdown: `# Synthetic revision ${number}\n\nA draft for a synthetic project.`,
    source: {
      sessionId: 'synthetic-session',
      draftVersion: number,
      intakeMode: 'form',
      ...(agentKey === 'foundation-message' && { readme: { fetched: false, skipReason: 'no-readme' as const } }),
    },
  };
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Synthetic project, flag and every Marketing OS request are stubbed; no live Guild session or write is possible. */
export async function setupRunPage(
  page: Page,
  options: {
    existing?: boolean;
    writer?: boolean;
    fail?: boolean;
    holdRead?: boolean;
    holdPersistence?: boolean;
    serverState?: { started: boolean; generated: boolean; persisted: boolean; startedAt: string };
  } = {}
) {
  await suppressCookieBanner(page);
  const writer = options.writer ?? true;
  mockProjects[RUN_PROJECT.slug] = {
    ...RUN_PROJECT,
    writer,
    repository_url: 'https://github.com/synthetic-org/synthetic-orbit',
    description: 'A synthetic open source project.',
  } as Project;
  await ApiMockHelper.setupProjectSlugMock(page, { writer });
  await page.addInitScript(
    ([key, flag]) => localStorage.setItem(key, JSON.stringify({ [flag]: true })),
    [FEATURE_FLAG_OVERRIDE_STORAGE_KEY, MKTG_OS_AGENTS_ENABLED_FLAG]
  );
  const persona: PersistedPersonaState = { primary: 'executive-director', all: ['executive-director'] };
  const cookies = [
    { name: PERSONA_COOKIE_KEY, value: encodeURIComponent(JSON.stringify(persona)) },
    { name: LENS_COOKIE_KEY, value: 'project' },
    { name: SELECTED_PROJECT_COOKIE_KEY, value: encodeURIComponent(JSON.stringify(RUN_PROJECT)) },
  ].map((cookie) => ({ ...cookie, domain: 'localhost', path: '/', sameSite: 'Lax' as const }));
  await page.context().addCookies(cookies);
  await page.route('**/api/user/personas*', (route) =>
    json(route, { personas: ['executive-director'], personaProjects: {}, projects: [], organizations: [], isRootWriter: true })
  );
  await page.route('**/api/projects/*/sfid*', (route) => json(route, { sfid: null }));
  await page.route('**/api/nav/lens-items*', (route) => {
    const lens = new URL(route.request().url()).searchParams.get('lens');
    return json(route, {
      items: lens === 'project' ? [{ ...RUN_PROJECT, isFoundation: false, logoUrl: null }] : [],
      next_page_token: null,
      upstream_failed: false,
      lens,
    });
  });
  const serverState = options.serverState ?? { started: false, generated: false, persisted: !options.holdPersistence, startedAt: new Date().toISOString() };
  const progress = (): MktgDocumentRunProgress[] => {
    if (!serverState.started || (serverState.generated && serverState.persisted)) {
      return [];
    }
    let state: MktgDocumentRunProgress['state'] = 'writing';
    if (options.fail) {
      state = 'failed';
    } else if (serverState.generated) {
      state = 'storing';
    }
    return [
      {
        project: RUN_PROJECT.uid,
        agentKey: 'brand-kit',
        documentId: 'living',
        runId: 'c'.repeat(64),
        startedAt: serverState.startedAt,
        state,
        ...(options.fail && { failureText: getMktgSessionOutcome(failedSession).replyText }),
      },
    ];
  };
  let submitted: Record<string, unknown> | null = null;
  let releaseRead: () => void = () => undefined;
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  await page.route('**/api/mktg-agents/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith('/generate')) {
      submitted = route.request().postDataJSON();
      if (!serverState.started) {
        serverState.startedAt = new Date().toISOString();
      }
      serverState.started = true;
      return json(route, { sessionId: 'synthetic-session', ownerToken: 'synthetic-owner-token' });
    }
    if (path.endsWith('/result')) {
      if (options.fail) {
        return json(route, { status: 'failed', failureText: getMktgSessionOutcome(failedSession).replyText });
      }
      const response = runRevision('brand-kit', options.existing ? 2 : 1);
      const persistence = serverState.persisted
        ? {
            s3_key: 'synthetic-key',
            content_sha256: response.revision.contentSha256,
            version: response.revision.number,
            project: RUN_PROJECT.uid,
            document: { agentKey: 'brand-kit', documentId: 'living', revisionId: response.revision.id },
          }
        : undefined;
      return json(
        route,
        serverState.generated
          ? {
              status: 'ready',
              documentMarkdown: response.markdown,
              version: response.revision.number,
              ...(persistence && { persistence }),
            }
          : { status: 'pending' }
      );
    }
    if (path === '/api/mktg-agents/documents') {
      if (!writer) {
        return json(route, { message: 'Write access required' }, 403);
      }
      const saved = !!options.existing || (serverState.generated && serverState.persisted);
      const current = runRevision('brand-kit', serverState.generated && options.existing ? 2 : 1);
      return json(route, {
        project: RUN_PROJECT.uid,
        runs: progress(),
        groups: MKTG_DOCUMENT_TYPES.map((type) => ({
          type,
          documents:
            saved && type.agentKey === 'brand-kit'
              ? [
                  {
                    agentKey: type.agentKey,
                    documentId: 'living',
                    revisionCount: current.revision.number,
                    latestRevisionId: current.revision.id,
                    createdAt: serverState.startedAt,
                    updatedAt: serverState.startedAt,
                  },
                ]
              : [],
        })),
      });
    }
    if (path.includes('/documents/')) {
      if (options.holdRead) {
        await readGate;
      }
      if (!writer) {
        return json(route, { message: 'Write access required' }, 403);
      }
      const agentKey = path.split('/documents/')[1].split('/')[0];
      const runs = progress().filter((run) => run.agentKey === agentKey);
      const response = runRevision(agentKey, serverState.generated && serverState.persisted && options.existing ? 2 : 1);
      if (!options.existing && !(serverState.generated && serverState.persisted)) {
        if (!runs.length || path.includes('/revisions/')) {
          return json(route, { message: 'Not generated yet' }, 404);
        }
        return json(route, { project: RUN_PROJECT.uid, type: response.type, documentId: 'living', revisions: [], runs });
      }
      return json(route, { ...response, runs });
    }
    // Neither live dependencies nor accidental unmocked Marketing OS routes may escape this helper.
    return json(route, { message: 'No synthetic stored document' }, 404);
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  await page.context().addCookies(cookies);
  return {
    serverState,
    finish: () => {
      serverState.generated = true;
    },
    persist: () => {
      serverState.persisted = true;
    },
    releaseRead: () => releaseRead(),
    submitted: () => submitted,
    open: async (surface = 'brand-kit') => {
      await page.evaluate((url) => {
        window.history.pushState({}, '', url);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, `/project/mktg-os-agents/${surface}?project=${RUN_PROJECT.slug}`);
    },
  };
}

export async function fillRunIntake(page: Page): Promise<void> {
  const controls = page.locator('input[data-test^="mktg-intake-"], textarea[data-test^="mktg-intake-"]');
  for (const control of await controls.all()) {
    const key = await control.getAttribute('data-test');
    await control.fill(key?.endsWith('github_url') ? 'https://github.com/synthetic-org/synthetic-orbit' : 'A synthetic answer for the required question.');
  }
}
