// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MKTG_PREVIOUS_RUN_MAX_CHARS } from '../constants/mktg-asset.constants';
import type { MktgAssetReport, MktgPreviousRun, MktgReportInherited } from '../interfaces/mktg-asset.interface';
import { brandKitReportV2Envelope } from './__fixtures__/brand-kit-report-v2.fixture';
import golden from './__fixtures__/mktg-previous-run.golden.json';
import { boilerplatesReportV2Envelope, faqReportV2Envelope, frameworkReportV2Envelope } from './__fixtures__/mktg-report-v2.fixture';
import { renderBoilerplatesFormText, validateBoilerplatesEnvelope } from './boilerplates.utils';
import { renderBrandKitFormText, validateBrandKitEnvelope } from './brand-kit.utils';
import { renderFaqFormText, validateFaqEnvelope } from './faq.utils';
import { guardFoundationMessageText, renderFoundationMessageFormText, validateFoundationMessageEnvelope } from './foundation-message.utils';
import { mktgCarriedKeysOf, mktgReportInheritedErrors, renderMktgPreviousRun } from './mktg-previous-run.utils';

// The golden file holds what the agents' own code writes (marketing-os-agents, see its `source`): the PREVIOUS RUN
// block of two stored runs, the size and hash of an oversized one, and the `report.inherited` the finalize tool makes
// of the first. `stored` is the version 1 of record: the framework agent's real AAIF report with a read ledger whose
// LFX record answered and whose standard metrics were read whole.
const stored = (): MktgPreviousRun => ({ report: frameworkReportV2Envelope().report, quality: golden.quality });
const block = (run: MktgPreviousRun, version: number): string => renderMktgPreviousRun(run, version, guardFoundationMessageText).join('\n');
const inherited = (): MktgReportInherited => structuredClone(golden.inherited);
const NOW = new Date('2026-11-28T10:00:00Z');

describe('the PREVIOUS RUN block (the agents’ renderPreviousRun)', () => {
  it('renders a stored run word for word as the agent’s renderer does', () => {
    expect(block(stored(), 1)).toBe(golden.blocks.stored);
    expect(block(golden.chain, 2)).toBe(golden.blocks.chain);
  });

  it('sends only the keys the carry reads: the sources, the findings and the metrics row of the read ledger', () => {
    const carried = mktgCarriedKeysOf(stored());
    expect(Object.keys(carried)).toEqual(['report', 'quality']);
    expect(Object.keys(carried['report'] as object)).toEqual(['sources_read', 'sources_failed', 'findings']);
    expect(carried).toMatchObject({ report: { sources_read: expect.arrayContaining(['LFX record: Agentic AI Foundation (agentic-ai-foundation)']) } });
    expect(carried['quality']).toEqual({ reads: [{ kind: 'metrics', outcome: 'complete' }] });
  });

  it('keeps a chain’s history, one line per text, and drops the rows that are not rows', () => {
    const carried = mktgCarriedKeysOf(golden.chain);
    expect(carried).toMatchObject({
      report: {
        sources_read: ['https://docs.example.org/governance', 'Charter (PDF) 2026'],
        sources_failed: [{ name: 'https://example.org/press', reason: 'HTTP 404' }],
        findings: {
          sources_failed: [{ reason: 'This page does not exist on the site.' }],
          missing_assets: [{ asset: 'press_release', reason: 'No press release was found.', fix: 'Add the launch release as a link.' }],
        },
        inherited: {
          sources_read: [
            { source: 'https://example.org/', version: 1 },
            { source: 'LFX project record: example-search', version: 1 },
          ],
        },
      },
      quality: { reads: [{ kind: 'metrics', outcome: 'partial' }] },
    });
    expect(JSON.stringify(carried)).not.toMatch(/gaps|notes|inputs_record|from_version|bytes/);
    // Applying it twice changes nothing: the agent's parser reduces the block the same way.
    expect(mktgCarriedKeysOf(carried)).toEqual(carried);
  });

  it.each<[string, Record<string, unknown>]>([
    ['a failed row names them', { sources_failed: [{ name: 'LFX metrics (standard)', reason: 'refused' }] }],
    ['a failed finding is of kind lfx_metrics', { findings: { sources_failed: [{ source: 'The metrics', kind: 'lfx_metrics' }] } }],
    ['an inherited failed row names them', { inherited: { sources_failed: [{ name: 'https://www.LFX standard metrics/', reason: 'x', version: 1 }] } }],
  ])('does not carry the metrics when %s', (_case, report) => {
    expect(mktgCarriedKeysOf({ report, quality: golden.quality })).not.toHaveProperty('quality');
  });

  it('fits the block under the agent’s size, dropping the last rows of the longest list first', () => {
    const oversize = {
      report: {
        sources_read: Array.from({ length: 220 }, (_, i) => `https://example.org/${String(i).padStart(3, '0')}/${'p'.repeat(520)}`),
        sources_failed: Array.from({ length: 60 }, (_, i) => ({ name: `https://example.org/failed/${i}`, reason: 'r'.repeat(480) })),
      },
    };
    const text = block(oversize, 7);
    expect(text.split('\n').slice(1, -1).join('\n').length).toBeLessThanOrEqual(MKTG_PREVIOUS_RUN_MAX_CHARS);
    expect({ chars: text.length, sha256: createHash('sha256').update(text).digest('hex') }).toEqual(golden.oversize);
  });

  it('renders no block without a run, and an empty record for a run with nothing to carry', () => {
    expect(renderMktgPreviousRun(undefined, 1, guardFoundationMessageText)).toEqual([]);
    expect(renderMktgPreviousRun(null, 1, guardFoundationMessageText)).toEqual([]);
    expect(block({ report: 'not a report' }, 3)).toBe('--- PREVIOUS RUN (JSON, stored version 3) ---\n{}\n--- END PREVIOUS RUN ---');
  });

  // Each renderer puts the block where its agent's form.ts does: the last thing of a revision intake. The rest of
  // each intake is pinned by its own spec; here, with the run the text is the same text plus the agent's block.
  const framework = frameworkReportV2Envelope().content;
  const kit = brandKitReportV2Envelope();
  const frameworkForm = (mode: 'redraft' | 'check', previous_run?: MktgPreviousRun): string =>
    renderFoundationMessageFormText(
      {
        type: 'messaging_framework_intake_form',
        project_name: 'Example Search',
        revision:
          mode === 'redraft'
            ? { mode, prior_version: 1, previous: { ...framework }, comments: [{ field: 'mf.tagline', comment: 'Shorter.' }], previous_run }
            : { mode, prior_version: 1, previous: { ...framework }, previous_run },
      },
      NOW
    );
  const kitForm = (chapters: typeof kit.chapters | undefined, previous_run?: MktgPreviousRun): string =>
    renderBrandKitFormText(
      {
        type: 'brand_kit_revise_form',
        project_name: 'Example Search',
        prior_version: 1,
        revision_mode: 'redraft',
        kit: kit.kit,
        chapters,
        messaging_framework: { ...framework },
        comments: [{ passage: 'A passage.', comment: 'Shorter.' }],
        previous_run,
      },
      NOW
    );
  it.each<[string, (run?: MktgPreviousRun) => string]>([
    ['a Framework redraft', (run) => frameworkForm('redraft', run)],
    ['a Framework check', (run) => frameworkForm('check', run)],
    [
      'an FAQ redraft',
      (previous_run) =>
        renderFaqFormText(
          {
            type: 'faq_intake_form',
            project_name: 'Example Search',
            messaging_framework: { ...framework },
            revision: {
              mode: 'redraft',
              prior_version: 1,
              previous: faqReportV2Envelope().content,
              comments: [{ field: 'faq[0][0]', comment: 'Shorter.' }],
              previous_run,
            },
          },
          NOW
        ),
    ],
    [
      'a Boilerplates redraft',
      (previous_run) =>
        renderBoilerplatesFormText(
          {
            type: 'boilerplates_intake_form',
            project_name: 'Example Search',
            messaging_framework: { ...framework },
            revision: {
              mode: 'redraft',
              prior_version: 1,
              previous: boilerplatesReportV2Envelope().content,
              comments: [{ field: 'bp[0].t', comment: 'Shorter.' }],
              previous_run,
            },
          },
          NOW
        ),
    ],
    ['a Brand Kit redraft', (run) => kitForm(kit.chapters, run)],
    ['a Brand Kit redraft stored as tokens only', (run) => kitForm(undefined, run)],
  ])('ends the intake of %s with the block, right after its last existing block', (_case, render) => {
    const without = render();
    expect(without).not.toContain('PREVIOUS RUN');
    expect(render(stored())).toBe(`${without}\n${golden.blocks.stored}`);
  });
});

describe('report.inherited (the agents’ inheritedSchema)', () => {
  const SHAPE = 'report.inherited must be an object of { from_version, sources_read, sources_failed, findings: { sources_failed, missing_assets, warnings } }';
  const rows = (path: string, max: number, shape: string): string => `report.inherited.${path} must be a list of at most ${max} ${shape}`;

  it('accepts a report without the key and the carry the agent’s finalize tool writes', () => {
    expect(mktgReportInheritedErrors({})).toEqual([]);
    expect(mktgReportInheritedErrors({ inherited: inherited() })).toEqual([]);
    // Version 1's LFX record and its metrics, each marked with the version that read it.
    expect(inherited().sources_read.slice(-2)).toEqual([
      { source: 'LFX record: Agentic AI Foundation (agentic-ai-foundation)', version: 1 },
      { source: 'LFX standard metrics', version: 1 },
    ]);
  });

  it.each<[string, (carry: MktgReportInherited) => unknown, string]>([
    ['is not an object', () => [], SHAPE],
    ['has an unknown key', (carry) => ({ ...carry, notes: 'x' }), SHAPE],
    ['has no findings', (carry) => ({ ...carry, findings: undefined }), SHAPE],
    ['has an unknown findings group', (carry) => ({ ...carry, findings: { ...carry.findings, gaps: [] } }), SHAPE],
    ['names version 0', (carry) => ({ ...carry, from_version: 0 }), 'report.inherited.from_version must be an integer >= 1'],
    [
      'has a text on two lines',
      (carry) => ({ ...carry, sources_read: [{ source: 'two\nlines', version: 1 }] }),
      rows('sources_read', 200, '{ source, version }'),
    ],
    ['has a row without its version', (carry) => ({ ...carry, sources_read: [{ source: 'x' }] }), rows('sources_read', 200, '{ source, version }')],
    [
      'has a row with an unknown key',
      (carry) => ({ ...carry, sources_failed: [{ ...carry.sources_failed[0], kind: 'link' }] }),
      rows('sources_failed', 50, '{ name, reason, version }'),
    ],
    [
      'has more rows than the cap',
      (carry) => ({ ...carry, sources_failed: Array.from({ length: 51 }, () => carry.sources_failed[0]) }),
      rows('sources_failed', 50, '{ name, reason, version }'),
    ],
    [
      'has a sentence past 300 characters',
      (carry) => ({ ...carry, findings: { ...carry.findings, sources_failed: [{ ...carry.findings.sources_failed[0], reason: 'r'.repeat(301) }] } }),
      rows('findings.sources_failed', 50, '{ source, kind, reason, detail?, version }'),
    ],
    [
      'has a missing asset without its fix',
      (carry) => ({ ...carry, findings: { ...carry.findings, missing_assets: [{ asset: 'website', reason: 'Not found.', version: 1 }] } }),
      rows('findings.missing_assets', 50, '{ asset, reason, fix, version }'),
    ],
    [
      'has a warning with an empty source',
      (carry) => ({ ...carry, findings: { ...carry.findings, warnings: [{ code: 'truncated_read', text: 'Cut short.', source: '', version: 1 }] } }),
      rows('findings.warnings', 50, '{ code, text, source?, version }'),
    ],
  ])('names the fault when the key %s', (_case, broken, error) => {
    expect(mktgReportInheritedErrors({ inherited: broken(inherited()) })).toEqual([error]);
  });

  it.each<[string, () => { report: MktgAssetReport }, (envelope: unknown) => { valid: boolean; errors: string[] }]>([
    ['Framework', frameworkReportV2Envelope, validateFoundationMessageEnvelope],
    ['FAQ', faqReportV2Envelope, validateFaqEnvelope],
    ['Boilerplates', boilerplatesReportV2Envelope, validateBoilerplatesEnvelope],
    ['Brand Kit', brandKitReportV2Envelope, validateBrandKitEnvelope],
  ])('the %s validator accepts an envelope whose report carries it, and names a malformed one', (_agent, load, validate) => {
    const envelope = load();
    envelope.report.inherited = inherited();
    expect(validate(envelope)).toMatchObject({ valid: true, errors: [] });
    envelope.report.inherited.from_version = 1.5;
    expect(validate(envelope).errors).toEqual(['report.inherited.from_version must be an integer >= 1']);
  });

  it('validates a Boilerplates redraft as the agent returns it: version 2, its revision record and what it inherited from version 1', () => {
    const envelope = boilerplatesReportV2Envelope();
    const redraft = {
      ...envelope,
      version: 2,
      mode: 'redraft',
      revision: { mode: 'redraft', prior_version: 1, comments: [{ number: 1, field: 'bp[0].t', comment: 'Shorter.', resolution: 'Applied as asked.' }] },
      report: { ...envelope.report, sources_read: [], inherited: inherited() },
    };
    expect(validateBoilerplatesEnvelope(redraft)).toEqual({ valid: true, errors: [] });
  });
});
