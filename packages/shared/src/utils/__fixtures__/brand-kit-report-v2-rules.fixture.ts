// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { BrandKitReport, BrandKitReportRule } from '../../interfaces/brand-kit.interface';

/** The report's rule paths, bases and uses exactly as the agent lane's report-v2 QA fixture (63ecbe6d) lists them: 56 rules over the six chapters. */
const RULES: [string, BrandKitReportRule['basis'], string[]?][] = [
  ['chapters.logo.files', 'project'],
  ['chapters.logo.placeholder', 'lf-reference', ['chapters.logo.files']],
  ['chapters.logo.system', 'lf-reference'],
  ['chapters.logo.colorways[0]', 'lf-reference', ['chapters.color.palette']],
  ['chapters.logo.colorways[1]', 'lf-reference', ['chapters.color.palette']],
  ['chapters.logo.colorways[2]', 'lf-reference', ['chapters.color.palette']],
  ['chapters.logo.colorways[3]', 'lf-reference', ['chapters.color.palette']],
  ['chapters.logo.clear_space', 'lf-reference'],
  ['chapters.logo.minimum_size.rule', 'lf-reference'],
  ['chapters.logo.symbol', 'lf-reference'],
  ['chapters.logo.partnership[0]', 'lf-reference', ['chapters.color.palette']],
  ['chapters.logo.partnership[1]', 'lf-reference', ['chapters.color.palette']],
  ['chapters.logo.partnership[2]', 'lf-reference', ['chapters.color.palette']],
  ['chapters.logo.partnership[3]', 'lf-reference', ['chapters.color.palette']],
  ['chapters.logo.partnership[4]', 'lf-reference', ['chapters.color.palette']],
  ['chapters.logo.watchouts[0]', 'lf-reference'],
  ['chapters.logo.watchouts[1]', 'lf-reference'],
  ['chapters.logo.watchouts[2]', 'lf-reference'],
  ['chapters.logo.watchouts[3]', 'lf-reference'],
  ['chapters.logo.watchouts[4]', 'lf-reference'],
  ['chapters.logo.watchouts[5]', 'lf-reference'],
  ['chapters.color.palette', 'project', ['found_in']],
  ['chapters.color.summary', 'lf-reference', ['chapters.color.palette']],
  ['chapters.color.proportion', 'lf-reference', ['chapters.color.palette']],
  ['chapters.color.contrast.rule', 'lf-reference'],
  ['chapters.color.contrast.pairs', 'lf-reference', ['chapters.color.palette']],
  ['chapters.type.family', 'project'],
  ['chapters.type.weights', 'project'],
  ['chapters.type.source', 'project'],
  ['chapters.type.fallback', 'project'],
  ['chapters.type.google_fonts', 'project'],
  ['chapters.type.note', 'project'],
  ['chapters.type.summary', 'lf-reference', ['chapters.type.family', 'chapters.type.note']],
  ['chapters.type.scale', 'lf-reference', ['chapters.type.family']],
  ['chapters.type.rules[0]', 'lf-reference', ['chapters.type.family']],
  ['chapters.type.rules[1]', 'lf-reference', ['chapters.type.family']],
  ['chapters.type.rules[2]', 'lf-reference', ['chapters.type.family']],
  ['chapters.visual.icons.rules[0]', 'lf-reference', ['chapters.color.palette']],
  ['chapters.visual.icons.rules[1]', 'lf-reference', ['chapters.color.palette']],
  ['chapters.visual.icons.rules[2]', 'lf-reference', ['chapters.color.palette']],
  ['chapters.visual.icons.rules[3]', 'lf-reference', ['chapters.color.palette']],
  ['chapters.visual.icons.recommended', 'lf-reference'],
  ['chapters.visual.imagery.rule', 'lf-reference', ['chapters.color.palette']],
  ['chapters.visual.imagery.avoid[0]', 'lf-reference'],
  ['chapters.visual.imagery.avoid[1]', 'lf-reference'],
  ['chapters.visual.imagery.avoid[2]', 'lf-reference'],
  ['chapters.usage.summary', 'lf-reference', ['chapters.type.family']],
  ['chapters.usage.examples', 'lf-reference', ['chapters.color.palette']],
  ['chapters.voice.umbrella', 'project'],
  ['chapters.voice.line', 'project'],
  ['chapters.voice.source', 'project'],
  ['chapters.voice.note', 'lf-reference'],
  ['chapters.voice.attributes[0]', 'project'],
  ['chapters.voice.attributes[1]', 'project'],
  ['chapters.voice.attributes[2]', 'project'],
  ['chapters.voice.attributes[3]', 'project'],
];

/**
 * A v2 Brand Kit report in the shape of the agent lane's report-v2 QA fixture
 * (brand-kit 2.2.2's acceptance envelope on a real site, 63ecbe6d), with
 * synthetic sources: one colour conflict (Coral #FF702D on the brand page against
 * #FF7D2D in the site's CSS, the brand page's kept) and 56 rules — logo 1 project + 20 LF reference, color 1 + 4, type 6 + 5,
 * visual 0 + 9, usage 0 + 2, voice 7 + 1. What the approve dialog and the
 * Kit page's basis pills are tested against. Fresh on every call.
 */
export function brandKitReportV2RulesFixture(): BrandKitReport {
  const site = 'https://synthetic-foundation.example';
  const css = `${site}/_next/static/chunks/synthetic-chunk.css`;
  const cdn = 'https://cdn.synthetic-foundation.example';
  return {
    sources_read: [`${site}/`, `${site}/brand`, 'LFX record: Synthetic Foundation'],
    sources_failed: [{ name: `${site}/brand-guidelines`, reason: 'HTTP 404' }],
    gaps: ['No logo files: the logo chapter uses placeholder marks until the horizontal lockup, the stacked lockup and the symbol are uploaded.'],
    notes: '',
    version: 2,
    // The findings as the agent's acceptance fixture (63ecbe6d) writes them, with the site's hosts and file names made synthetic.
    findings: {
      sources_failed: [
        {
          source: `${site}/brand-guidelines`,
          kind: 'brand_page',
          reason: 'This page does not exist on the site (the server answered 404).',
          detail: 'HTTP 404',
        },
        {
          source: `${cdn}/files/synthetic/production/synthetic-logo-package.zip?dl=`,
          kind: 'logo_package',
          reason:
            'The logo package on synthetic-foundation.example/brand is a ZIP file, which the agent can’t download from a link. Upload the stacked, reversed, symbol and primary files as SVG in the form, or a ZIP of the SVG files under 150 KB; a larger ZIP may not send.',
          detail: 'linked ZIP, not readable from a link',
        },
      ],
      missing_assets: [
        {
          asset: 'logo_primary',
          reason: 'The site’s header links a logo image (synthetic-logo-838x203.svg) that was not read in this run, so the kit shows placeholder marks.',
          fix: 'Upload the primary file as SVG in the form, or a ZIP of the SVG files under 150 KB; the full package linked on synthetic-foundation.example/brand is likely too large to send.',
        },
        {
          asset: 'logo_stacked',
          reason: 'No stacked logo was uploaded and none was read from the site.',
          fix: 'Upload the stacked file as SVG in the form, or a ZIP of the SVG files under 150 KB; the full package linked on synthetic-foundation.example/brand is likely too large to send.',
        },
        {
          asset: 'logo_symbol',
          reason: 'No symbol was uploaded and none could be cropped out of a lockup.',
          fix: 'Upload the symbol file as SVG in the form, or a ZIP of the SVG files under 150 KB; the full package linked on synthetic-foundation.example/brand is likely too large to send.',
        },
        {
          asset: 'logo_reversed',
          reason: 'No white (reversed) logo was uploaded; dark grounds reuse the full-color lockup until one is.',
          fix: 'Upload the reversed file as SVG in the form, or a ZIP of the SVG files under 150 KB; the full package linked on synthetic-foundation.example/brand is likely too large to send.',
        },
      ],
      warnings: [
        { code: 'color_conflict', text: 'Coral is #FF702D on the brand page but the site’s stylesheet also uses #FF7D2D; the kit keeps #FF702D.', source: css },
        {
          code: 'palette_from_page_text',
          text: 'Coral and Lilac were read from the brand page’s printed values, not from a stylesheet token or a logo file.',
          source: `${site}/brand`,
        },
        {
          code: 'brand_page_guessed',
          text: 'The brand page was found by its path on the site, not named on the form: check it is the project’s own brand page.',
          source: `${site}/brand`,
        },
      ],
    },
    color_conflicts: [
      {
        name: 'Coral',
        values: [
          { hex: '#FF702D', source: `brand_page: ${site}/brand` },
          { hex: '#FF7D2D', source: `site_css: ${css}` },
        ],
        chosen: '#FF702D',
      },
    ],
    rules: RULES.map(([path, basis, uses]) => (uses ? { path, basis, uses } : { path, basis })),
  };
}

/**
 * The same report with nothing for the approve dialog's top list: no failed
 * source, no missing asset, no open gap, in the legacy fields and the v2
 * findings alike. Its colour conflict and rules stay; a case that wants a
 * report that approves directly clears those too.
 */
export function brandKitCleanReportV2Fixture(): BrandKitReport {
  return { ...brandKitReportV2RulesFixture(), sources_failed: [], gaps: [], findings: { sources_failed: [], missing_assets: [], warnings: [] } };
}
