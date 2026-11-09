// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The v2 report's colour conflicts and rule bases as the approve dialog and
// the Kit page read them (brand-kit ≥ 2.2.0): the rules grouped by chapter
// with how many the project's own sources and the LF reference supplied, the
// words each surface prints for that, and the conflicts with every value's
// source in words. One reading for every surface; a v1 report, or any other
// agent's report, has none of it and renders as it always did.

import { BRAND_KIT_CHAPTER_BASIS_LF, BRAND_KIT_CHAPTER_BASIS_PROJECT, BRAND_KIT_CHAPTERS } from '../constants/brand-kit.constants';
import { MKTG_REPORT_ASSET_LABELS } from '../constants/mktg-asset.constants';
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
import { mktgReportAssetLabel } from './mktg-report-v2.utils';

/** The rule paths of the report are the envelope's: `chapters.<id>` followed by a member or an index. */
const RULE_PATH_PREFIX = 'chapters.';

/** `kind: source` — how the agent writes where a conflicting value was seen. */

/**
 * A report that carries a kit-only v2 field (the rules, the colour conflicts),
 * which only a Brand Kit writes: the guard the kit-only readers below use to
 * reach those fields. It is a shape test, not the document's type: a report
 * without either key is read as any agent's, and whether a document IS the
 * kit is the document type's to say. The findings are every agent's, read
 * from the generic report.
 */
function isBrandKitReport(report: MktgAssetReport): report is BrandKitReport {
  return 'rules' in report || 'color_conflicts' in report;
}

/**
 * What a v2 report's approve dialog lists first, in the Sources tab's words:
 * each source the agent could not read with its plain reason and detail, and
 * each asset it did not find with its label (or its id as written), reason
 * and fix. Any agent's report with findings; both empty for a v1 report,
 * whose dialog keeps its own list.
 */
export function brandKitApproveFindings(report: MktgAssetReport | null | undefined): BrandKitApproveFindings {
  const findings = report?.findings;
  if (!findings) return { failed: [], missing: [] };
  return {
    failed: findings.sources_failed.map((failed) => ({ title: brandKitFailedSourceTitle(failed.source), text: failed.reason, detail: failed.detail ?? null })),
    missing: findings.missing_assets.map((missing) => ({
      title: mktgReportAssetLabel(missing.asset, MKTG_REPORT_ASSET_LABELS),
      text: missing.reason,
      fix: missing.fix ?? null,
    })),
  };
}

/**
 * The gaps lines of a v2 report that no missing asset stands for, as written: the approve dialog lists them under Gaps
 * after the two findings groups, so an approver is told of every open gap. A gap is mirrored when some
 * `findings.missing_assets[].reason`, trimmed, is a substring of the gap line (the FAQ's gap is its question; the
 * boilerplates' is "Not answered: <question>"). Empty for a v1 report (its gaps list as before). Agent-agnostic: the
 * dialog, which knows the document type, leaves the group out for the Brand Kit.
 */
export function mktgReportUnmirroredGaps(report: MktgAssetReport | null | undefined): string[] {
  const findings = report?.findings;
  if (!report || !findings) return [];
  const reasons = findings.missing_assets.map((missing) => missing.reason.trim()).filter((reason) => reason.length > 0);
  return report.gaps.filter((gap) => !reasons.some((reason) => gap.includes(reason)));
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
  const findings = report.findings;
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
