// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { BrandKitEnvelope, BrandKitReport } from '../../interfaces/brand-kit.interface';
import { isBrandKitEnvelope } from '../mktg-document-redraft.utils';
import envelope from './brand-kit-report-v2.envelope.json';

/**
 * The brand-kit agent's own v2 envelope, the computed 2.2.0 output its QA fixture holds: marketing-os-agents
 * `agents/brand-kit/qa/fixtures/report-v2/aaif-envelope.json` at 6f5ee8321d84d3d6ed67f3e3e4f462670e73bc7b,
 * sha256 ad704e0f52c71b8a6277459bde6f54c96cc575a96c601bbe042653d8f10662cd. The JSON beside this file is that blob
 * byte for byte except `inputs.lfx_records[].uid`, replaced by a synthetic identifier of the same shape (the
 * source repository is private, this one is public). Its report carries the three findings groups (two failed
 * sources, four missing assets each with a fix, four warnings), one colour conflict and 47 rules over the v1 fields.
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
