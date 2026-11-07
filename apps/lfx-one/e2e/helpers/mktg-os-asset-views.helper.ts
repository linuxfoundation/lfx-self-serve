// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BRAND_KIT_CONTRACT_ID } from '@lfx-one/shared/constants/brand-kit.constants';
import { BRAND_KIT_INTAKE, FOUNDATION_MESSAGE_INTAKE } from '@lfx-one/shared/constants/mktg-run.constants';
import { FOUNDATION_MESSAGE_WEBSITE_KEY } from '@lfx-one/shared/constants/foundation-message.constants';
import { LENS_COOKIE_KEY } from '@lfx-one/shared/constants/lens.constants';
import { MKTG_DOCUMENT_TYPES } from '@lfx-one/shared/constants/mktg-document-store.constants';
import { MKTG_SLIDES_EXPORT_API_PATH } from '@lfx-one/shared/constants/mktg-slides-export.constants';
import { PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants/persona.constants';
import { SELECTED_PROJECT_COOKIE_KEY } from '@lfx-one/shared/constants/project-context.constants';
import type { BoilerplatesEnvelope } from '@lfx-one/shared/interfaces/boilerplates.interface';
import type { BrandKitReport, BrandKitRevision } from '@lfx-one/shared/interfaces';
import type { FaqEnvelope } from '@lfx-one/shared/interfaces/faq.interface';
import type { FoundationMessageGoal } from '@lfx-one/shared/interfaces/foundation-message.interface';
import type { MktgFrameworkAsset, MktgRunResultResponse } from '@lfx-one/shared/interfaces/mktg-run.interface';
import type { MktgRevisionResponse, MktgRevisionSummary } from '@lfx-one/shared/interfaces/mktg-document-store.interface';
import type { MktgDocumentRunProgress } from '@lfx-one/shared/interfaces/mktg-document-run.interface';
import type { Project } from '@lfx-one/shared/interfaces/project.interface';
import { buildMktgRunActivity } from '@lfx-one/shared/utils/mktg-run-activity.utils';
import { noQuestionsActivityPayloads } from '@lfx-one/shared/utils/__fixtures__/mktg-run-activity.no-questions';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, Page } from '@playwright/test';
import { mockProjects } from '../fixtures/mock-data/projects.mock';
import { suppressCookieBanner } from './account-settings-email.helper';
import { ApiMockHelper } from './api-mock.helper';
import { pinMktgOsFlags } from './mktg-os-flags.helper';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';

const PAGE_LOAD_TIMEOUT = 20_000;

export const ASSET_PROJECT: Project = {
  uid: 'p0000000-0000-0000-0000-00000000a551',
  slug: 'asset-view-example',
  name: 'Asset Example',
  description: 'Synthetic collaboration project.',
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
  formation_date: '2026-10-01',
  logo_url: '',
  repository_url: '',
  website_url: 'https://project.example',
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-01T10:00:00Z',
  mailing_list_count: 0,
};

/** Header/approval scenarios reuse main's canonical FAQ envelope, not a second FAQ contract fixture. */
export function nativeAssetRevisionResponse(key: 'faq' | 'boilerplates', unreadable = false): MktgRevisionResponse {
  const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey === key);
  if (!type) throw new Error('Missing document type');
  const revision: MktgRevisionSummary = {
    id: `000001-${'a'.repeat(64)}`,
    number: 1,
    createdAt: '2026-10-19T10:00:00Z',
    origin: 'generated',
    restoredFromNumber: null,
    intakeMode: 'form',
    status: '',
    contentSha256: 'a'.repeat(64),
    format: 'json',
    commentCount: 0,
    latest: true,
    approval: null,
  };
  const fixtureName = key === 'faq' ? 'faq-envelope.json' : 'boilerplates.envelope.json';
  const native = JSON.parse(readFileSync(resolve(__dirname, '../../../../packages/shared/src/utils/__fixtures__', fixtureName), 'utf8')) as
    | FaqEnvelope
    | BoilerplatesEnvelope;
  return {
    project: ASSET_PROJECT.uid,
    type,
    documentId: 'living',
    revisions: [revision],
    approvedCurrent: null,
    approval: null,
    revision,
    markdown: unreadable ? '{"unexpected":"synthetic source text"}' : JSON.stringify(native.content),
    sidecar: { mode: native.mode, report: native.report, checks: native.checks },
  };
}

/** All four native document layouts use synthetic assets and the real document read contract. */
export function columnAssetRevisionResponse(key: 'faq' | 'boilerplates' | 'foundation-message' | 'brand-kit'): MktgRevisionResponse {
  const base = nativeAssetRevisionResponse('faq');
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === key);
  if (!type) throw new Error('Missing native document type');
  let response = { ...base, type };
  if (key === 'boilerplates') {
    const envelope = JSON.parse(
      readFileSync(resolve(__dirname, '../../../../packages/shared/src/utils/__fixtures__/boilerplates.envelope.json'), 'utf8')
    ) as BoilerplatesEnvelope;
    response = { ...response, markdown: JSON.stringify(envelope.content), sidecar: { mode: envelope.mode, report: envelope.report, checks: envelope.checks } };
  } else if (key === 'foundation-message') {
    const framework = draftFrameworkAsset();
    response = {
      ...response,
      markdown: JSON.stringify(framework.content),
      sidecar: { mode: framework.mode, report: framework.report, checks: framework.checks },
    };
  } else if (key === 'brand-kit') {
    const kit = brandKitTestRevision();
    response = {
      ...response,
      markdown: '',
      sidecar: {
        contract: BRAND_KIT_CONTRACT_ID,
        project_name: kit.projectName,
        project: kit.project,
        version: kit.version,
        mode: kit.mode,
        kit: kit.kit,
        chapters: kit.chapters,
        report: kit.report,
        inputs: { website_url: kit.websiteUrl },
        generated_at: kit.generatedAt,
        agent: { agent_version: kit.agentVersion },
      },
    };
  }
  const approval = { approvedAt: '2026-10-19T11:00:00Z', approvedBy: null };
  const revision = { ...response.revision, approval };
  return { ...response, revision, revisions: [revision], approval, approvedCurrent: { revisionId: revision.id, number: revision.number } };
}

/**
 * An unapproved Brand Kit revision whose report is the one given (a v2 report with colour conflicts and rule bases, or a
 * v1 one): what the approve dialog and the overview's basis pills are tested against. Approve stays available on it.
 */
export function brandKitDraftRevisionResponse(report: BrandKitReport): MktgRevisionResponse {
  const base = columnAssetRevisionResponse('brand-kit');
  const revision = { ...base.revision, approval: null };
  const sidecar = { ...base.sidecar, report };
  return { ...base, sidecar, revision, revisions: [revision], approval: null, approvedCurrent: null };
}

/** Synthetic preview: no live generation, credentials or customer data. */
export function draftFrameworkAsset(): MktgFrameworkAsset {
  return {
    kind: 'messaging-framework',
    mode: 'draft',
    content: {
      mf: {
        vision: 'Open collaboration.',
        mission: 'Build together.',
        positioning: 'A synthetic toolkit for contributors.',
        tagline: 'Build openly.',
        goals: [
          {
            id: 'adoption',
            n: 1,
            t: 'Adoption',
            vp: 'Collaborate.',
            key: 'Build openly.',
            proof: [['1,200 contributors', 'Website']],
            bite: 'Open collaboration',
            icps: ['users'],
          },
        ],
        crosscut: 'Every goal grows the audience.',
        say: ['open collaboration'],
        avoid: [],
        anchor: ['Which goal does this serve?'],
        notes: '',
      },
      icp: [
        {
          id: 'users',
          name: 'End users',
          kind: 'Individual',
          who: 'Contributors.',
          goals: ['adoption'],
          need: 'Collaborate.',
          value: 'Open tools.',
          lead: 'Build openly.',
          proof: [['1,200 contributors', 'Website']],
          cta: 'Contribute.',
          channels: ['Docs'],
          objection: ['Too early?', null],
          personas: [['Contributor', 'reliability']],
          basis: 'Website',
        },
      ],
      mh: {
        umbrella: 'Open collaboration.',
        line: 'Build openly.',
        pillars: [{ t: 'Open', m: 'Build together.', p: [['Open development', 'Docs']] }],
        found: 'A Linux Foundation project.',
        aud: [['End users', 'Build openly.']],
      },
      nums: [['1,200', 'contributors']],
    },
    report: { sources_read: [], sources_failed: [], gaps: [], notes: '' },
    checks: { findings: [] },
  };
}

/**
 * Synthetic framework shaped like a real run (four goals, sentence-length cells, many chips, long sources), for the
 * narrow-viewport checks: the one-goal `draftFrameworkAsset()` fits any width and so proves nothing about overflow.
 */
export function realShapedFrameworkAsset(): MktgFrameworkAsset {
  const goals: FoundationMessageGoal[] = [
    {
      id: 'adoption',
      n: 1,
      t: 'Adoption by platform teams',
      vp: 'Platform teams ship a compliant toolchain in weeks instead of quarters, because every component is already vetted together.',
      key: 'The toolkit is the fastest route from an empty repository to a production-grade, compliant platform.',
      proof: [
        ['Downloaded 1,200,000 times across 94 countries in the last twelve months', 'Website'],
        ['Adopted as the default toolchain by 38 public-sector platform teams since 2025', 'Press release'],
        ['Reference deployments documented for six cloud providers and bare metal', 'Docs'],
      ],
      bite: 'From an empty repository to a compliant platform before the quarter ends.',
      icps: ['platform-teams'],
    },
    {
      id: 'community',
      n: 2,
      t: 'A contributor base that outgrows any one vendor',
      vp: 'Contributors join a neutral project where their work is reviewed quickly and credited publicly, whoever employs them.',
      key: 'No single company steers the roadmap; the contributors who show up do.',
      proof: [
        ['3,400 contributors from 210 organizations merged a change in the last year', 'Plan'],
        ['Median time from pull request to first review is under nineteen hours', 'Docs'],
      ],
      bite: 'The roadmap belongs to whoever shows up to build it.',
      icps: ['contributors'],
    },
    {
      id: 'membership',
      n: 3,
      t: 'Membership that funds the shared foundations',
      vp: 'Members fund the security audits, release engineering and events that every downstream product depends on, at a fraction of building them alone.',
      key: 'Membership is the cheapest way to keep the foundations every product stands on healthy.',
      proof: [
        ['Two independent security audits funded and published every year since 2024', 'Deck'],
        ['Release cadence held at every eight weeks for three consecutive years', 'Website'],
        ['Forty-one member organizations across five continents', 'LFX field'],
      ],
      bite: 'Pay for the foundations once, together, instead of again and again alone.',
      icps: ['members'],
    },
    {
      id: 'events',
      n: 4,
      t: 'Events where the roadmap is decided in the open',
      vp: 'Attendees leave with the decisions, the people and the demos that shape the next release, not a marketing keynote.',
      key: 'Every release is planned face to face, in public, at the project summit.',
      proof: [
        ['2,800 attendees at the last summit, a third of them first-time participants', 'Press release'],
        ['Fourteen roadmap sessions recorded and published within a week of the summit', 'Web'],
      ],
      bite: 'The next release is decided in a room you can walk into.',
      icps: ['platform-teams', 'contributors'],
    },
  ];
  return {
    kind: 'messaging-framework',
    mode: 'draft',
    content: {
      mf: {
        vision:
          'A world where every organization can build on infrastructure that is open, audited and governed by the people who depend on it. Nobody has to choose between moving fast and knowing what they run on.',
        mission:
          'We maintain a neutral, production-grade toolkit for building platforms, fund the security and release work that keeps it trustworthy, and bring its contributors and adopters together to decide its direction in the open.',
        positioning:
          'For platform teams and the organizations that rely on them, the toolkit is the open foundation that turns a compliance checklist into a working platform. Unlike single-vendor stacks, it is governed by its contributors and audited in public, so adopting it is a decision that outlasts any one supplier.',
        tagline: 'Open foundations, audited in public, governed by the people who build on them.',
        goals,
        crosscut:
          'Every goal reinforces the others: adoption brings contributors, contributors bring members, and members fund the audits and events that make the next wave of adoption safe.',
        say: [
          'open foundations',
          'audited in public',
          'governed by contributors',
          'production-grade toolkit',
          'neutral home',
          'compliance by default',
          'from an empty repository',
          'decided in the open',
          'vendor-neutral',
          'shared release engineering',
        ],
        avoid: [
          ['the fastest platform on the market', 'the fastest route from an empty repository to a compliant platform'],
          ['enterprise-ready', 'audited in public and adopted by regulated platform teams'],
          ['backed by the biggest vendors', 'governed by the contributors who show up, whoever employs them'],
          ['our community', 'the contributors and the organizations that depend on the toolkit'],
          ['cutting-edge innovation', 'a release every eight weeks, planned in the open'],
        ],
        anchor: ['Which goal does this serve?', 'Which segment is it for?', 'Which key message does it carry?'],
        notes:
          'The adoption figures come from the [download statistics page](https://www.example.org/metrics/downloads) and the audit cadence from the [security program overview](https://www.example.org/security/program); both were read on the day of the run.',
      },
      icp: [
        {
          id: 'platform-teams',
          name: 'Platform teams',
          kind: 'Organization',
          who: 'Teams of five to fifty engineers who run the internal platform other product teams deploy to.',
          goals: ['adoption', 'events'],
          need: 'A compliant toolchain they can stand behind without assembling and auditing it themselves.',
          value: 'A vetted toolkit with documented reference deployments and a predictable release cadence.',
          lead: 'The fastest route from an empty repository to a compliant platform.',
          proof: [['Adopted as the default toolchain by 38 public-sector platform teams since 2025', 'Press release']],
          cta: 'Deploy the reference stack for your cloud provider.',
          channels: ['Docs', 'Summit'],
          objection: ['Will this survive if the largest contributor leaves?', 'Governance by contributors, audited in public.'],
          personas: [['Platform lead', 'predictability']],
          basis: 'Website',
        },
        {
          id: 'contributors',
          name: 'Contributors',
          kind: 'Individual',
          who: 'Engineers who maintain a component or want their work reviewed and credited in a neutral project.',
          goals: ['community'],
          need: 'Fast reviews and public credit for the work they do.',
          value: 'A median first review under nineteen hours and a public contributor record.',
          lead: 'The roadmap belongs to whoever shows up to build it.',
          proof: [['Median time from pull request to first review is under nineteen hours', 'Docs']],
          cta: 'Pick up a good first issue.',
          channels: ['Docs'],
          objection: ['Is my work going to be credited?', null],
          personas: [['Maintainer', 'recognition']],
          basis: 'Plan',
        },
        {
          id: 'members',
          name: 'Member organizations',
          kind: 'Organization',
          who: 'Organizations whose products depend on the toolkit and who fund its shared work.',
          goals: ['membership'],
          need: 'Security audits and release engineering they would otherwise fund alone.',
          value: 'Two published audits a year and a release every eight weeks, funded together.',
          lead: 'Pay for the foundations once, together.',
          proof: [['Two independent security audits funded and published every year since 2024', 'Deck']],
          cta: 'Join as a member.',
          channels: ['Summit'],
          objection: ['What do we get that non-members do not?', 'A seat where the audit scope and the release plan are decided.'],
          personas: [['Open source program office lead', 'risk']],
          basis: 'Deck',
        },
      ],
      mh: {
        umbrella: 'Open foundations, audited in public.',
        line: 'Governed by the people who build on them.',
        pillars: [
          { t: 'Open', m: 'Every component is developed and audited in public.', p: [['Two independent security audits published every year', 'Deck']] },
          { t: 'Governed', m: 'Contributors steer the roadmap, not a single vendor.', p: [['3,400 contributors from 210 organizations', 'Plan']] },
        ],
        found: 'A Linux Foundation project.',
        aud: [
          ['Platform teams', 'The fastest route from an empty repository to a compliant platform.'],
          ['Contributors', 'The roadmap belongs to whoever shows up to build it.'],
        ],
      },
      nums: [
        ['1,200,000', 'downloads in the last twelve months'],
        ['3,400', 'contributors from 210 organizations'],
        ['41', 'member organizations across five continents'],
        ['2,800', 'attendees at the last summit'],
      ],
    },
    report: {
      sources_read: [
        'https://www.example.org/metrics/downloads/annual-report-2026/by-country-and-platform/summary',
        'https://www.example.org/security/program/independent-audits/2025-second-half/findings-and-remediation',
        'https://docs.example.org/reference-deployments/cloud-providers/compared/with-bare-metal-notes',
      ],
      sources_failed: [
        { name: 'https://www.example.org/summit/2026/roadmap-sessions/recordings', reason: 'The page answered with a sign-in wall and no readable text.' },
      ],
      gaps: [
        'No source states how many of the public-sector adopters run the toolkit in production rather than in a pilot.',
        'The member count by region is only given for three of the five continents.',
      ],
      notes: '',
    },
    checks: { findings: [] },
  };
}

/** The approved framework document with the real-shaped asset, for the narrow-viewport checks. */
export function realShapedFrameworkRevisionResponse(): MktgRevisionResponse {
  const framework = realShapedFrameworkAsset();
  return {
    ...columnAssetRevisionResponse('foundation-message'),
    markdown: JSON.stringify(framework.content),
    sidecar: { mode: framework.mode, report: framework.report, checks: framework.checks },
  };
}

/**
 * The largest framework record the validator takes (`FOUNDATION_MESSAGE_CONTENT_LIMITS`: 8 figures, 4 proofs a goal; the
 * report's lists are unbounded) that still fills the book past its rooms: eight figures with long labels (no tiles past
 * six, a Key numbers table that continues on `key-numbers-2`), four proof points on the first goal (cut to the rows that
 * fit, with the +N line), sixty sources read and forty gaps (cut lists on the Sources & gaps page).
 */
export function overfullFrameworkRevisionResponse(): MktgRevisionResponse {
  const framework = realShapedFrameworkAsset();
  const sentence = 'A long proof sentence that runs across most of the column and asks the list for a second line of room.';
  const labelTail = Array.from({ length: 5 }, () => 'counted across the synthetic record so the label needs several lines of its column').join(', ');
  const goals = framework.content.mf.goals.map((goal, index) =>
    index === 0 ? { ...goal, proof: Array.from({ length: 4 }, (_, n): [string, string] => [`${sentence} (${n + 1})`, 'Report']) } : goal
  );
  const content = {
    ...framework.content,
    mf: { ...framework.content.mf, goals },
    nums: Array.from({ length: 8 }, (_, n): [string, string] => [`${(n + 1) * 1000}`, `synthetic figure ${n + 1}, ${labelTail}`]),
  };
  const report = {
    ...framework.report,
    // Sixty hosts: the pages of one host print as one counted row, and the cut list needs sixty rows.
    sources_read: Array.from({ length: 60 }, (_, n) => `https://synthetic-source-${n + 1}.example.org/with-a-long-path-that-wraps-in-the-column`),
    gaps: Array.from({ length: 40 }, (_, n) => `Synthetic gap ${n + 1}: no source states the figure the framework needs here.`),
  };
  return {
    ...columnAssetRevisionResponse('foundation-message'),
    markdown: JSON.stringify(content),
    sidecar: { mode: framework.mode, report, checks: framework.checks },
  };
}

/**
 * The framework record at the goals' cap (`FOUNDATION_MESSAGE_CONTENT_LIMITS.goals.max`: eight goals, four proofs each, long
 * cells), so the framework page's matrix has 57 px columns and must fit its text cells and cut every proof cell to its
 * note to end above the footer; the rest of the record is the real-shaped asset's.
 */
export function capGoalsFrameworkRevisionResponse(): MktgRevisionResponse {
  const framework = realShapedFrameworkAsset();
  const sentence =
    'A long cell that says what the goal does for the people it serves, across several lines of a narrow column, with a second sentence after it.';
  const [first] = framework.content.mf.goals;
  const goals = Array.from({ length: 8 }, (_, index) => ({
    ...first,
    id: `goal-${index + 1}`,
    n: index + 1,
    t: `Goal ${index + 1} title`,
    vp: sentence,
    key: sentence,
    bite: 'A sound bite that is a sentence long, as the record allows.',
    proof: Array.from({ length: 4 }, (_, n): [string, string] => [`${sentence} (${n + 1})`, 'Report']),
  }));
  const content = { ...framework.content, mf: { ...framework.content.mf, goals } };
  return {
    ...columnAssetRevisionResponse('foundation-message'),
    markdown: JSON.stringify(content),
    sidecar: { mode: framework.mode, report: framework.report, checks: framework.checks },
  };
}

/**
 * The real-shaped framework record with six profiles, every one served by the first goal, each with a long need and a
 * long ask: more than the goal page's "Who it's for" row holds (four cards), so the row prints its note and the four
 * cards' lines are fitted into the room the note leaves above the footer rule.
 */
export function servedSixFrameworkRevisionResponse(): MktgRevisionResponse {
  const framework = realShapedFrameworkAsset();
  const [profile] = framework.content.icp;
  const line = 'a line long enough to wrap several times inside a quarter-width card, with a second clause that runs on past the first.';
  const icp = Array.from({ length: 6 }, (_, index) => ({
    ...profile,
    id: `profile-${index + 1}`,
    name: `Profile ${index + 1}`,
    goals: [framework.content.mf.goals[0].id],
    need: line,
    cta: line,
  }));
  const goals = framework.content.mf.goals.map((goal, index) => (index === 0 ? { ...goal, icps: icp.map((entry) => entry.id) } : goal));
  const content = { ...framework.content, mf: { ...framework.content.mf, goals }, icp };
  return {
    ...columnAssetRevisionResponse('foundation-message'),
    markdown: JSON.stringify(content),
    sidecar: { mode: framework.mode, report: framework.report, checks: framework.checks },
  };
}

/** Loaded asset without approval: real controls must remain gated, not just the metadata badge. */
export async function openUnapprovedAssetDocument(page: Page, key: 'foundation-message' | 'brand-kit', pendingApproval = false): Promise<void> {
  await openAssetDocument(page, 'faq');
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === key);
  if (!type) throw new Error('Missing synthetic document type');
  const base = nativeAssetRevisionResponse('faq');
  const framework = draftFrameworkAsset();
  const kit = brandKitTestRevision();
  const sidecar =
    key === 'brand-kit'
      ? {
          contract: 'brand-kit-output/v2',
          project_name: kit.projectName,
          project: kit.project,
          version: kit.version,
          mode: kit.mode,
          kit: kit.kit,
          chapters: kit.chapters,
          report: kit.report,
          inputs: { website_url: kit.websiteUrl },
          generated_at: kit.generatedAt,
          agent: { agent_version: kit.agentVersion },
        }
      : { content: framework.content, report: framework.report, checks: framework.checks, mode: framework.mode };
  const revision = { ...base.revision, latest: !pendingApproval };
  const approved = { ...revision, id: `000002-${'b'.repeat(64)}`, number: 2, latest: true, approval: { approvedAt: '2026-10-19T11:00:00Z', approvedBy: null } };
  const response = {
    ...base,
    type,
    sidecar,
    revision,
    revisions: pendingApproval ? [approved, revision] : [revision],
    approvedCurrent: pendingApproval ? { revisionId: approved.id, number: 2 } : null,
    markdown: JSON.stringify(framework.content),
  };
  await page.route(`**${BRAND_KIT_INTAKE.endpoints.stored}**`, (route) => route.fulfill({ status: 404, json: { error: 'No approved branding' } }));
  await page.route(`**/api/mktg-agents/documents/${key}/living?*`, (route) => route.fulfill({ json: response }));
  await page.route(`**/api/mktg-agents/documents/${key}/living/revisions/**`, (route) => {
    // Deliberately hold the approved GET while the test asserts the eager last-export read.
    if (pendingApproval && new URL(route.request().url()).pathname.endsWith(approved.id)) return;
    return route.fulfill({ json: response });
  });
  await page.evaluate(
    (url) => {
      window.history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    `/project/mktg-os-agents/documents/${key}/living?project=${ASSET_PROJECT.slug}${pendingApproval ? '&revision=' + revision.id : ''}`
  );
  await expect(page.getByTestId('mktg-document-view-page')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}

/** The run owns research/writing until the server supplies its exact stored-revision receipt. */
export async function openDraftAssetRun(page: Page, immediateReceipt = true) {
  const asset = draftFrameworkAsset();
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === FOUNDATION_MESSAGE_INTAKE.agentId);
  if (!type) throw new Error('Missing framework document type');
  const base = nativeAssetRevisionResponse('faq');
  const revisionId = base.revision.id;
  const runId = 'b'.repeat(64);
  const state = { started: false, finished: false, persisted: false, readyWithoutReceiptPolls: 0, posts: [] as string[] };
  const response: MktgRevisionResponse = {
    ...base,
    type,
    current: { revisionId, changedAt: base.revision.createdAt, changedBy: null },
    markdown: JSON.stringify(asset.content),
    sidecar: { content: asset.content, report: asset.report, checks: asset.checks, mode: asset.mode },
    runs: [],
  };
  const runs = (): MktgDocumentRunProgress[] => {
    if (!state.started || state.persisted) return [];
    return [
      {
        project: ASSET_PROJECT.uid,
        agentKey: type.agentKey,
        documentId: 'living',
        runId,
        state: state.finished ? 'storing' : 'writing',
        startedAt: base.revision.createdAt,
      },
    ];
  };
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/mktg-') && request.method() === 'POST') state.posts.push(path);
  });
  // Register before the precise routes: no unhandled marketing request reaches a live agent or store.
  await page.route('**/api/mktg-*/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') return route.fulfill({ status: 503, json: { error: 'Unexpected synthetic write' } });
    if (path.endsWith('/comments')) return route.fulfill({ json: { revisionId, threads: [] } });
    if (path.endsWith('/documents')) return route.fulfill({ json: { project: ASSET_PROJECT.uid, groups: [], runs: runs() } });
    if (path.includes('/intakes/') && path.endsWith('/last')) return route.fulfill({ json: { intake: null } });
    if (path.endsWith('/last')) return route.fulfill({ json: { last: null, latestRevision: null } });
    return route.fulfill({ status: 503, json: { error: 'Unexpected synthetic read' } });
  });
  await openAssetDocument(page, 'faq');
  await page.route(`**${FOUNDATION_MESSAGE_INTAKE.endpoints.generate}`, (route) => {
    state.started = true;
    return route.fulfill({ json: { sessionId: 'synthetic-run-session', ownerToken: 'synthetic-run-capability', runId } });
  });
  await page.route(`**${FOUNDATION_MESSAGE_INTAKE.endpoints.result}`, (route) => {
    const result: MktgRunResultResponse = { status: 'pending', activity: buildMktgRunActivity(noQuestionsActivityPayloads('checked', true)) };
    if (state.finished) {
      result.status = 'ready';
      result.version = 1;
      result.documentMarkdown = '';
      result.asset = asset;
      if (state.persisted) {
        result.persistence = {
          s3_key: `documents/${ASSET_PROJECT.uid}/${type.agentKey}/living/${revisionId}.json`,
          content_sha256: base.revision.contentSha256,
          project: ASSET_PROJECT.uid,
          version: 1,
          document_location: { agent_key: type.agentKey, document_id: 'living', revision_id: revisionId },
        };
      } else state.readyWithoutReceiptPolls++;
    }
    return route.fulfill({ json: result });
  });
  await page.route(`**${BRAND_KIT_INTAKE.endpoints.stored}**`, (route) => route.fulfill({ status: 404, json: { error: 'No approved branding' } }));
  await page.route(`**/api/mktg-agents/documents/${type.agentKey}/living?*`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const json = state.persisted ? response : { project: ASSET_PROJECT.uid, type, documentId: 'living', revisions: [], approvedCurrent: null, runs: runs() };
    return route.fulfill({ json });
  });
  await page.route(`**/api/mktg-agents/documents/${type.agentKey}/living/revisions/**`, (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: response }) : route.fallback()
  );
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/project/mktg-os-agents/${FOUNDATION_MESSAGE_INTAKE.agentId}?project=${ASSET_PROJECT.slug}`);
  await expect(page.getByTestId('mktg-agent-run-submit-button')).toBeVisible();
  await page.locator('[data-test="mktg-intake-project_name"]').fill(ASSET_PROJECT.name);
  await page.locator(`[data-test="mktg-intake-${FOUNDATION_MESSAGE_WEBSITE_KEY}"]`).fill('https://project.example');
  const firstResult = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === FOUNDATION_MESSAGE_INTAKE.endpoints.result
  );
  await page.getByTestId('mktg-agent-run-submit-button').getByRole('button').click();
  await firstResult;
  await expect(page.getByTestId('mktg-agent-run-status')).toContainText('You can leave', { timeout: PAGE_LOAD_TIMEOUT });
  await expect(page).not.toHaveURL(/\/documents\//);
  return {
    revisionId,
    state,
    generatePath: FOUNDATION_MESSAGE_INTAKE.endpoints.generate,
    resultPath: FOUNDATION_MESSAGE_INTAKE.endpoints.result,
    finish: () => {
      state.finished = true;
      state.persisted = immediateReceipt;
    },
    persist: () => {
      state.finished = true;
      state.persisted = true;
    },
  };
}

/** A `#RRGGBB` as the browser reports it on a computed style. */
export function cssRgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/** A kit's sidecar as the document store keeps it: the v2 envelope minus the Markdown (what `readBrandKitRevision` reads back). */
export function brandKitSidecar(kit: BrandKitRevision): Record<string, unknown> {
  return {
    contract: BRAND_KIT_CONTRACT_ID,
    project_name: kit.projectName,
    project: kit.project,
    version: kit.version,
    mode: kit.mode,
    kit: kit.kit,
    chapters: kit.chapters,
    report: kit.report,
    inputs: { website_url: kit.websiteUrl },
    generated_at: kit.generatedAt,
    agent: { agent_version: kit.agentVersion },
  };
}

/**
 * Stub native asset reads; cookie suppression precedes every navigation. `kit` is the project's stored Brand Kit the
 * framework print is set in (its stored endpoint answers with the kit's sidecar); none, and the print takes the LF look.
 */
export async function openAssetDocument(
  page: Page,
  key: 'faq' | 'boilerplates' | 'foundation-message' | 'brand-kit',
  status = 200,
  writer = true,
  unreadable = false,
  responseOverride?: MktgRevisionResponse,
  kit: BrandKitRevision | null = null
): Promise<void> {
  await suppressCookieBanner(page);
  mockProjects[ASSET_PROJECT.slug] = ASSET_PROJECT;
  await ApiMockHelper.setupProjectSlugMock(page, { writer });
  await pinMktgOsFlags(page);
  const cookies = [
    { name: PERSONA_COOKIE_KEY, value: { primary: 'executive-director', all: ['executive-director'] } },
    { name: LENS_COOKIE_KEY, value: 'project' },
    { name: SELECTED_PROJECT_COOKIE_KEY, value: { uid: ASSET_PROJECT.uid, slug: ASSET_PROJECT.slug, name: ASSET_PROJECT.name } },
  ].map(({ name, value }) => ({ name, value: typeof value === 'string' ? value : encodeURIComponent(JSON.stringify(value)), domain: 'localhost', path: '/' }));
  await page.context().addCookies(cookies);
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({ json: { personas: ['executive-director'], personaProjects: {}, projects: [], organizations: [], isRootWriter: writer } })
  );
  await page.route('**/api/nav/lens-items*', (route) => {
    const projectLens = new URL(route.request().url()).searchParams.get('lens') === 'project';
    return route.fulfill({
      json: { items: projectLens ? [ASSET_PROJECT] : [], next_page_token: null, upstream_failed: false, lens: projectLens ? 'project' : 'foundation' },
    });
  });
  await page.route('**/api/projects/*/sfid*', (route) => route.fulfill({ json: { sfid: null } }));
  await page.route(`**${MKTG_SLIDES_EXPORT_API_PATH}/last?*`, (route) => route.fulfill({ json: { last: null, latestRevision: null } }));
  let response =
    responseOverride ?? (key === 'faq' || key === 'boilerplates' ? nativeAssetRevisionResponse(key, unreadable) : columnAssetRevisionResponse(key));
  await page.route('**/api/mktg-agents/documents/*/living/comments?*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { revisionId: new URL(route.request().url()).searchParams.get('revision') ?? response.revision.id, threads: [] } });
  });
  await page.route('**/api/mktg-agents/documents?*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { project: ASSET_PROJECT.uid, groups: [] } });
  });
  await page.route(`**${BRAND_KIT_INTAKE.endpoints.stored}**`, (route) =>
    kit
      ? route.fulfill({
          json: {
            documentMarkdown: '',
            receipt: {
              s3_key: `marketing/${ASSET_PROJECT.uid}/brand-kit/v${kit.version}.md`,
              content_sha256: 'e2e',
              project: ASSET_PROJECT.uid,
              version: kit.version,
              intake_mode: 'form',
            },
            revisionNumber: kit.version,
            sidecar: brandKitSidecar(kit),
          },
        })
      : route.fulfill({ status: 404, json: { error: 'No approved branding' } })
  );
  await page.route(`**/api/mktg-agents/documents/${key}/living/revisions/*/approve?*`, (route) => {
    const approval = { approvedAt: '2026-10-19T11:00:00Z', approvedBy: { name: 'Project writer' } };
    const revision = { ...response.revision, approval };
    response = { ...response, approval, revision, revisions: [revision], approvedCurrent: { revisionId: revision.id, number: revision.number } };
    return route.fulfill({ json: response });
  });
  await page.route(`**/api/mktg-agents/documents/${key}/living?*`, (route) => route.fulfill({ json: response }));
  await page.route(`**/api/mktg-agents/documents/${key}/living/revisions/**`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    if (status === 0) return;
    return route.fulfill({ status, json: status === 200 ? response : { error: 'Synthetic read failure' } });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sidebar')).toBeAttached({ timeout: PAGE_LOAD_TIMEOUT });
  await page.context().addCookies(cookies);
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/project/mktg-os-agents/documents/${key}/living?project=${ASSET_PROJECT.slug}`);
  await expect(page.getByTestId('mktg-document-view-page')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}
