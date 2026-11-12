// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BRAND_KIT_FOUND_IN_KINDS, BRAND_KIT_LOGO_PACKAGE_TITLE, BRAND_KIT_REPORT_ASSET_LABELS } from '../constants/brand-kit.constants';
import type { BrandKitReport, BrandKitSourcesItem, BrandKitSourcesView } from '../interfaces/brand-kit.interface';
import type { MktgRevisionApproval } from '../interfaces/mktg-document-store.interface';
import { brandKitFoundIn, brandKitIsLight, brandKitLabelInk } from './brand-kit-book.utils';
import { brandKitWebsiteHost } from './brand-kit.utils';
import { describeMktgAcceptedItem, mktgWarningAcceptedKey } from './mktg-asset.utils';
import { mktgReportSourceHref } from './mktg-report-v2.utils';

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
    href: null,
    accepted: has(accepted?.[group], key),
    ...extra,
  });
  const findings = report.findings;
  return {
    failed: findings
      ? findings.sources_failed.map((entry) =>
          item(entry.source, brandKitFailedSourceTitle(entry.source), entry.reason, 'sources_failed', { detail: entry.detail ?? null, source: entry.source })
        )
      : report.sources_failed.map((entry) => item(entry.name, entry.name, entry.reason, 'sources_failed')),
    missing: (findings?.missing_assets ?? []).map((entry) =>
      item(entry.asset, BRAND_KIT_REPORT_ASSET_LABELS[entry.asset], entry.reason, 'missing_assets', { fix: entry.fix ?? null })
    ),
    warnings: (findings?.warnings ?? []).map((entry) =>
      item(mktgWarningAcceptedKey(entry), '', entry.text, 'warnings', { source: entry.source ?? null, href: brandKitSourceHref(entry.source ?? null) })
    ),
    conflicts: (report.color_conflicts ?? []).map((entry) => ({
      key: entry.name,
      name: entry.name,
      values: entry.values.map((value) => ({
        ...value,
        hexDigits: value.hex.slice(1),
        sourceLabel: brandKitConflictSourceLabel(value.source),
        light: brandKitIsLight(value.hex),
        ink: brandKitLabelInk(value.hex, dark),
      })),
      chosen: entry.chosen,
      accepted: has(accepted?.color_conflicts, entry.name),
    })),
    gaps: report.gaps.map((gap) => ({ text: gap, accepted: has(accepted?.gaps, gap) })),
    acceptedMarker: accepted ? describeMktgAcceptedItem(version) : '',
    legacyApproval: !!approval && !accepted,
  };
}

/** A warning's source is a link only when it is an http(s) URL; anything else is shown as text (the family's rule). */
export function brandKitSourceHref(source: string | null): string | null {
  return mktgReportSourceHref(source);
}

/** An http(s) address inside a source description: the card shows its host, never the full address. */
const URL_REGEX = /https?:\/\/\S+/gi;
const CONFLICT_SOURCE_REGEX = /^([a-z_]+):\s*(.*)$/s;
/** A web address whose path, before any query or fragment, names a ZIP file. */
const ZIP_URL_REGEX = /^https?:\/\/[^?#]*\.zip(?:[?#]|$)/i;

/**
 * Where a conflicting value was seen, in words: `brand_page: https://…` reads as the palette's own provenance
 * label with its site (`From the brand page — example.org`); any other address, with or without a kind the card
 * does not know, reads as its host; a description with no address as the agent wrote it.
 */
export function brandKitConflictSourceLabel(source: string): string {
  const text = source.trim();
  const match = CONFLICT_SOURCE_REGEX.exec(text);
  const kind = match ? BRAND_KIT_FOUND_IN_KINDS.find((known) => known === match[1]) : undefined;
  if (match && kind) return brandKitFoundIn({ kind, source: match[2] });
  return text.replace(URL_REGEX, (url) => brandKitWebsiteHost(url) || url);
}

/**
 * A failed source's title: a logo package the agent could not read from a link (a web address ending in `.zip`)
 * reads as `Logo package (ZIP) — host`; every other source keeps its own text, a page by its address, a v1 name as
 * the agent gave it.
 */
export function brandKitFailedSourceTitle(source: string): string {
  const text = source.trim();
  if (!ZIP_URL_REGEX.test(text)) return text;
  const host = brandKitWebsiteHost(text);
  return host ? `${BRAND_KIT_LOGO_PACKAGE_TITLE} — ${host}` : BRAND_KIT_LOGO_PACKAGE_TITLE;
}
