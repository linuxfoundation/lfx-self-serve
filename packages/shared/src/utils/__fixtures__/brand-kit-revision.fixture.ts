// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { BrandKitRevision } from '../../interfaces/brand-kit.interface';

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

/**
 * The same kit before any logo file is uploaded: every logo slot empty and the chapter marked a placeholder, as the
 * store holds a run that found no artwork. The portrait book plans its Logo chapter down to one page saying so; the
 * print-QA harness seeds a scratch store from it (the logo-less fixture of the final round).
 */
export function brandKitLogolessFixture(): BrandKitRevision {
  const revision = brandKitTestRevision();
  revision.chapters.logo.files = { primary: null, stacked: null, symbol: null, reversed: null };
  revision.chapters.logo.placeholder = true;
  return revision;
}

/**
 * The same kit with raster uploads only: a PNG lockup and a PNG symbol, files the record holds (`svg: null`, the
 * envelope carries no drawable bytes) and the print cannot draw. The Logo system page lists them in its files table
 * and says the book draws inline SVG artwork only; the pages whose content is artwork tiles drop from the plan.
 */
export function brandKitPngOnlyFixture(): BrandKitRevision {
  const revision = brandKitTestRevision();
  revision.chapters.logo.files = {
    primary: { ref: 'project-one-lockup.png', svg: null },
    stacked: null,
    symbol: { ref: 'project-one-symbol.png', svg: null },
    reversed: null,
  };
  return revision;
}

/**
 * The same kit at the envelope's far edge, every list at the schema's longest and every line as long as the agent
 * may write: five colours (`BRAND_KIT_PALETTE_MAX`), the four attributes with 300-character lines, a 300-character
 * brand line, umbrella, summary and rule everywhere, nine contrast pairs, twenty sources read, a long failed source,
 * a long gap and six colour conflicts of three values. It stays a valid record (`readBrandKitRevision` reads it),
 * which the fixture spec checks. The portrait book prints it with every page bounded: smaller steps, cuts at a
 * sentence, and `+N more` lines where a list runs past its room, never a line past the footer and never a silent
 * drop. The print-QA harness prints it.
 */
export function brandKitOverfullFixture(): BrandKitRevision {
  const revision = brandKitTestRevision();
  const clause =
    'The name of the project goes first and the rest of the sentence follows at the same weight, so the reader finds the fact before the reasons and the reasons before any aside.';
  // Two clauses, the second ended at a word and a full stop inside 300 characters, so no uncut line ends mid-word.
  const second = clause.slice(0, 300 - clause.length - 1);
  const long = `${clause} ${second.slice(0, second.lastIndexOf(' '))}.`;
  const attributes = revision.chapters.voice.attributes.map((attribute) => ({ ...attribute, line: long }));
  const teal = {
    name: 'Teal',
    hex: '#0F766E',
    rgb: [15, 118, 110] as [number, number, number],
    role: 'Links and the active state of every control on the site',
    found_in: { kind: 'site_css' as const, source: 'https://one.example.org/_next/static/chunks/0a1b2c3d4e5f.css' },
  };
  const palette = [...revision.chapters.color.palette, teal];
  revision.kit.colors = palette.map((entry) => [entry.name, entry.hex, entry.role] as [string, string, string]);
  revision.kit.attrs = attributes.map((attribute) => [attribute.name, attribute.line] as [string, string]);
  revision.chapters.color.palette = palette;
  revision.chapters.color.proportion = palette.map((entry, index) => ({ name: entry.name, hex: entry.hex, share: [50, 25, 10, 10, 5][index] }));
  revision.chapters.color.contrast = {
    rule: long,
    pairs: [
      { foreground: 'Charcoal', background: 'White', ratio: 8.3, grade: 'AAA' },
      { foreground: 'White', background: 'Charcoal', ratio: 8.3, grade: 'AAA' },
      { foreground: 'Orange', background: 'White', ratio: 2.8, grade: 'Fails' },
      { foreground: 'White', background: 'Orange', ratio: 2.8, grade: 'Fails' },
      { foreground: 'Mid gray', background: 'White', ratio: 4.6, grade: 'AA' },
      { foreground: 'White', background: 'Mid gray', ratio: 4.6, grade: 'AA' },
      { foreground: 'Teal', background: 'White', ratio: 5.5, grade: 'AA' },
      { foreground: 'White', background: 'Teal', ratio: 5.5, grade: 'AA' },
      { foreground: 'Charcoal', background: 'Mid gray', ratio: 1.8, grade: 'Fails' },
    ],
  };
  revision.chapters.color.summary = long;
  revision.chapters.logo.system = long;
  revision.chapters.logo.clear_space = long;
  revision.chapters.logo.minimum_size.rule = long;
  revision.chapters.logo.symbol = long;
  revision.chapters.logo.partnership = revision.chapters.logo.partnership.map(() => long);
  revision.chapters.type.summary = long;
  revision.chapters.type.note = long;
  revision.chapters.type.rules = revision.chapters.type.rules.map(() => long);
  revision.chapters.visual.icons.rules = revision.chapters.visual.icons.rules.map(() => long);
  revision.chapters.visual.imagery.rule = long;
  revision.chapters.visual.imagery.avoid = revision.chapters.visual.imagery.avoid.map(() => long);
  revision.chapters.usage.summary = long;
  revision.chapters.voice = { ...revision.chapters.voice, umbrella: long, line: long, note: long, attributes };
  revision.report = {
    version: 2,
    sources_read: Array.from({ length: 20 }, (_, index) => `https://one.example.org/about/section-${index + 1}/the-page-the-run-read`),
    sources_failed: [{ name: 'https://one.example.org/brand/the-press-kit-page-that-timed-out', reason: long }],
    gaps: [long],
    notes: long,
    color_conflicts: Array.from({ length: 6 }, (_, index) => ({
      name: ['Charcoal', 'White', 'Orange', 'Mid gray', 'Teal', 'Accent'][index],
      values: [
        { hex: palette[index % 5].hex, source: 'https://one.example.org/brand' },
        { hex: '#123456', source: 'https://one.example.org/_next/static/chunks/0a1b2c3d4e5f.css' },
        { hex: '#654321', source: 'logo.svg' },
      ],
      chosen: palette[index % 5].hex,
    })),
  };
  return revision;
}

/**
 * The smallest kit the envelope allows: four colours (`BRAND_KIT_PALETTE_MIN`), one logo file, one weight, no
 * contrast pairs, no proportion shares beyond the rows the schema requires, one-word lines, and an empty report
 * (nothing read, failed, missing or in conflict). It stays a valid record, which the fixture spec checks. The
 * portrait book plans its pages from what the record holds: the empty facts drop their slots (the pairs list, the
 * Sources page's lists) and nothing prints as a blank or a bracket. The print-QA harness prints it.
 */
export function brandKitMinimalFixture(): BrandKitRevision {
  const revision = brandKitTestRevision();
  revision.kit.attrs = revision.kit.attrs.map(([name]) => [name, 'Yes.'] as [string, string]);
  revision.chapters.color.summary = 'Four colors.';
  revision.chapters.color.contrast = { rule: 'AA.', pairs: [] };
  revision.chapters.logo.system = 'One logo.';
  revision.chapters.logo.clear_space = 'X.';
  revision.chapters.logo.minimum_size = { screen_px: 24, print_mm: 8, symbol_px: 12, rule: 'Small.' };
  revision.chapters.logo.symbol = 'None.';
  revision.chapters.type.weights = [400];
  revision.chapters.type.summary = 'One weight.';
  revision.chapters.type.scale = revision.chapters.type.scale.map((step) => ({ ...step, weight: 400 }));
  revision.chapters.visual.icons.recommended = 'Lucide';
  revision.chapters.visual.imagery.rule = 'Plain.';
  revision.chapters.usage.summary = 'Plain.';
  revision.chapters.voice = {
    ...revision.chapters.voice,
    umbrella: 'One.',
    line: 'One.',
    note: 'One.',
    attributes: revision.chapters.voice.attributes.map((attribute) => ({ ...attribute, line: 'Yes.' })),
  };
  revision.report = { sources_read: [], sources_failed: [], gaps: [], notes: '' };
  return revision;
}
