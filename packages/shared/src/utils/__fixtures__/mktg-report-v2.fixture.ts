// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { BoilerplatesEnvelope } from '../../interfaces/boilerplates.interface';
import type { FaqEnvelope } from '../../interfaces/faq.interface';
import type { FoundationMessageEnvelope } from '../../interfaces/foundation-message.interface';
import type { MktgAssetReport } from '../../interfaces/mktg-asset.interface';
import { validateBoilerplatesEnvelope } from '../boilerplates.utils';
import { validateFaqEnvelope } from '../faq.utils';
import { validateFoundationMessageEnvelope } from '../foundation-message.utils';
import boilerplatesEnvelope from './boilerplates-report-v2.envelope.json';
import faqEnvelope from './faq-report-v2.envelope.json';
import frameworkEnvelope from './framework-report-v2.envelope.json';

/**
 * The agent lanes' REAL report v2 envelopes for the Agentic AI Foundation (AAIF, `agentic-ai-foundation`, aaif.io), each
 * written by its agent's own finalize tool over recorded public aaif.io pages (no live Guild run; the lanes'
 * `qa/fixtures/report-v2/` replays), prettier-ignored and copied byte for byte except two substitutions, as the kit's
 * fixture does (the source repository is private, this one is public): in the framework's and the boilerplates'
 * envelopes `inputs_record.lfx_records[].uid` is a synthetic identifier of the same shape (the FAQ's is the agent's own
 * `u-aaif`, not substituted), and the eight member organisation names the FAQ's envelope quotes are the synthetic names
 * of `report-v2-name-map.json` beside this file, at every occurrence (its `content` and its `inputs_record`; none in
 * `report` or `checks`), after which its `content_sha256` was recomputed as the agent computes it (sha256 of
 * `JSON.stringify(content)`). Prices and every other byte are as the agents wrote them, so a test asserts what the
 * agent really writes:
 * - framework: foundation-message 4.2.0, `aaif-failed-source-envelope` — one failed source (`https://aaif.io/press`,
 *   kind `link`, "This page does not exist on the site (the server answered 404).", detail `HTTP 404`), nothing missing,
 *   no warning;
 * - boilerplates: `aaif-unanswered-question-envelope` — one missing asset (`unanswered_question`, the question the
 *   requester left unanswered), two gaps, no failed source, no warning;
 * - faq: `aaif-unanswered-envelope` — one missing asset (`unanswered_question`), two `settled_from_suggestion` warnings
 *   without a source, no failed source; `checks.unanswered` names the question's path.
 * The content records what the public pages and the press release state (membership prices, the projects) and the LFX
 * membership figures the requester confirmed in the question round; no person's name, email or account. Each loader
 * validates its envelope with the agent's own validator and returns a
 * fresh copy, so a test can edit what it returns without touching another's.
 */
export function frameworkReportV2Envelope(): FoundationMessageEnvelope {
  const value: unknown = structuredClone(frameworkEnvelope);
  const result = validateFoundationMessageEnvelope(value);
  if (!result.valid) throw new Error(`framework-report-v2 fixture no longer validates: ${result.errors.join('; ')}`);
  return value as FoundationMessageEnvelope;
}

/** The boilerplates agent's real v2 envelope (see {@link frameworkReportV2Envelope}). */
export function boilerplatesReportV2Envelope(): BoilerplatesEnvelope {
  const value: unknown = structuredClone(boilerplatesEnvelope);
  const result = validateBoilerplatesEnvelope(value);
  if (!result.valid) throw new Error(`boilerplates-report-v2 fixture no longer validates: ${result.errors.join('; ')}`);
  return value as BoilerplatesEnvelope;
}

/** The FAQ agent's real v2 envelope (see {@link frameworkReportV2Envelope}). */
export function faqReportV2Envelope(): FaqEnvelope {
  const value: unknown = structuredClone(faqEnvelope);
  const result = validateFaqEnvelope(value);
  if (!result.valid) throw new Error(`faq-report-v2 fixture no longer validates: ${result.errors.join('; ')}`);
  return value as FaqEnvelope;
}

/** The framework fixture's report on its own: a v2 report whose findings hold one failed source and nothing else. */
export function frameworkReportV2Fixture(): MktgAssetReport {
  return frameworkReportV2Envelope().report;
}
