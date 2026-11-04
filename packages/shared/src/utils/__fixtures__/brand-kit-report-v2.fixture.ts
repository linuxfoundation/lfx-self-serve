// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { BrandKitReport } from '../../interfaces/brand-kit.interface';

/**
 * A v2 Brand Kit report as brand-kit ≥ 2.2.0 writes it: the three findings groups in plain language, one colour
 * conflict and the rules' basis, over the v1 fields. Synthetic, after the agent lane's field contract; fresh on
 * every call so a test can edit what it returns without touching another's.
 */
export function brandKitReportV2Fixture(): BrandKitReport {
  return {
    sources_read: ['https://synthetic-foundation.example/', 'https://synthetic-foundation.example/brand', 'LFX record: Synthetic Foundation'],
    sources_failed: [{ name: 'https://synthetic-foundation.example/brand-guidelines', reason: 'HTTP 404' }],
    gaps: ['No stacked logo was supplied.'],
    notes: '',
    version: 2,
    findings: {
      sources_failed: [
        {
          source: 'https://synthetic-foundation.example/brand-guidelines',
          kind: 'brand_page',
          reason: 'This page does not exist on the site (the server answered 404).',
          detail: 'HTTP 404',
        },
      ],
      missing_assets: [
        {
          asset: 'logo_stacked',
          reason: 'No stacked logo was uploaded and the site shows none.',
          fix: 'Upload the stacked logo as SVG, or point to the brand page that has it.',
        },
      ],
      warnings: [
        {
          code: 'color_conflict',
          text: 'Coral is #FF702D on the brand page but the site’s stylesheet also uses #FF7D2D; the kit keeps #FF702D.',
          source: 'https://synthetic-foundation.example/_next/static/chunks/synthetic.css',
        },
      ],
    },
    color_conflicts: [
      {
        name: 'Coral',
        values: [
          { hex: '#FF702D', source: 'brand_page: https://synthetic-foundation.example/brand' },
          { hex: '#FF7D2D', source: 'site_css: https://synthetic-foundation.example/_next/static/chunks/synthetic.css' },
        ],
        chosen: '#FF702D',
      },
    ],
    rules: [
      { path: 'chapters.logos.minimum_size.rule', basis: 'lf-reference' },
      { path: 'chapters.color.contrast.rule', basis: 'lf-reference' },
      { path: 'chapters.type.rules[0]', basis: 'lf-reference', uses: ['chapters.type.family'] },
      { path: 'chapters.color.palette', basis: 'project', uses: ['found_in'] },
      { path: 'chapters.type.family', basis: 'project' },
      { path: 'chapters.logos.files', basis: 'project' },
      { path: 'chapters.voice', basis: 'project' },
    ],
  };
}
