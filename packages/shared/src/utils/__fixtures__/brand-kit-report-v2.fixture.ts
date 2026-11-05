// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { BrandKitEnvelope, BrandKitReport } from '../../interfaces/brand-kit.interface';
import { isBrandKitEnvelope } from '../mktg-document-redraft.utils';
import envelope from './brand-kit-report-v2.envelope.json';

/**
 * The brand-kit agent's own v2 envelope, the computed 2.2.2 output its QA fixture holds: marketing-os-agents
 * `agents/brand-kit/qa/fixtures/report-v2/aaif-envelope.json` as blob 63ecbe6d4f9f04e9a7f4bc7ad0905bdee3e43372 (on its branch, before the merge),
 * sha256 e9edaeda7884553af7af9745b600a28ab31e310bbdd270e71861401a5ddda9e5. The JSON beside this file is that blob
 * byte for byte except `inputs.lfx_records[].uid`, replaced by a synthetic identifier of the same shape (the
 * source repository is private, this one is public). Its report carries the three findings groups (two failed
 * sources, four missing assets each with a fix, three warnings), one colour conflict and 56 rules over the v1 fields.
 * Fresh on every call so a test can edit what it returns without touching another's.
 */
export function brandKitReportV2Envelope(): BrandKitEnvelope {
  const value: unknown = structuredClone(envelope);
  if (!isBrandKitEnvelope(value)) throw new Error('brand-kit-report-v2 fixture no longer validates');
  return value;
}

/** The report of {@link brandKitReportV2Envelope}, on its own. */
export function brandKitReportV2Fixture(): BrandKitReport {
  return brandKitReportV2Envelope().report;
}
