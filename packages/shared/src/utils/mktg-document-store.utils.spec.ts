// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for the Marketing OS document store key helpers. Revision keys
// are storage paths built from route parameters, so their gates are asserted
// as hard behaviour.

import { describe, expect, it } from 'vitest';

import { MKTG_ONE_OFF_STOPPED_MESSAGE } from '../constants/mktg-one-off.constants';
import { MKTG_DOCUMENT_TYPES, MKTG_REVISION_ID_REGEX, MKTG_STARTED_RUN_SCHEMA } from '../constants/mktg-document-store.constants';
import { MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS } from '../constants/mktg-run.constants';
import type { MktgDocumentType } from '../interfaces/mktg-document-store.interface';
import type { MktgRunResultResponse } from '../interfaces/mktg-run.interface';
import type { MktgStartedRunRecord } from '../interfaces/mktg-document-run.interface';
import {
  buildMktgDocumentPrefix,
  buildMktgDocumentProjectPrefix,
  buildMktgLegacyRevisionId,
  buildMktgRevisionId,
  buildMktgRevisionKey,
  describeMktgRevision,
  describeMktgRevisionAuthor,
  findMktgDocumentType,
  mktgDocumentLocationOfReceipt,
  mktgRunProgress,
  mktgRunResultIdentity,
  findMktgRunIntake,
  isMktgRunFailureReason,
  isMktgRunClosed,
  isMktgRunTerminal,
  parseMktgLegacyRevisionId,
  parseMktgRevisionKey,
} from './mktg-document-store.utils';

it('treats discarded records as closed terminal records with no public progress row', () => {
  expect(isMktgRunClosed('discarded')).toBe(true);
  expect(isMktgRunTerminal('discarded')).toBe(true);
  expect(mktgRunProgress(startedRun({ state: 'discarded' }))).toBeNull();
});

const SHA = 'ab'.repeat(32);
const BRAND_KIT = findMktgDocumentType('brand-kit') as MktgDocumentType;

function startedRun(overrides: Partial<MktgStartedRunRecord> = {}): MktgStartedRunRecord {
  return {
    schema: MKTG_STARTED_RUN_SCHEMA,
    runId: SHA,
    project: 'synthetic-project',
    agentKey: BRAND_KIT.agentKey,
    documentId: 'living',
    sessionId: 'private-synthetic-session',
    startedAt: '2026-10-19T00:00:00Z',
    priorVersion: 0,
    state: 'writing',
    result: null,
    ...overrides,
  };
}

describe('mktg-document-store utils', () => {
  it.each(['no_edit_access', 'agent_stopped'])('accepts the classified reason %s', (reason) => {
    expect(isMktgRunFailureReason(reason)).toBe(true);
  });
  it.each(['unknown_code', '__proto__', 'constructor', 'no_edit_access extra', '', null, undefined, 12])('rejects non-allow-listed reason %s', (reason) => {
    expect(isMktgRunFailureReason(reason)).toBe(false);
  });
  it('uses a bounded payload digest and prefers the exact receipt content SHA', () => {
    const result: MktgRunResultResponse = { status: 'ready', version: 1, documentMarkdown: 'Synthetic output marker. '.repeat(5000) };
    const digest = mktgRunResultIdentity(result);
    expect(digest).toHaveLength(16);
    expect(digest).toBe(mktgRunResultIdentity({ ...result }));
    expect(digest).not.toBe(mktgRunResultIdentity({ ...result, documentMarkdown: 'Different synthetic output' }));
    const recorded: MktgRunResultResponse = {
      ...result,
      persistence: { project: 'synthetic-project', s3_key: 'synthetic-key', version: 1, content_sha256: SHA },
    };
    expect(mktgRunResultIdentity(recorded)).toBe(SHA);
    expect(mktgRunResultIdentity(recorded, false)).toBe(digest);
  });

  it('projects paused run state without private session fields', () => {
    const run = startedRun({ state: 'questions', creatorSubject: 'synthetic-creator-subject', oneOff: { answers: { share_link: 'https://post.example/' } } });
    expect(mktgRunProgress(run)).toMatchObject({ runId: SHA, state: 'questions' });
    expect(mktgRunProgress(run)).not.toHaveProperty('oneOff');
    expect(mktgRunProgress(run)).not.toHaveProperty('sessionId');
    expect(mktgRunProgress(run)).not.toHaveProperty('creatorSubject');
    expect(JSON.stringify(mktgRunProgress(run))).not.toContain('synthetic-creator-subject');
    expect(mktgRunProgress(startedRun({ state: 'completed' }))).toBeNull();
  });
  it.each(['discarded', 'superseded'] as const)('projects %s only for selected details, without private or active-run fields', (state) => {
    const closedAt = '2026-10-19T12:00:00Z';
    const run = startedRun({ state, closedAt, creatorSubject: 'synthetic-owner', failureText: 'Private synthetic reply', persistRetries: 100 });
    const activity = [{ id: 'step', kind: 'checking' as const, label: 'Checking', status: 'running' as const, startedAt: run.startedAt }];
    expect(mktgRunProgress(run)).toBeNull();
    expect(mktgRunProgress(run, undefined, activity, undefined, true)).toEqual({
      runId: run.runId,
      project: run.project,
      agentKey: run.agentKey,
      documentId: run.documentId,
      startedAt: run.startedAt,
      state,
      closedAt,
    });
    expect(mktgRunProgress({ ...run, closedAt: undefined }, undefined, undefined, undefined, true)).not.toHaveProperty('closedAt');
    expect(mktgRunProgress({ ...run, closedAt: 'invalid' }, undefined, undefined, undefined, true)).not.toHaveProperty('closedAt');
    expect(mktgRunProgress({ ...run, state: 'completed' }, undefined, undefined, undefined, true)).toBeNull();
  });

  it('projects LinkedIn failure prose only to its known creator, while Member redacted text stays public', () => {
    const run = startedRun({
      agentKey: 'linkedin-post',
      documentId: 'run-' + 'a'.repeat(24),
      state: 'failed',
      creatorSubject: 'synthetic-creator',
      failureText: 'SYNTHETIC private source/profile reply',
    });
    expect(mktgRunProgress(run, undefined, undefined, 'synthetic-creator')?.failureText).toBe(run.failureText);
    for (const reader of [undefined, '', 'synthetic-visitor'])
      expect(mktgRunProgress(run, undefined, undefined, reader)?.failureText).toBe(MKTG_ONE_OFF_STOPPED_MESSAGE);
    expect(mktgRunProgress({ ...run, creatorSubject: null }, undefined, undefined, 'synthetic-creator')?.failureText).toBe(MKTG_ONE_OFF_STOPPED_MESSAGE);
    expect(mktgRunProgress({ ...run, agentKey: 'member-360', failureText: 'SYNTHETIC redacted Member reply' })?.failureText).toBe(
      'SYNTHETIC redacted Member reply'
    );
  });

  it('projects same-session recovery only for exhausted persistence failures, never from failure prose', () => {
    const failureText = 'Synthetic failure mentioning storage';
    expect(mktgRunProgress(startedRun({ state: 'failed', failureText }))).not.toHaveProperty('persistenceFailed');
    expect(mktgRunProgress(startedRun({ state: 'failed', persistRetries: MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS - 1 }))).not.toHaveProperty('persistenceFailed');
    expect(mktgRunProgress(startedRun({ state: 'failed', persistRetries: MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS }))).toMatchObject({ persistenceFailed: true });
    expect(mktgRunProgress(startedRun({ state: 'storing', persistRetries: MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS }))).not.toHaveProperty('persistenceFailed');
  });

  it('derives run membership from the active catalog and registered intake', () => {
    expect(findMktgRunIntake(BRAND_KIT.agentKey)?.agentId).toBe(BRAND_KIT.catalogAgentId);
    expect(findMktgRunIntake('not-a-registered-agent')).toBeUndefined();
    expect(findMktgRunIntake('linkedin-post')).toBeUndefined();
    expect(findMktgRunIntake('member-360')).toBeUndefined();
    expect(findMktgRunIntake('linkedin-post', true)?.tracksDocumentRun).toBe(true);
    expect(findMktgRunIntake('member-360', true)?.tracksDocumentRun).toBe(true);
  });
  it('adds an optional public activity projection without private completion metadata', () => {
    const activity = [{ id: 'step', kind: 'checking' as const, label: 'Checking', status: 'running' as const, startedAt: '2026-10-19T00:00:00Z' }];
    expect(mktgRunProgress(startedRun(), undefined, activity)).toMatchObject({ state: 'writing', activity });
    expect(mktgRunProgress(startedRun())).not.toHaveProperty('activity');
  });
  it('normalizes only the exact snake-case receipt location for UI readers', () => {
    expect(
      mktgDocumentLocationOfReceipt({
        s3_key: 'synthetic',
        project: 'synthetic-project',
        version: 1,
        content_sha256: SHA,
        document_location: { agent_key: BRAND_KIT.agentKey, document_id: 'living', revision_id: `000001-${SHA}` },
      })
    ).toEqual({ agentKey: BRAND_KIT.agentKey, documentId: 'living', revisionId: `000001-${SHA}` });
    expect(mktgDocumentLocationOfReceipt()).toBeUndefined();
  });
  it('lists living documents in run order before the one-off run types', () => {
    expect(MKTG_DOCUMENT_TYPES.map((type) => `${type.kind}:${type.agentKey}`)).toEqual([
      'living:brand-kit',
      'living:foundation-message',
      'living:icp',
      'living:boilerplates',
      'living:faq',
      'run:aeo-geo',
      'run:linkedin-post',
      'run:member-360',
    ]);
  });

  it('builds a revision key that sorts in write order and parses back', () => {
    const key = buildMktgRevisionKey('proj-1', 'brand-kit', 'living', 12, SHA);

    expect(key).toBe(`documents/proj-1/brand-kit/living/000012-${SHA}.json`);
    expect(parseMktgRevisionKey(key, buildMktgDocumentProjectPrefix('proj-1'))).toEqual({
      agentKey: 'brand-kit',
      documentId: 'living',
      sequence: 12,
      sha: SHA,
      id: `000012-${SHA}`,
    });
  });

  it.each([
    ['another project', `documents/proj-2/brand-kit/living/000001-${SHA}.json`],
    ['an unknown agent', `documents/proj-1/unknown/living/000001-${SHA}.json`],
    ['a malformed document id', `documents/proj-1/brand-kit/other/000001-${SHA}.json`],
    ['a sequence of zero', `documents/proj-1/brand-kit/living/000000-${SHA}.json`],
    ['an extra segment', `documents/proj-1/brand-kit/living/x/000001-${SHA}.json`],
    ['another suffix', `documents/proj-1/brand-kit/living/000001-${SHA}.md`],
  ])('ignores a key with %s', (_label, key) => {
    expect(parseMktgRevisionKey(key, buildMktgDocumentProjectPrefix('proj-1'))).toBeNull();
  });

  it('refuses to build a path from unvalidated input', () => {
    expect(() => buildMktgDocumentProjectPrefix('../proj')).toThrow();
    expect(() => buildMktgDocumentPrefix('proj-1', 'unknown', 'living')).toThrow();
    expect(() => buildMktgDocumentPrefix('proj-1', 'brand-kit', '../living')).toThrow();
    expect(() => buildMktgRevisionId(0, SHA)).toThrow();
    expect(() => buildMktgRevisionId(1_000_000, SHA)).toThrow();
    expect(() => buildMktgRevisionId(1, 'not-a-sha')).toThrow();
  });

  it('round-trips a legacy revision id and rejects anything else', () => {
    expect(parseMktgLegacyRevisionId(buildMktgLegacyRevisionId(SHA))).toBe(SHA);
    expect(parseMktgLegacyRevisionId(`000001-${SHA}`)).toBeNull();
    expect(parseMktgLegacyRevisionId('legacy-xyz')).toBeNull();
  });

  it('rejects sequence zero at the API boundary too', () => {
    expect(MKTG_REVISION_ID_REGEX.test(`000000-${SHA}`)).toBe(false);
    expect(MKTG_REVISION_ID_REGEX.test(`000001-${SHA}`)).toBe(true);
  });

  it.each([
    { author: { name: 'The writer' }, expected: 'The writer' },
    { author: { name: '' }, expected: 'name unavailable' },
    { author: { name: null }, expected: 'name unavailable' },
    { author: null, expected: 'no name (stored before names were recorded)' },
    { author: undefined, expected: 'no name (stored before names were recorded)' },
  ])('describes revision authors consistently: %j', ({ author, expected }) => {
    expect(describeMktgRevisionAuthor(author)).toBe(expected);
  });

  it('renders real comment counts and nonsequential bases only', () => {
    expect(
      describeMktgRevision({ origin: 'revised', intakeMode: 'form', restoredFromNumber: null, number: 4, basedOnNumber: 1, commentCount: 4 }, BRAND_KIT)
    ).toBe('revised from 4 comments · based on v1');
    expect(
      describeMktgRevision({ origin: 'generated', intakeMode: 'form', restoredFromNumber: null, number: 4, basedOnNumber: 3, commentCount: 0 }, BRAND_KIT)
    ).toBe('generated from the form');
  });

  it('uses singular comments and a neutral label when intake was not recorded', () => {
    expect(describeMktgRevision({ origin: 'revised', intakeMode: 'form', restoredFromNumber: null, commentCount: 1 }, BRAND_KIT)).toBe(
      'revised from 1 comment'
    );
    expect(describeMktgRevision({ origin: 'generated', intakeMode: null, restoredFromNumber: null }, BRAND_KIT)).toBe('generated');
  });

  it('says how each revision was made', () => {
    expect(describeMktgRevision({ origin: 'generated', intakeMode: 'conversational', restoredFromNumber: null }, BRAND_KIT)).toBe(
      'generated in a conversation with the agent'
    );
    expect(describeMktgRevision({ origin: 'generated', intakeMode: 'prefill', restoredFromNumber: null }, BRAND_KIT)).toBe(
      'generated from the form with your existing documents (pre-fill)'
    );
    expect(describeMktgRevision({ origin: 'legacy', intakeMode: 'form', restoredFromNumber: null }, BRAND_KIT)).toBe(
      'generated by the Brand Kit Agent (stored before revisions existed)'
    );
    expect(describeMktgRevision({ origin: 'restored', intakeMode: 'form', restoredFromNumber: 2 }, BRAND_KIT)).toBe('restored from v2');
    expect(describeMktgRevision({ origin: 'restored', intakeMode: 'form', restoredFromNumber: null }, BRAND_KIT)).toBe('restored from an earlier revision');
  });
});
