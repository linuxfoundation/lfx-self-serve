// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for Download PDF's view models: the brand a print is set in (the
// project's Brand Kit, or the LF look) and the Messaging Framework's print —
// its tabs as one portrait book of fixed pages, the run's report left out.
// Every fixture is synthetic.

import { describe, expect, it } from 'vitest';

import { MKTG_PRINT_INK_ON_DARK, MKTG_PRINT_INK_ON_LIGHT, MKTG_PRINT_LF_LOOK, MKTG_PRINT_REVERSED_FILTER } from '../constants/mktg-print.constants';
import { BrandKitLogoRef, BrandKitRevision } from '../interfaces/brand-kit.interface';
import { FoundationMessageContent, FoundationMessageReport } from '../interfaces/foundation-message.interface';
import {
  buildBoilerplatesPrintView,
  buildFaqPrintView,
  buildFoundationMessagePrintView,
  foundationMessagePrintAnchorIntro,
  foundationMessagePrintMatrix,
  foundationMessagePrintNumbers,
  foundationMessagePrintSections,
  foundationMessagePrintSourceLabel,
  mktgPrintApprovedDate,
  mktgPrintBrand,
  mktgPrintDocumentTitle,
  mktgPrintIsWebKit,
} from './mktg-print.utils';
import boilerplatesEnvelope from './__fixtures__/boilerplates.envelope.json';
import faqEnvelope from './__fixtures__/faq-envelope.json';
import { brandKitLogolessFixture } from './__fixtures__/brand-kit-revision.fixture';
import { boilerplatesAssetOfRevision } from './boilerplates.utils';
import { faqAssetOfRevision } from './faq.utils';

it('builds printable lengths and FAQ groups from stored bytes, preserving unanswered questions without sources', () => {
  const brand = mktgPrintBrand(null);
  const boilerplates = boilerplatesAssetOfRevision(JSON.stringify(boilerplatesEnvelope.content), boilerplatesEnvelope);
  const faq = faqAssetOfRevision(JSON.stringify(faqEnvelope.content), faqEnvelope);
  if (!boilerplates || !faq) throw new Error('Invalid synthetic print fixtures');
  const lengths = buildBoilerplatesPrintView(boilerplates, brand);
  expect(lengths.brand).toBe(brand);
  expect(lengths.lengths.map((row) => row.text)).toEqual(boilerplatesEnvelope.content.bp.map((row) => row.t));
  expect(lengths.lengths).toHaveLength(4);
  const questions = buildFaqPrintView(faq, brand);
  expect(questions.brand).toBe(brand);
  expect(questions.groups.map((group) => group.name)).toEqual(faqEnvelope.content.faq.map(([name]) => name));
  expect(questions.groups[0].questions[0].source).toBe('Website');
  expect(questions.groups[0].questions[2]).toMatchObject({ answered: false, answer: '', source: '' });
});

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

describe('the print engine', () => {
  it.each([
    ['Safari 18 on macOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'],
    [
      'Safari on iOS',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    ],
    [
      'Chrome on iOS, a WebKit engine too',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
    ],
    ['Playwright webkit on Linux', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'],
  ])('reads %s as WebKit, where a table head and foot print once', (_name, userAgent) => {
    expect(mktgPrintIsWebKit(userAgent)).toBe(true);
  });

  it.each([
    ['Chrome 131 on macOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'],
    ['Edge on Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.70'],
    ['Opera on Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/116.0.0.0'],
    ['Firefox on macOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:132.0) Gecko/20100101 Firefox/132.0'],
    ['Playwright chromium headless', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.6778.33 Safari/537.36'],
    ['no user agent', ''],
  ])('reads %s as not WebKit, where the sheets repeat their room per page', (_name, userAgent) => {
    expect(mktgPrintIsWebKit(userAgent)).toBe(false);
  });
});

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
    // The grammar's logo-less kit (no files, the placeholder set): no logo on either ground, the brand's other fields kept.
    const logoless = mktgPrintBrand(brandKitLogolessFixture());
    expect([logoless.logoOnDark, logoless.logoOnLight, logoless.source]).toEqual([null, null, 'kit']);
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
  it('holds the framework and the key numbers — never the hidden ICPs and message house, nor the run’s sources and gaps', () => {
    expect(foundationMessagePrintSections()).toEqual([
      { id: 'framework', number: '01', title: 'Framework' },
      { id: 'numbers', number: '02', title: 'Key numbers' },
    ]);
  });

  it('says what the screen says: the project, the version on the page, the approval’s date, the run’s report and read date, the framework’s own rows', () => {
    const report: FoundationMessageReport = { sources_read: ['Website: https://orbit.example.org'], sources_failed: [], gaps: ['A gap.'], notes: 'A note.' };
    const view = buildFoundationMessagePrintView(CONTENT, ' TestOrbit ', 4, null, '2026-11-06T23:30:00Z', report, '2026-11-04');
    expect(view.projectName).toBe('TestOrbit');
    expect(view.eyebrow).toBe('TestOrbit · a Linux Foundation project');
    expect(view.runningHead).toBe('TestOrbit Messaging Framework');
    expect(view.versionLabel).toBe('V4.0');
    expect([view.approvedLabel, view.dateLabel]).toEqual(['Approved 6 Nov 2026', '6 Nov 2026']);
    expect(view.dateReadLabel).toBe('4 Nov 2026');
    expect(view.report).toBe(report);
    expect(view.website).toBe('');
    expect(view.goals[0].segmentNames).toEqual(['End users']);
    expect(view.icps[0].goalTitles).toEqual(['Adoption']);
    expect(view.icps[0].goalChips).toEqual(['Goal 1']);
    expect([view.goals[0].segmentLabel, view.icps[0].goalLabel, view.icps[0].channelsLabel]).toEqual(['End users', 'Adoption', 'Docs']);
    expect(view.avoidRows).toEqual([{ avoid: 'synergy', instead: 'working together' }]);
    expect(view.numbers).toEqual([{ number: '1,200', label: 'members', source: 'Website' }]);
    expect(view.audiences).toEqual([{ name: 'End users', lead: 'Ship with confidence.' }]);
    expect(view.facts).toEqual([{ fact: '1,200 members', source: 'Website', usedBy: 'Goal 1 · Adoption' }]);
    expect(view.brand.source).toBe('lf');
    // Without the dates and the report: empty labels, no report (the view says nothing the record never said), no read date (an unreadable one reads as none).
    const withKit = buildFoundationMessagePrintView(CONTENT, 'TestOrbit', null, kitWith(), null, null, 'yesterday');
    expect([withKit.versionLabel, withKit.approvedLabel, withKit.dateLabel, withKit.dateReadLabel]).toEqual(['', '', '', '']);
    expect(withKit.report).toBeNull();
    expect(withKit.website).toBe('orbit.example.org');
    expect(withKit.brand.source).toBe('kit');
  });

  it('dates the approval and the read as the deck does, in UTC, and leaves a date out when there is none or it cannot be read', () => {
    expect(mktgPrintApprovedDate('2026-11-06T23:30:00Z')).toBe('6 Nov 2026');
    expect(mktgPrintApprovedDate('2026-01-01T00:00:00Z')).toBe('1 Jan 2026');
    expect(mktgPrintApprovedDate('2026-11-04')).toBe('4 Nov 2026');
    expect(mktgPrintApprovedDate(null)).toBe('');
    expect(mktgPrintApprovedDate('not a date')).toBe('');
    // Every month, in UTC, the day without a leading zero: no locale call, so the same in every runtime.
    expect(Array.from({ length: 12 }, (_, month) => mktgPrintApprovedDate(`2026-${String(month + 1).padStart(2, '0')}-09T12:00:00Z`))).toEqual([
      '9 Jan 2026',
      '9 Feb 2026',
      '9 Mar 2026',
      '9 Apr 2026',
      '9 May 2026',
      '9 Jun 2026',
      '9 Jul 2026',
      '9 Aug 2026',
      '9 Sep 2026',
      '9 Oct 2026',
      '9 Nov 2026',
      '9 Dec 2026',
    ]);
  });

  it('names a read source as the run stored it, with only its type prefix taken off', () => {
    expect(foundationMessagePrintSourceLabel('Website: https://orbit.example.org')).toBe('https://orbit.example.org');
    expect(foundationMessagePrintSourceLabel('Link: https://orbit.example.org/about')).toBe('https://orbit.example.org/about');
    expect(foundationMessagePrintSourceLabel('Press release: https://www.linuxfoundation.org/press/orbit')).toBe('https://www.linuxfoundation.org/press/orbit');
    // No known prefix, or a prefix inside the text: untouched.
    expect(foundationMessagePrintSourceLabel('LFX Insights: members')).toBe('LFX Insights: members');
    expect(foundationMessagePrintSourceLabel('The Website: page')).toBe('The Website: page');
    expect(foundationMessagePrintSourceLabel('  Link:   spaced  ')).toBe('spaced');
  });

  it('crosses the goals with the profiles: one row per profile, true where the goal’s messaging is written for it', () => {
    const view = buildFoundationMessagePrintView(
      {
        ...CONTENT,
        mf: { ...CONTENT.mf, goals: [CONTENT.mf.goals[0], { ...CONTENT.mf.goals[0], id: 'funding', n: 2, t: 'Funding', icps: ['members'] }] },
        icp: [CONTENT.icp[0], { ...CONTENT.icp[0], id: 'members', name: 'Members', goals: ['funding'] }],
      },
      'TestOrbit',
      1,
      null
    );
    expect(foundationMessagePrintMatrix(view.goals, view.icps)).toEqual([
      { name: 'End users', cells: [true, false] },
      { name: 'Members', cells: [false, true] },
    ]);
    expect(view.icps.map((row) => row.goalChips)).toEqual([['Goal 1'], ['Goal 2']]);
  });

  it('matches a padded reference as the screen does, so a hand-edited version drops no card, chip or matrix cell', () => {
    const view = buildFoundationMessagePrintView(
      {
        ...CONTENT,
        mf: { ...CONTENT.mf, goals: [{ ...CONTENT.mf.goals[0], icps: [' end-users '] }] },
        icp: [{ ...CONTENT.icp[0], id: 'end-users', goals: ['adoption '] }],
      },
      'TestOrbit',
      1,
      null
    );
    expect(view.goals[0].icps).toEqual(['end-users']);
    expect(view.icps[0].goals).toEqual(['adoption']);
    expect(view.icps[0].goalChips).toEqual(['Goal 1']);
    expect(view.icps[0].whoWidth).toBe(190);
    expect(foundationMessagePrintMatrix(view.goals, view.icps)).toEqual([{ name: 'End users', cells: [true] }]);
  });

  it('counts the anchor questions in words in the say-and-avoid intro, the mock’s sentence with the agent’s three', () => {
    expect(foundationMessagePrintAnchorIntro(3)).toBe(
      'The words the framework uses, the ones it replaces, and the three questions every piece of content answers.'
    );
    expect(foundationMessagePrintAnchorIntro(1)).toBe(
      'The words the framework uses, the ones it replaces, and the one question every piece of content answers.'
    );
    expect(foundationMessagePrintAnchorIntro(5)).toContain('the five questions');
    expect(foundationMessagePrintAnchorIntro(7)).toContain('the 7 questions');
  });

  it('gives a key number the source of the proof points that state its figure whole, and none when none does or they disagree', () => {
    const fact = (text: string, source: string) => ({ fact: text, source, usedBy: 'Goal 1 · Adoption' });
    const facts = [
      fact('299 member organizations', 'LFX field'),
      fact('More than 10,000 published MCP servers at launch', 'Press release'),
      fact('8 Platinum, 50 Gold and 188 Silver memberships', 'LFX field'),
      fact('4,370 registrations for AGNTCon + MCPCon North America 2026', 'LFX field'),
      fact('4,370 seats were sold, says the venue', 'Website'),
      fact('The field count grew to 42.', 'LFX field'),
      fact('Of the 42, most renewed; 42.5 is no count, nor is 1,042', 'Website'),
    ];
    const numbers = foundationMessagePrintNumbers(
      [
        { number: '299', label: 'member organizations' },
        { number: '10,000+', label: 'published MCP servers at launch' },
        { number: '188', label: 'Silver memberships' },
        { number: '8', label: 'Platinum memberships' },
        { number: '88', label: 'nothing states this' },
        { number: '4,370', label: 'registrations' },
        { number: '', label: 'no figure' },
        { number: '42', label: 'stated before a period and a comma, in two sources' },
        { number: '1,042', label: 'stated once' },
      ],
      facts
    );
    expect(numbers.map((row) => row.source)).toEqual(['LFX field', 'Press release', 'LFX field', 'LFX field', '', '', '', '', 'Website']);
    // The stored record's key numbers carry no source of their own: the view's come from the facts, never from the pair.
    expect(buildFoundationMessagePrintView({ ...CONTENT, nums: [['7', 'wonders']] }, 'TestOrbit', 1, null).numbers).toEqual([
      { number: '7', label: 'wonders', source: '' },
    ]);
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

describe('the printed document’s title, the saved PDF’s file name', () => {
  it('names the PDF like the deck: the project, the asset, the revision on the page and that revision’s own UTC date', () => {
    expect(mktgPrintDocumentTitle('Synthetic Foundation', 'Brand kit', 3, '2026-11-05T23:30:00Z')).toBe('Synthetic Foundation · Brand kit · v3 · 2026-11-05');
    // The revision's date, not the download's, and the UTC day (a local evening is the next UTC day).
    expect(mktgPrintDocumentTitle('Synthetic Foundation', 'Messaging framework', 1, '2026-10-20T22:15:00-05:00')).toBe(
      'Synthetic Foundation · Messaging framework · v1 · 2026-10-21'
    );
  });

  it('leaves out what the document lacks: the version of the family PDF, a date the revision does not carry, a project it does not know', () => {
    expect(mktgPrintDocumentTitle('Synthetic Foundation', 'Positioning & brand', null, '2026-10-28T09:00:00Z')).toBe(
      'Synthetic Foundation · Positioning & brand · 2026-10-28'
    );
    expect(mktgPrintDocumentTitle('Synthetic Foundation', 'Brand kit', 2, null)).toBe('Synthetic Foundation · Brand kit · v2');
    expect(mktgPrintDocumentTitle('Synthetic Foundation', 'Brand kit', 2, 'not-a-date')).toBe('Synthetic Foundation · Brand kit · v2');
    expect(mktgPrintDocumentTitle('', 'AEO/GEO report', 2, '2026-10-13T12:02:00.000Z')).toBe('AEO/GEO report · v2 · 2026-10-13');
  });
});
