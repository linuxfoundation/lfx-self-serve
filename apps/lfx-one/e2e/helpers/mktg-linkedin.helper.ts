// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKEDIN_API, LENS_COOKIE_KEY, MKTG_DOCUMENT_TYPES, PERSONA_COOKIE_KEY, SELECTED_PROJECT_COOKIE_KEY } from '@lfx-one/shared/constants';
import { LINKEDIN_RECORDED_CASES } from '@lfx-one/shared/constants/linkedin-post-recorded.fixture';
import { LINKEDIN_RECORDED_QUESTIONS, LINKEDIN_RECORDED_PROGRESS } from '@lfx-one/shared/constants/linkedin-post-questions.fixture';
import { parseLinkedinQuestions, linkedinRunQuestions, linkedinRunActivity } from '@lfx-one/shared/utils/linkedin-post-run.utils';
import type { LinkedinEnvelope, MktgRevisionResponse, MktgRevisionSummary } from '@lfx-one/shared/interfaces';
import { linkedinProfileFromSetup, renderLinkedinProfileMarkdown } from '@lfx-one/shared/utils/linkedin-post.utils';
import { expect, Page, Route } from '@playwright/test';
import { mockProjects } from '../fixtures/mock-data';
import { ApiMockHelper } from './api-mock.helper';
import { suppressCookieBanner } from './account-settings-email.helper';
import { waitForHydration } from './meeting-composer-guests.helper';

export const LINKEDIN_RUN_TIMEOUT = 20000;
export const LINKEDIN_TEST_PROJECT = { uid: 'p0000000-0000-0000-0000-00000000a116', slug: 'linkedin-e2e', name: 'Example post project' };
export const LINKEDIN_TEST_PROFILE = linkedinProfileFromSetup({
  name: 'Example author',
  role: 'Maintainer',
  focus_areas: 'Open source',
  primary_audience: 'Developers',
});
export function linkedinEnvelope(): LinkedinEnvelope {
  return {
    contract: 'linkedin-post-output/v1',
    kind: 'linkedin-post',
    version: 1,
    profile_source: 'first_run_setup',
    profile: LINKEDIN_TEST_PROFILE,
    profile_markdown: renderLinkedinProfileMarkdown(LINKEDIN_TEST_PROFILE),
    options: [1, 2, 3].map((number) => ({
      number,
      label: `Angle ${number}`,
      text: `Example release ${number}.\nA grounded post. [LINK]`,
      word_count: 8,
      hashtags: ['#Release', '#Code', '#Community'],
      tagging_suggestions: ['Example project'],
    })),
    notes: ['Verify handles before tagging.'],
    document_markdown: '# Example LinkedIn posts',
    content_sha256: 'a'.repeat(64),
    inputs: { content_source: 'text', feedback_provided: false },
    generated_at: '2026-10-15T10:00:00Z',
    agent: { identifier: 'linux-foundation~linkedin-post', agent_version: '1.0.0', prompt_manifest_sha256: 'b'.repeat(64) },
  };
}
export function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
export async function setupLinkedin(
  page: Page,
  options: {
    saved?: boolean;
    writer?: boolean;
    profileError?: boolean;
    author?: { name: string | null; isAuthor: boolean };
    recordedCase?: string;
    questions?: boolean;
    live?: boolean;
  } = {}
): Promise<void> {
  const project = LINKEDIN_TEST_PROJECT;
  const recorded = options.recordedCase ? LINKEDIN_RECORDED_CASES.find((item) => item.name.endsWith(`/${options.recordedCase}`)) : undefined;
  const output: LinkedinEnvelope = recorded ? JSON.parse(JSON.stringify(recorded.envelope)) : linkedinEnvelope();
  const selectedProfile = recorded ? output.profile : LINKEDIN_TEST_PROFILE;
  const turn = parseLinkedinQuestions(LINKEDIN_RECORDED_QUESTIONS);
  const events = LINKEDIN_RECORDED_PROGRESS.map((event, index) =>
    JSON.stringify({ ...event, created_at: new Date(Date.now() - 10000 + index * 1000).toISOString() })
  );
  let generation = 0;
  const runs = new Map<string, { documentId: string; shareLink: string; answered: boolean; polls: number }>();
  mockProjects[project.slug] = {
    ...project,
    description: 'Synthetic project for post drafting.',
    public: true,
    parent_uid: '',
    stage: 'graduated',
    category: 'project',
    funding_model: [],
    charter_url: '',
    legal_entity_type: '',
    legal_entity_name: 'Example project',
    legal_parent_uid: '',
    autojoin_enabled: false,
    formation_date: '',
    logo_url: '',
    repository_url: '',
    website_url: '',
    created_at: '',
    updated_at: '',
    mailing_list_count: 0,
  };
  await ApiMockHelper.setupProjectSlugMock(page, { writer: options.writer ?? true });
  await page.addInitScript(() => localStorage.setItem('lfx-feature-flag-overrides', JSON.stringify({ 'mktg-os-agents-enabled': true })));
  await page.route('**/api/user/personas*', (route) =>
    json(route, { personas: ['executive-director'], personaProjects: {}, projects: [], organizations: [], isRootWriter: true })
  );
  await page.route('**/api/nav/lens-items*', (route) =>
    json(route, {
      items: new URL(route.request().url()).searchParams.get('lens') === 'project' ? [{ ...project, logoUrl: null, isFoundation: false }] : [],
      next_page_token: null,
      upstream_failed: false,
    })
  );
  await page.route('**/api/projects/*/sfid*', (route) => json(route, { sfid: null }));
  await page.route(`**${LINKEDIN_API}/profile`, (route) => {
    if (route.request().method() === 'PUT')
      return json(route, { profile: { profile: selectedProfile, profile_markdown: renderLinkedinProfileMarkdown(selectedProfile) } });
    return json(
      route,
      { profile: options.saved ? { profile: selectedProfile, profile_markdown: renderLinkedinProfileMarkdown(selectedProfile) } : null },
      options.profileError ? 503 : 200
    );
  });
  await page.route(`**${LINKEDIN_API}/generate`, (route) => {
    const supplied = route.request().postDataJSON().answers?.share_link;
    const sessionId = `synthetic-session-${++generation}`;
    const run = {
      documentId: `run-${generation.toString(16).padStart(24, '0')}`,
      shareLink: typeof supplied === 'string' ? supplied : '',
      answered: false,
      polls: 0,
    };
    runs.set(sessionId, run);
    return json(route, {
      sessionId,
      ownerToken: `synthetic-owner-token-${generation}`,
      documentId: run.documentId,
      source: { label: 'example release', words: 50, fetched: true },
      answers: { share_link: run.shareLink },
    });
  });
  await page.route(`**${LINKEDIN_API}/answers`, (route) => {
    const body = route.request().postDataJSON();
    const run = runs.get(body.sessionId);
    if (!run) return json(route, { error: 'Unknown synthetic session' }, 404);
    expect(body.questionsId).toBe('a'.repeat(64));
    run.answered = true;
    return json(route, { success: true });
  });
  await page.route(`**${LINKEDIN_API}/result`, (route) => {
    const run = runs.get(route.request().postDataJSON().sessionId);
    if (!run) return json(route, { error: 'Unknown synthetic session' }, 404);
    if (options.live && ++run.polls === 1) return json(route, { status: 'pending', activity: linkedinRunActivity(events) });
    if (options.questions && !run.answered && turn)
      return json(route, {
        status: 'questions',
        questions: linkedinRunQuestions(turn),
        questionsId: 'a'.repeat(64),
        questionsProject: turn.project,
        activity: linkedinRunActivity(events),
      });
    return json(route, {
      status: 'ready',
      envelope: output,
      activity: linkedinRunActivity(events, true),
      persistence: { project: project.uid, content_sha256: output.content_sha256, s3_key: 'synthetic/document.md', version: output.version },
      profileSaved: true,
      answers: { share_link: run.shareLink },
    });
  });
  await page.route(`**${LINKEDIN_API}/documents/*/share-link`, (route) => {
    const run = [...runs.values()].find((run) => run.documentId === new URL(route.request().url()).pathname.split('/').at(-2));
    if (!run) return json(route, { error: 'Unknown synthetic document' }, 404);
    run.shareLink = route.request().postDataJSON().share_link;
    return json(route, { share_link: run.shareLink });
  });
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === 'linkedin-post');
  if (!type) throw new Error('LinkedIn document type is not registered');
  const revision: MktgRevisionSummary = {
    id: '000001-' + 'a'.repeat(64),
    number: 1,
    createdAt: '2026-10-15T10:00:00Z',
    origin: 'generated',
    restoredFromNumber: null,
    intakeMode: 'form',
    status: '',
    contentSha256: 'a'.repeat(64),
    format: 'markdown',
    commentCount: 0,
    latest: true,
    approval: null,
  };
  const document: MktgRevisionResponse = {
    project: project.uid,
    type,
    documentId: '',
    revisions: [revision],
    revision,
    approval: null,
    approvedCurrent: null,
    markdown: output.document_markdown,
    sidecar: null,
  };
  await page.route('**/api/mktg-agents/documents/linkedin-post/**', (route) => {
    const run = [...runs.values()].find((run) => run.documentId === new URL(route.request().url()).pathname.split('/')[5]);
    if (!run) return json(route, { error: 'Unknown synthetic document' }, 404);
    return json(route, {
      ...document,
      documentId: run.documentId,
      linkedinPost: {
        author: { name: options.author?.name === undefined ? 'Example author' : options.author.name },
        isAuthor: options.author?.isAuthor ?? true,
        options: output.options,
        notes: output.notes,
        answers: { share_link: run.shareLink },
        source: { label: 'example release', words: 50, fetched: true },
      },
    });
  });
  await seedLinkedinContext(page);
}
export async function seedLinkedinContext(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: PERSONA_COOKIE_KEY,
      value: encodeURIComponent(JSON.stringify({ primary: 'executive-director', all: ['executive-director'] })),
      domain: 'localhost',
      path: '/',
    },
    { name: LENS_COOKIE_KEY, value: 'project', domain: 'localhost', path: '/' },
    { name: SELECTED_PROJECT_COOKIE_KEY, value: encodeURIComponent(JSON.stringify(LINKEDIN_TEST_PROJECT)), domain: 'localhost', path: '/' },
  ]);
}
export async function stubLinkedinClipboard(page: Page): Promise<void> {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          sessionStorage.setItem('linkedin-test-copy', text);
        },
      },
    })
  );
}

export async function openLinkedin(page: Page): Promise<void> {
  await suppressCookieBanner(page);
  const personaReady = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/user/personas');
  await Promise.all([page.goto('/', { waitUntil: 'domcontentloaded' }), personaReady]);
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('sidebar')).toBeAttached({ timeout: LINKEDIN_RUN_TIMEOUT });
  await expect(page.getByTestId('dashboard-loading')).toHaveCount(0, { timeout: LINKEDIN_RUN_TIMEOUT });
  await waitForHydration(page);
  await seedLinkedinContext(page);
  await page.evaluate((url) => {
    history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/project/mktg-os-agents/linkedin-post?project=${LINKEDIN_TEST_PROJECT.slug}`);
  await expect(page.getByTestId('mktg-linkedin-page')).toBeVisible({ timeout: LINKEDIN_RUN_TIMEOUT });
}
