// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for Download PDF's view models: the brand a print is set in (the
// project's Brand Kit, or the LF look) and the Messaging Framework's print —
// its tabs as one document, the run's report left out. Every fixture is
// synthetic.

import { describe, expect, it } from 'vitest';

import { MKTG_PRINT_INK_ON_DARK, MKTG_PRINT_INK_ON_LIGHT, MKTG_PRINT_LF_LOOK, MKTG_PRINT_REVERSED_FILTER } from '../constants/mktg-print.constants';
import { BrandKitLogoRef, BrandKitRevision } from '../interfaces/brand-kit.interface';
import { FoundationMessageContent } from '../interfaces/foundation-message.interface';
import { buildFoundationMessagePrintView, foundationMessagePrintSections, mktgPrintBrand } from './mktg-print.utils';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 3"/>';

interface KitOptions {
  primary?: BrandKitLogoRef | null;
  reversed?: BrandKitLogoRef | null;
  placeholder?: boolean;
  dark?: string;
  googleFonts?: boolean;
}

/**
 * A whole kit, every required field filled with a placeholder, so the fixture
 * is type-checked against the interface (no cast). The fields a print reads
 * (the dark, the type chapter's Google Fonts flag and the logo files) take
 * their values from `options`.
 */
function kitWith(options: KitOptions = {}): BrandKitRevision {
  return {
    projectName: 'Orbit',
    project: 'orbit',
    version: 1,
    mode: 'draft',
    kit: { colors: [], font: 'Space Grotesk', fontNote: '', attrs: [], dark: options.dark ?? '#20232A', accent: '#3A86FF', spark: '#3A86FF', word: 'ORBIT' },
    chapters: {
      logo: {
        files: { primary: options.primary ?? null, stacked: null, symbol: null, reversed: options.reversed ?? null },
        symbol_viewbox: null,
        placeholder: options.placeholder ?? false,
        system: 'One lockup, one symbol.',
        colorways: [],
        clear_space: 'X.',
        minimum_size: { screen_px: 32, print_mm: 10, symbol_px: 16, rule: 'Below that, the symbol.' },
        symbol: 'The ring.',
        partnership: [],
        watchouts: [],
      },
      color: { summary: 'Ink on white.', palette: [], proportion: [], contrast: { rule: 'AA.', pairs: [] } },
      type: {
        family: 'Space Grotesk',
        weights: [400, 600],
        source: 'site',
        google_fonts: options.googleFonts ?? true,
        fallback: 'Arial',
        note: '',
        summary: 'Space Grotesk throughout.',
        scale: [],
        rules: [],
      },
      visual: { icons: { rules: [], recommended: 'Lucide' }, imagery: { rule: 'Real people.', avoid: [] } },
      usage: { summary: 'Dark grounds for impact.', examples: [] },
      voice: { umbrella: 'Orbit ships open releases.', line: 'Release, open', source: 'From the messaging framework', note: '', attributes: [] },
    },
    report: { sources_read: [], sources_failed: [], gaps: [], notes: '' },
    websiteUrl: 'https://orbit.example.org',
    generatedAt: '2026-10-18T00:00:00Z',
    agentVersion: '2.1.0',
  };
}

const CONTENT: FoundationMessageContent = {
  mf: {
    vision: 'A vision.',
    mission: 'A mission.',
    positioning: 'For platform teams.',
    tagline: 'Release, open.',
    goals: [{ id: 'adoption', n: 1, t: 'Adoption', vp: 'VP.', key: 'Key.', proof: [['1,200 members', 'Website']], bite: 'In the open', icps: ['users'] }],
    crosscut: 'Every column grows the audience.',
    say: ['open'],
    avoid: [['synergy', 'working together']],
    anchor: ['Which goal does this serve?'],
    notes: 'For the reviewer.',
  },
  icp: [
    {
      id: 'users',
      name: 'End users',
      kind: 'Individual',
      who: 'Engineers.',
      goals: ['adoption'],
      need: 'Need.',
      value: 'Value.',
      lead: 'Ship with confidence.',
      proof: [['A fact', 'Docs']],
      cta: 'Try it.',
      channels: ['Docs'],
      objection: ['Too early?', null],
      personas: [['SRE', 'uptime']],
      basis: 'Website',
    },
  ],
  mh: {
    umbrella: 'Umbrella.',
    line: 'Release, open.',
    pillars: [{ t: 'Open', m: 'Open message.', p: [['Fact', 'Web']] }],
    found: 'A Linux Foundation project.',
    aud: [['End users', 'Ship with confidence.']],
  },
  nums: [['1,200', 'members']],
};

describe('the print’s brand', () => {
  it('is the LF look without a kit: the LF navy and blue, Inter, and the Linux Foundation logo', () => {
    const brand = mktgPrintBrand(null);
    expect(brand.source).toBe('lf');
    expect([brand.dark, brand.accent, brand.tint]).toEqual([MKTG_PRINT_LF_LOOK.dark, MKTG_PRINT_LF_LOOK.accent, MKTG_PRINT_LF_LOOK.tint]);
    expect(brand.fontStack).toContain('Inter');
    expect([brand.fontUrl, brand.fontFamily]).toEqual([null, null]);
    expect(brand.logoOnDark?.src).toBe(MKTG_PRINT_LF_LOOK.logoOnDark);
    expect(brand.logoOnLight?.src).toBe(MKTG_PRINT_LF_LOOK.logoOnLight);
  });

  it('is the kit’s with one: its dark and accent, its typeface from Google Fonts, its supplied reversed artwork on the cover', () => {
    const brand = mktgPrintBrand(kitWith({ primary: { ref: 'orbit.svg', svg: SVG }, reversed: { ref: 'orbit-white.svg', svg: SVG } }));
    expect(brand.source).toBe('kit');
    expect([brand.dark, brand.accent]).toEqual(['#20232A', '#3A86FF']);
    expect(brand.tint).toContain('#20232A');
    expect(brand.fontStack).toBe("'Space Grotesk', 'Arial', sans-serif");
    expect(brand.fontUrl).toContain('family=Space+Grotesk');
    expect(brand.fontFamily).toBe('Space Grotesk');
    expect(brand.logoOnDark).toEqual({ src: expect.stringMatching(/^data:image\/svg\+xml/), alt: 'Orbit logo', filter: '' });
    expect(brand.logoOnLight?.filter).toBe('');
    expect(brand.onDark).not.toBe(MKTG_PRINT_INK_ON_LIGHT);
  });

  it('draws the primary lockup white on the cover when there is no reversed artwork, and leaves out a logo it cannot draw', () => {
    expect(mktgPrintBrand(kitWith({ primary: { ref: 'orbit.svg', svg: SVG } })).logoOnDark?.filter).toBe(MKTG_PRINT_REVERSED_FILTER);
    // A PNG the envelope carries no bytes for, or the kit's placeholder marks: no logo rather than a broken image.
    const png = mktgPrintBrand(kitWith({ primary: { ref: 'orbit.png', svg: null } }));
    expect([png.logoOnDark, png.logoOnLight]).toEqual([null, null]);
    const placeholder = mktgPrintBrand(kitWith({ primary: { ref: 'orbit.svg', svg: SVG }, placeholder: true }));
    expect([placeholder.logoOnDark, placeholder.logoOnLight]).toEqual([null, null]);
  });

  it('waits for no typeface the kit does not load from Google Fonts, and sets dark ink on a "dark" that is light', () => {
    const brand = mktgPrintBrand(kitWith({ googleFonts: false, dark: '#F4F4F4' }));
    expect([brand.fontUrl, brand.fontFamily]).toEqual([null, null]);
    expect(brand.onDark).toBe(MKTG_PRINT_INK_ON_LIGHT);
  });

  it('sets text on the kit’s dark panels in whichever ink reads better, so a mid-grey "dark" gets dark ink', () => {
    // White on #A0A0A0 is only 2.6:1; the dark ink reads far better there.
    expect(mktgPrintBrand(kitWith({ dark: '#A0A0A0' })).onDark).toBe(MKTG_PRINT_INK_ON_LIGHT);
    expect(mktgPrintBrand(kitWith({ dark: '#20232A' })).onDark).toBe(MKTG_PRINT_INK_ON_DARK);
  });

  it('sets the white pages’ body text in the kit’s dark when it reads on white, the LF navy without a kit', () => {
    expect(mktgPrintBrand(kitWith()).ink).toBe('#20232A');
    expect(mktgPrintBrand(null).ink).toBe(MKTG_PRINT_LF_LOOK.dark);
  });

  it('sets the white pages’ body text in dark ink when the kit’s "dark" is light or too pale to read on white, keeping the dark as the ground', () => {
    for (const dark of ['#F4F4F4', '#FFFFFF', '#A0A0A0']) {
      const brand = mktgPrintBrand(kitWith({ dark }));
      expect(brand.ink).toBe(MKTG_PRINT_INK_ON_LIGHT);
      expect(brand.dark).toBe(dark);
    }
  });
});

describe('the framework’s print', () => {
  it('holds the framework, the ICPs, the message house and the key numbers — never the run’s sources and gaps', () => {
    expect(foundationMessagePrintSections()).toEqual([
      { id: 'framework', number: '01', title: 'Framework' },
      { id: 'icps', number: '02', title: 'ICPs' },
      { id: 'message-house', number: '03', title: 'Message house' },
      { id: 'numbers', number: '04', title: 'Key numbers' },
    ]);
  });

  it('says what the screen says: the project, the version on the page, the framework’s own rows', () => {
    const view = buildFoundationMessagePrintView(CONTENT, ' TestOrbit ', 4, null);
    expect(view.projectName).toBe('TestOrbit');
    expect(view.eyebrow).toBe('TestOrbit · a Linux Foundation project');
    expect(view.runningHead).toBe('TestOrbit Messaging Framework');
    expect(view.versionLabel).toBe('Version 4');
    expect(view.goals[0].segmentNames).toEqual(['End users']);
    expect(view.icps[0].goalTitles).toEqual(['Adoption']);
    expect([view.goals[0].segmentLabel, view.icps[0].goalLabel, view.icps[0].channelsLabel]).toEqual(['End users', 'Adoption', 'Docs']);
    expect(view.avoidRows).toEqual([{ avoid: 'synergy', instead: 'working together' }]);
    expect(view.numbers).toEqual([{ number: '1,200', label: 'members' }]);
    expect(view.audiences).toEqual([{ name: 'End users', lead: 'Ship with confidence.' }]);
    expect(view.brand.source).toBe('lf');
    expect(buildFoundationMessagePrintView(CONTENT, 'TestOrbit', null, kitWith()).versionLabel).toBe('');
    expect(buildFoundationMessagePrintView(CONTENT, 'TestOrbit', null, kitWith()).brand.source).toBe('kit');
  });

  it('joins the lists the print sets as one line, and leaves a line empty when there is nothing to list', () => {
    const many: FoundationMessageContent = {
      ...CONTENT,
      mf: { ...CONTENT.mf, goals: [{ ...CONTENT.mf.goals[0], icps: ['users', 'maintainers'] }] },
      icp: [
        { ...CONTENT.icp[0], channels: ['Docs', 'Slack'] },
        { ...CONTENT.icp[0], id: 'maintainers', name: 'Maintainers', goals: [], channels: [] },
      ],
    };
    const view = buildFoundationMessagePrintView(many, 'TestOrbit', 1, null);
    expect(view.goals[0].segmentLabel).toBe('End users, Maintainers');
    expect(view.icps.map((icp) => [icp.goalLabel, icp.channelsLabel])).toEqual([
      ['Adoption', 'Docs · Slack'],
      ['', ''],
    ]);
  });
});
