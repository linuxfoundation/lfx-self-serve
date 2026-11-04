// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { BrandKitEnvelope, BrandKitReport } from '../../interfaces/brand-kit.interface';
import envelope from './brand-kit-report-v2.envelope.json';

/**
 * The brand-kit agent's own v2 envelope, as its QA fixture has it: marketing-os-agents
 * `agents/brand-kit/qa/fixtures/report-v2/aaif-envelope.json` at e269f256336b907c8c0b6762df86dccbfe135d63,
 * sha256 6528fd70968e64030ba344a7bddf10405bb7e7077e2d778b1ce61c90ee299730, kept byte for byte in the JSON beside
 * this file. Its report carries the three findings groups (one failed source, four missing assets, three warnings),
 * two colour conflicts and 47 rules over the v1 fields. Fresh on every call so a test can edit what it returns
 * without touching another's.
 */
export function brandKitReportV2Envelope(): BrandKitEnvelope {
  return structuredClone(envelope) as unknown as BrandKitEnvelope;
}

/** The report of {@link brandKitReportV2Envelope}, on its own. */
export function brandKitReportV2Fixture(): BrandKitReport {
  return brandKitReportV2Envelope().report;
}
