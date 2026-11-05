// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { BrandKitReport, BrandKitReportRule } from '../../interfaces/brand-kit.interface';

/** The report's rule paths, bases and uses exactly as the agent lane's report-v2 QA fixture (2e923b3a) lists them: 56 rules over the six chapters. */
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
 * (brand-kit 2.2.0's computed envelope on a real site), with synthetic
 * sources: one colour conflict (Coral #FF702D on the brand page against
 * #FF7D2D in the site's CSS, the brand page's kept) and 56 rules — logo 1 project + 20 LF reference, color 1 + 4, type 6 + 5,
 * visual 0 + 9, usage 0 + 2, voice 7 + 1. What the approve dialog and the
 * Kit page's basis pills are tested against. Fresh on every call.
 */
export function brandKitReportV2RulesFixture(): BrandKitReport {
  const site = 'https://synthetic-foundation.example';
  const css = `${site}/_next/static/chunks/synthetic-chunk.css`;
  return {
    sources_read: [`${site}/`, `${site}/brand`, 'LFX record: Synthetic Foundation'],
    sources_failed: [{ name: `${site}/brand-guidelines`, reason: 'HTTP 404' }],
    gaps: ['No logo files: the logo chapter uses placeholder marks until the horizontal lockup, the stacked lockup and the symbol are uploaded.'],
    notes: '',
    version: 2,
    findings: {
      sources_failed: [
        {
          source: `${site}/brand-guidelines`,
          kind: 'brand_page',
          reason: 'This page does not exist on the site (the server answered 404).',
          detail: 'HTTP 404',
        },
      ],
      missing_assets: [
        {
          asset: 'logo_primary',
          reason: 'No logo file was uploaded and the site sets its wordmark in live type, so the kit shows placeholder marks.',
          fix: 'Upload the horizontal lockup as SVG, or share the logo package the brand page links.',
        },
      ],
      warnings: [
        { code: 'color_conflict', text: 'Coral is #FF702D on the brand page but the site’s stylesheet also uses #FF7D2D; the kit keeps #FF702D.', source: css },
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
