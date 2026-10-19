// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BrandKitRevision } from '@lfx-one/shared/interfaces';

/**
 * A minimal, fully synthetic Brand Kit revision — what the Brand Kit agent's
 * result carries instead of a Markdown document. Fresh on every call, so a
 * test can edit what it returns without touching another's.
 */
export function brandKitTestRevision(): BrandKitRevision {
  const attributes = [
    { name: 'Plain', line: 'One sentence.' },
    { name: 'Specific', line: 'A number.' },
    { name: 'Neutral', line: 'No steering.' },
    { name: 'Welcoming', line: 'An invitation.' },
  ];
  const palette = [
    {
      name: 'Charcoal',
      hex: '#4D4E4E',
      rgb: [77, 78, 78] as [number, number, number],
      role: 'Headings',
      found_in: { kind: 'logo' as const, source: 'logo.svg' },
    },
    { name: 'White', hex: '#FFFFFF', rgb: [255, 255, 255] as [number, number, number], role: 'Page', found_in: { kind: 'page' as const, source: 'the page' } },
    {
      name: 'Orange',
      hex: '#F37625',
      rgb: [243, 118, 37] as [number, number, number],
      role: 'Accent',
      found_in: { kind: 'site_css' as const, source: 'https://one.example.org' },
    },
    {
      name: 'Mid gray',
      hex: '#767576',
      rgb: [118, 117, 118] as [number, number, number],
      role: 'Secondary',
      found_in: { kind: 'logo' as const, source: 'logo.svg' },
    },
  ];
  return {
    projectName: 'Project One',
    project: 'project-one',
    version: 1,
    mode: 'draft',
    kit: {
      colors: palette.map((entry) => [entry.name, entry.hex, entry.role] as [string, string, string]),
      font: 'Montserrat',
      fontNote: '',
      attrs: attributes.map((attribute) => [attribute.name, attribute.line] as [string, string]),
      dark: '#4D4E4E',
      accent: '#F37625',
      spark: '#F37625',
      word: 'PROJECT ONE',
    },
    chapters: {
      logo: {
        files: {
          primary: { ref: 'logo.svg', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 3"/>' },
          stacked: null,
          symbol: null,
          reversed: null,
        },
        symbol_viewbox: null,
        placeholder: false,
        system: 'The logo system.',
        colorways: [
          { name: 'Full color · on white', ground: 'white', logo: 'full color' },
          { name: 'Reversed · on Charcoal', ground: 'dark', logo: 'white' },
          { name: 'Full color · on light tint', ground: 'tint', logo: 'full color' },
          { name: 'One-color black · print only', ground: 'white', logo: 'black' },
        ],
        clear_space: 'X on every side.',
        minimum_size: { screen_px: 32, print_mm: 10, symbol_px: 16, rule: 'Below that, the symbol.' },
        symbol: 'The symbol.',
        partnership: ['One.', 'Two.', 'Three.', 'Four.', 'Five.'],
        watchouts: ['Stretch', 'Recolor', 'Rotate', 'Effects', 'Busy', 'Retype'],
      },
      color: {
        summary: 'Charcoal and white carry the brand.',
        palette,
        proportion: palette.map((entry, index) => ({ name: entry.name, hex: entry.hex, share: [55, 30, 10, 5][index] })),
        contrast: { rule: 'WCAG AA.', pairs: [{ foreground: 'Charcoal', background: 'White', ratio: 8.3, grade: 'AAA' }] },
      },
      type: {
        family: 'Montserrat',
        weights: [400, 700],
        source: 'https://one.example.org',
        google_fonts: true,
        fallback: null,
        note: '',
        summary: 'Montserrat throughout.',
        scale: [
          { step: 'display', label: 'H1 / Display', weight: 500, size: 64, line_height: 72, caps: false },
          { step: 'h2', label: 'H2', weight: 500, size: 32, line_height: 40, caps: false },
          { step: 'h3', label: 'H3', weight: 500, size: 24, line_height: 32, caps: false },
          { step: 'eyebrow', label: 'Eyebrow', weight: 500, size: 14, line_height: 20, caps: true },
          { step: 'body', label: 'Body', weight: 400, size: 18, line_height: 30, caps: false },
          { step: 'caption', label: 'Caption', weight: 500, size: 12, line_height: 16, caps: false },
        ],
        rules: ['Sentence case.', 'Caps for eyebrows.', 'Three weights.'],
      },
      visual: {
        icons: { rules: ['Line.', 'One color.', 'Active.', 'Label.'], recommended: 'Lucide' },
        imagery: { rule: 'Structure.', avoid: ['Stock', 'Hackers', 'Gradients'] },
      },
      usage: {
        summary: 'Dark grounds.',
        examples: [
          { name: 'Keynote slide', format: '16:9', ground: 'dark' },
          { name: 'Social card', format: '1200×675', ground: 'dark' },
          { name: 'Report cover', format: 'letter', ground: 'white' },
          { name: 'Announcement header', format: '1600×900', ground: 'dark' },
        ],
      },
      voice: {
        umbrella: 'Where organizations fund Project One.',
        line: 'Open standards for one computing',
        source: 'From the messaging framework',
        note: 'As they are.',
        attributes,
      },
    },
    report: { sources_read: ['https://one.example.org'], sources_failed: [], gaps: [], notes: '' },
    websiteUrl: 'https://one.example.org',
    generatedAt: '2026-10-17T00:00:00Z',
    agentVersion: '2.0.0',
  };
}
