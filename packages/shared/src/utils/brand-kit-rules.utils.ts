// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The v2 report's colour conflicts and rule bases as the approve dialog and
// the Kit page read them (brand-kit ≥ 2.2.0): the rules grouped by chapter
// with how many the project's own sources and the LF reference supplied, the
// words each surface prints for that, and the conflicts with every value's
// source in words. One reading for every surface; a v1 report, or any other
// agent's report, has none of it and renders as it always did.

import {
  BRAND_KIT_CHAPTER_BASIS_LF,
  BRAND_KIT_CHAPTER_BASIS_PROJECT,
  BRAND_KIT_CHAPTERS,
  BRAND_KIT_REPORT_ASSET_LABELS,
} from '../constants/brand-kit.constants';
import type {
  BrandKitApproveFindings,
  BrandKitChapterRuleBasis,
  BrandKitColorConflictView,
  BrandKitLfReferenceRuleLine,
  BrandKitReport,
  BrandKitReportColorConflict,
  BrandKitReportRule,
} from '../interfaces/brand-kit.interface';
import type { MktgAssetReport } from '../interfaces/mktg-asset.interface';
import { brandKitConflictSourceLabel, brandKitFailedSourceTitle } from './brand-kit-sources.utils';

/** The rule paths of the report are the envelope's: `chapters.<id>` followed by a member or an index. */
const RULE_PATH_PREFIX = 'chapters.';

/** `kind: source` — how the agent writes where a conflicting value was seen. */

/**
 * A report that carries a v2 field: a Brand Kit's. The fields are optional on
 * the type, so a v1 kit report passes too and simply has none of them.
 */
function isBrandKitReport(report: MktgAssetReport): report is BrandKitReport {
  return 'rules' in report || 'color_conflicts' in report || 'findings' in report;
}

/**
 * What a v2 report's approve dialog lists first, in the Sources tab's words:
 * each source the agent could not read with its plain reason and detail, and
 * each asset it did not find with its label, reason and fix. Both empty for a
 * v1 report or another agent's, whose dialog keeps its own list.
 */
export function brandKitApproveFindings(report: MktgAssetReport | null | undefined): BrandKitApproveFindings {
  const findings = report && isBrandKitReport(report) ? report.findings : undefined;
  if (!findings) return { failed: [], missing: [] };
  return {
    failed: findings.sources_failed.map((failed) => ({ title: brandKitFailedSourceTitle(failed.source), text: failed.reason, detail: failed.detail ?? null })),
    missing: findings.missing_assets.map((missing) => ({
      title: BRAND_KIT_REPORT_ASSET_LABELS[missing.asset],
      text: missing.reason,
      fix: missing.fix ?? null,
    })),
  };
}

/** The v2 rules of a report; empty for a v1 report or another agent's. */
export function brandKitReportRules(report: MktgAssetReport | null | undefined): BrandKitReportRule[] {
  return report && isBrandKitReport(report) && Array.isArray(report.rules) ? report.rules : [];
}

/** The v2 colour conflicts of a report; empty for a v1 report or another agent's. */
export function brandKitReportColorConflicts(report: MktgAssetReport | null | undefined): BrandKitReportColorConflict[] {
  return report && isBrandKitReport(report) && Array.isArray(report.color_conflicts) ? report.color_conflicts : [];
}

/** The chapter a rule path belongs to, or null when the path names none of the six. */
function chapterOfRulePath(path: string): BrandKitChapterRuleBasis['id'] | null {
  if (!path.startsWith(RULE_PATH_PREFIX)) return null;
  const rest = path.slice(RULE_PATH_PREFIX.length);
  return BRAND_KIT_CHAPTERS.find((chapter) => rest === chapter.id || rest.startsWith(`${chapter.id}.`) || rest.startsWith(`${chapter.id}[`))?.id ?? null;
}

/**
 * The rules grouped by chapter, in the kit's chapter order, with how many
 * come from the project and how many from the LF reference. A chapter with
 * no rule is left out, as is a rule whose path names no chapter; a v1 report
 * (no rules) gives an empty list.
 */
export function brandKitChapterRuleBases(rules: BrandKitReportRule[] | null | undefined): BrandKitChapterRuleBasis[] {
  const counts = new Map(BRAND_KIT_CHAPTERS.map((chapter) => [chapter.id, { project: 0, lfReference: 0 }]));
  for (const rule of rules ?? []) {
    const id = chapterOfRulePath(rule.path);
    const count = id ? counts.get(id) : undefined;
    if (!count) continue;
    if (rule.basis === 'lf-reference') count.lfReference += 1;
    else count.project += 1;
  }
  return BRAND_KIT_CHAPTERS.flatMap((chapter) => {
    const count = counts.get(chapter.id);
    const total = count ? count.project + count.lfReference : 0;
    return count && total > 0 ? [{ id: chapter.id, title: chapter.title, total, project: count.project, lfReference: count.lfReference }] : [];
  });
}

function ruleWord(count: number): string {
  return count === 1 ? 'rule' : 'rules';
}

/**
 * The chapter's basis pill, in plain words: all from the project, all from
 * the LF reference, or how many of its rules the reference supplied.
 */
export function brandKitChapterBasisLabel(chapter: BrandKitChapterRuleBasis): string {
  if (chapter.lfReference === 0) return BRAND_KIT_CHAPTER_BASIS_PROJECT;
  if (chapter.project === 0) return BRAND_KIT_CHAPTER_BASIS_LF;
  return `${BRAND_KIT_CHAPTER_BASIS_LF} for ${chapter.lfReference} of ${chapter.total} ${ruleWord(chapter.total)}`;
}

/** One line per chapter with at least one LF-reference rule: `Logo: 20 of 21 rules`. */
export function brandKitLfReferenceRuleLines(rules: BrandKitReportRule[] | null | undefined): BrandKitLfReferenceRuleLine[] {
  return brandKitChapterRuleBases(rules)
    .filter((chapter) => chapter.lfReference > 0)
    .map((chapter) => ({ id: chapter.id, text: `${chapter.title}: ${chapter.lfReference} of ${chapter.total} ${ruleWord(chapter.total)}` }));
}

/** The report's colour conflicts as the approve dialog shows them, every value with its source in words and the kept one marked. */
export function brandKitColorConflictViews(report: MktgAssetReport | null | undefined): BrandKitColorConflictView[] {
  return brandKitReportColorConflicts(report).map((conflict) => ({
    name: conflict.name,
    chosen: conflict.chosen,
    values: conflict.values.map((value) => ({ hex: value.hex, source: brandKitConflictSourceLabel(value.source), kept: value.hex === conflict.chosen })),
  }));
}

/**
 * Whether the report has something open that approving accepts: what the
 * approve dialog lists first. An open gap; for a report with the v2
 * findings, a source that could not be read or an asset not found (the
 * findings, which the legacy fields need not mirror); otherwise a legacy
 * failed source: a v2 report whose two groups are empty falls back to the
 * legacy fields, as the dialog's list does. The dialog's header and the
 * decision to show it both read this, so they count what the list shows.
 */
export function mktgReportHasOpenGaps(report: MktgAssetReport | null | undefined): boolean {
  if (!report) return false;
  if (report.gaps.length > 0) return true;
  const findings = isBrandKitReport(report) ? report.findings : undefined;
  if (findings && (findings.sources_failed.length > 0 || findings.missing_assets.length > 0)) return true;
  return report.sources_failed.length > 0;
}

/**
 * Whether approving this report deserves a look first: something open (above),
 * a colour conflict the kit resolved, or a rule the LF reference supplied.
 * False for a clean report, which approves directly.
 */
export function mktgReportNeedsApprovalReview(report: MktgAssetReport | null | undefined): boolean {
  if (!report) return false;
  return (
    mktgReportHasOpenGaps(report) || brandKitReportColorConflicts(report).length > 0 || brandKitLfReferenceRuleLines(brandKitReportRules(report)).length > 0
  );
}
