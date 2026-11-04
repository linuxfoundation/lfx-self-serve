// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BRAND_KIT_REPORT_ASSET_LABELS } from '../constants/brand-kit.constants';
import type { BrandKitReport, BrandKitSourcesItem, BrandKitSourcesView } from '../interfaces/brand-kit.interface';
import type { MktgRevisionApproval } from '../interfaces/mktg-document-store.interface';
import { brandKitIsLight, brandKitLabelInk } from './brand-kit-book.utils';
import { describeMktgAcceptedItem, mktgWarningAcceptedKey } from './mktg-asset.utils';

/**
 * The Sources tab's groups from a report: a v2 report's findings in the agent's plain words, never rewritten; a v1
 * report's legacy failed list in their place, with nothing missing, no warning and no conflict to show. Each item
 * carries whether the current approval's snapshot lists it; an approval without a snapshot marks nothing here and
 * leaves the derived gaps line to the view. `dark` is the kit's dark, the ink the Colour chapter's swatches prefer.
 */
export function brandKitSourcesView(report: BrandKitReport, approval: MktgRevisionApproval | null, version: number | null, dark: string): BrandKitSourcesView {
  const accepted = approval?.accepted ?? null;
  const has = (list: readonly string[] | undefined, key: string): boolean => !!list && list.includes(key);
  const item = (
    key: string,
    title: string,
    text: string,
    group: keyof NonNullable<typeof accepted>,
    extra: Partial<BrandKitSourcesItem> = {}
  ): BrandKitSourcesItem => ({
    key,
    title,
    text,
    detail: null,
    fix: null,
    source: null,
    accepted: has(accepted?.[group], key),
    ...extra,
  });
  const findings = report.findings;
  return {
    failed: findings
      ? findings.sources_failed.map((entry) => item(entry.source, entry.source, entry.reason, 'sources_failed', { detail: entry.detail ?? null }))
      : report.sources_failed.map((entry) => item(entry.name, entry.name, entry.reason, 'sources_failed')),
    missing: (findings?.missing_assets ?? []).map((entry) =>
      item(entry.asset, BRAND_KIT_REPORT_ASSET_LABELS[entry.asset], entry.reason, 'missing_assets', { fix: entry.fix ?? null })
    ),
    warnings: (findings?.warnings ?? []).map((entry) => item(mktgWarningAcceptedKey(entry), '', entry.text, 'warnings', { source: entry.source ?? null })),
    conflicts: (report.color_conflicts ?? []).map((entry) => ({
      key: entry.name,
      name: entry.name,
      values: entry.values.map((value) => ({ ...value, light: brandKitIsLight(value.hex), ink: brandKitLabelInk(value.hex, dark) })),
      chosen: entry.chosen,
      accepted: has(accepted?.color_conflicts, entry.name),
    })),
    gaps: report.gaps.map((gap) => ({ text: gap, accepted: has(accepted?.gaps, gap) })),
    acceptedMarker: accepted ? describeMktgAcceptedItem(version) : '',
    legacyApproval: !!approval && !accepted,
  };
}

/** A warning's source is a link only when it is an http(s) URL; anything else is shown as text. */
export function brandKitSourceHref(source: string | null): string | null {
  return source && /^https?:\/\//i.test(source) ? source : null;
}
