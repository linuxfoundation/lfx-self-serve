// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The rows a revision inherited (`report.inherited`, on a redraft or a check
// whose intake carried the stored version's run) as the Sources tabs, the
// readiness line and the approve dialog read them. One reading for the
// framework, FAQ, boilerplates and Brand Kit; a report that inherited nothing
// has none of it and renders as it always did.

import { MKTG_INHERITED_MARKERS } from '../constants/mktg-asset.constants';
import type { MktgAssetReport, MktgReportInheritedGroup, MktgReportInheritedView } from '../interfaces/mktg-asset.interface';
import { mktgInheritedSourceKey } from './mktg-previous-run.utils';
import { mktgReportAssetLabel, mktgReportSourceHref } from './mktg-report-v2.utils';

/** What stands beside an inherited row: "Read in version 1", "Could not be read in version 1". */
export function describeMktgInheritedRow(group: MktgReportInheritedGroup, version: number): string {
  return `${MKTG_INHERITED_MARKERS[group]} ${version}`;
}

/**
 * The inherited rows of a report, each in the shape of the run's own row and marked with the version whose run
 * produced it, in the agent's words, never rewritten. A source a version could not read is carried twice, as its
 * legacy row and as its finding: it is listed once, as the finding (the plain reason and the machine detail), and a
 * legacy row stays only when no finding names its source. `failedTitle` is how the view titles a failed source (the
 * Brand Kit names a logo package); the family prints it as written. Null, or a report without `inherited`, gives four
 * empty lists.
 */
export function mktgReportInheritedView(
  report: MktgAssetReport | null | undefined,
  labels: Readonly<Record<string, string>>,
  failedTitle: (source: string) => string = (source) => source
): MktgReportInheritedView {
  const inherited = report?.inherited;
  if (!inherited) return { read: [], failed: [], missing: [], warnings: [] };
  const findings = inherited.findings;
  const told = new Set(findings.sources_failed.map((row) => mktgInheritedSourceKey(row.source)));
  return {
    read: inherited.sources_read.map((row) => ({ source: row.source, marker: describeMktgInheritedRow('read', row.version) })),
    failed: [
      ...findings.sources_failed.map((row) => ({
        title: failedTitle(row.source),
        text: row.reason,
        detail: row.detail ?? null,
        marker: describeMktgInheritedRow('failed', row.version),
      })),
      ...inherited.sources_failed
        .filter((row) => !told.has(mktgInheritedSourceKey(row.name)))
        .map((row) => ({ title: failedTitle(row.name), text: row.reason, detail: null, marker: describeMktgInheritedRow('failed', row.version) })),
    ],
    missing: findings.missing_assets.map((row) => ({
      title: mktgReportAssetLabel(row.asset, labels),
      text: row.reason,
      fix: row.fix,
      marker: describeMktgInheritedRow('missing', row.version),
    })),
    warnings: findings.warnings.map((row) => ({
      text: row.text,
      source: row.source ?? null,
      href: mktgReportSourceHref(row.source ?? null),
      marker: describeMktgInheritedRow('warnings', row.version),
    })),
  };
}
