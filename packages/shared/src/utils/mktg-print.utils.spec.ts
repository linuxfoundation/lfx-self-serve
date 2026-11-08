// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for Download PDF's view models: the brand a print is set in (the
// project's Brand Kit, or the LF look) and the Messaging Framework's print —
// its tabs as one portrait book of fixed pages, the run's report left out.
// Every fixture is synthetic.

import { describe, expect, it } from 'vitest';

import {
  FRAMEWORK_PORTRAIT_SEP,
  MKTG_PRINT_DOT,
  MKTG_PRINT_INK_ON_DARK,
  MKTG_PRINT_INK_ON_LIGHT,
  MKTG_PRINT_LF_LOOK,
  MKTG_PRINT_REVERSED_FILTER,
} from '../constants/mktg-print.constants';
import { mktgPrintJoin } from './mktg-print-text.utils';
import { MKTG_READABLE_SOURCE } from '../constants/mktg-readable-source.constants';
import { BrandKitLogoRef, BrandKitRevision } from '../interfaces/brand-kit.interface';
import { FoundationMessageContent, FoundationMessageReport } from '../interfaces/foundation-message.interface';
import {
  buildBoilerplatesPrintView,
  buildFaqPrintView,
  buildFoundationMessagePrintView,
  foundationMessagePrintAnchorIntro,
  foundationMessagePrintIcpPageIntro,
  foundationMessagePrintMatrix,
  foundationMessagePrintNumbers,
  foundationMessagePrintReportText,
  foundationMessagePrintSourceLabel,
  foundationMessagePrintSourceRows,
  mktgPrintBrand,
  mktgPrintDocumentTitle,
  mktgPrintIsWebKit,
} from './mktg-print.utils';
import { brandKitPortraitDate } from './brand-kit-portrait.utils';
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
    // The supplied reversed file is drawn as it is: no filter, no plate; the fold carries the kit grammar's aspect (the fixture's 10 × 3 viewBox).
    expect(brand.logoOnDark).toEqual({ src: expect.stringMatching(/^data:image\/svg\+xml/), alt: 'Orbit logo', filter: '', aspect: 10 / 3 });
    expect(brand.logoOnLight?.filter).toBe('');
    expect(brand.onDark).not.toBe(MKTG_PRINT_INK_ON_LIGHT);
  });

  it('draws the primary lockup white on the cover when there is no reversed artwork, and leaves out a logo it cannot draw', () => {
    const derived = mktgPrintBrand(kitWith({ primary: { ref: 'orbit.svg', svg: SVG } })).logoOnDark;
    expect(derived?.filter).toBe(MKTG_PRINT_REVERSED_FILTER);
    expect(derived?.plate).toBeUndefined();
    // A multi-colour primary is never filtered (it would flatten to one shape): the dark ground draws it in full colour
    // on the white plate, the flag every print's cover reads.
    const twoColours =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 3"><rect fill="#1D4ED8" width="3" height="3"/><rect fill="#111827" x="4" width="6" height="3"/></svg>';
    const plated = mktgPrintBrand(kitWith({ primary: { ref: 'orbit.svg', svg: twoColours } })).logoOnDark;
    expect(plated?.filter).toBe('');
    expect(plated?.plate).toBe(true);
    // A supplied reversed file beside the multi-colour primary: drawn as it is, no plate.
    expect(
      mktgPrintBrand(kitWith({ primary: { ref: 'orbit.svg', svg: twoColours }, reversed: { ref: 'rev.svg', svg: SVG } })).logoOnDark?.plate
    ).toBeUndefined();
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
  it('says what the screen says: the project, the version on the page, the approval’s date, the run’s report and read date, the framework’s own rows', () => {
    const report: FoundationMessageReport = { sources_read: ['Website: https://orbit.example.org'], sources_failed: [], gaps: ['A gap.'], notes: 'A note.' };
    const view = buildFoundationMessagePrintView(CONTENT, ' TestOrbit ', 4, null, '2026-11-06T23:30:00Z', report, '2026-11-04');
    expect(view.projectName).toBe('TestOrbit');
    expect(view.eyebrow).toBe(`TestOrbit${FRAMEWORK_PORTRAIT_SEP}a Linux Foundation project`);
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
    // A continuation page's intro counts its cards: one card is "Profile N of M", a pair "Profiles N–M of T".
    expect(foundationMessagePrintIcpPageIntro(3, 2, 10)).toBe('Profiles 3–4 of 10.');
    expect(foundationMessagePrintIcpPageIntro(2, 1, 10)).toBe('Profile 2 of 10.');
    // A persona prints as one joined line, so an empty part leaves no trailing dot.
    expect(view.icps[0].personaLines).toEqual([`SRE${FRAMEWORK_PORTRAIT_SEP}uptime`]);
    const bare = buildFoundationMessagePrintView({ ...CONTENT, icp: [{ ...CONTENT.icp[0], personas: [['SRE', ' ']] }] }, 'TestOrbit', 1, null);
    expect(bare.icps[0].personaLines).toEqual(['SRE']);
    expect(view.avoidRows).toEqual([{ avoid: 'synergy', instead: 'working together' }]);
    expect(view.numbers).toEqual([{ number: '1,200', label: 'members', source: 'Website' }]);
    expect(view.audiences).toEqual([{ name: 'End users', lead: 'Ship with confidence.' }]);
    expect(view.facts).toEqual([{ fact: '1,200 members', source: 'Website', usedBy: `Goal 1${FRAMEWORK_PORTRAIT_SEP}Adoption` }]);
    expect(view.brand.source).toBe('lf');
    // Without the dates and the report: empty labels, no report (the view says nothing the record never said), no read date (an unreadable one reads as none).
    const withKit = buildFoundationMessagePrintView(CONTENT, 'TestOrbit', null, kitWith(), null, null, 'yesterday');
    expect([withKit.versionLabel, withKit.approvedLabel, withKit.dateLabel, withKit.dateReadLabel]).toEqual(['', '', '', '']);
    expect(withKit.report).toBeNull();
    expect(withKit.website).toBe('orbit.example.org');
    expect(withKit.brand.source).toBe('kit');
  });

  it('dates the approval and the read as the brand kit’s book does (one shared date rule, UTC), and leaves a date out when there is none or it cannot be read', () => {
    const dated = (approvedAt: string | null, dateRead: string | null) =>
      buildFoundationMessagePrintView(CONTENT, 'TestOrbit', 1, null, approvedAt, null, dateRead);
    expect(dated('2026-11-06T23:30:00Z', '2026-11-04')).toMatchObject({
      dateLabel: '6 Nov 2026',
      dateReadLabel: '4 Nov 2026',
      approvedLabel: 'Approved 6 Nov 2026',
    });
    expect(dated('2026-01-01T00:00:00Z', null)).toMatchObject({ dateLabel: '1 Jan 2026', dateReadLabel: '' });
    expect(dated(null, 'not a date')).toMatchObject({ dateLabel: '', dateReadLabel: '', approvedLabel: '' });
    expect(dated('2026-11-06T23:30:00Z', null).dateLabel).toBe(brandKitPortraitDate('2026-11-06T23:30:00Z'));
    // Every month, in UTC, the day without a leading zero: no locale call, so the same in every runtime.
    expect(Array.from({ length: 12 }, (_, month) => dated(`2026-${String(month + 1).padStart(2, '0')}-09T12:00:00Z`, null).dateLabel)).toEqual([
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
    // A URL as its address (the grammar's readable name: no scheme, no www., no query), a remark after it kept.
    expect(foundationMessagePrintSourceLabel('Website: https://orbit.example.org')).toBe('orbit.example.org');
    // Never a path (the editor's rule): the host, with the record's own remark after the dot when it wrote one; no word invented for a title.
    expect(foundationMessagePrintSourceLabel('Website: https://www.orbit.example.org/ (home)')).toBe(`orbit.example.org${FRAMEWORK_PORTRAIT_SEP}home`);
    expect(foundationMessagePrintSourceLabel('Link: https://orbit.example.org/about?utm=x')).toBe('orbit.example.org');
    expect(foundationMessagePrintSourceLabel('Link: https://github.com/orbit (org page and repos API)')).toBe(
      `github.com${FRAMEWORK_PORTRAIT_SEP}org page and repos API`
    );
    expect(foundationMessagePrintSourceLabel('orbit.example.org/md/about')).toBe('orbit.example.org');
    expect(foundationMessagePrintSourceLabel('docs.orbit.example.org')).toBe('docs.orbit.example.org');
    expect(foundationMessagePrintSourceLabel('orbit.example.org (home)')).toBe(`orbit.example.org${FRAMEWORK_PORTRAIT_SEP}home`);
    // A bare file name, an archive member or a hashed name is never an address: the grammar's words (the editor's "never a hashed
    // file name"); a dotted name followed by words is a phrase, as written.
    expect(foundationMessagePrintSourceLabel('a1b2c3d4e5f6a7b8c9d0.svg')).toBe(MKTG_READABLE_SOURCE.uploadedFiles);
    expect(foundationMessagePrintSourceLabel('Link: brand-guide.pdf')).toBe(MKTG_READABLE_SOURCE.uploadedFiles);
    expect(foundationMessagePrintSourceLabel('brand.zip/logo.svg')).toBe(MKTG_READABLE_SOURCE.uploadedPackage);
    expect(foundationMessagePrintSourceLabel('logo.svg')).toBe(MKTG_READABLE_SOURCE.uploadedFiles);
    expect(foundationMessagePrintSourceLabel('Node.js docs')).toBe('Node.js docs');
    expect(foundationMessagePrintSourceRows(['logo.svg', 'a1b2c3d4e5f6a7b8c9d0.svg'])).toEqual([
      MKTG_READABLE_SOURCE.uploadedFiles,
      MKTG_READABLE_SOURCE.uploadedFiles,
    ]);
    // A press release as the mock names it, "The press release" with the site's host (its press path goes with every other path).
    expect(foundationMessagePrintSourceLabel('Press release: https://www.linuxfoundation.org/press/linux-foundation-announces-orbit')).toBe(
      'The press release (linuxfoundation.org)'
    );
    expect(foundationMessagePrintSourceLabel('Press release: https://orbit.example.org')).toBe('The press release (orbit.example.org)');
    // The Read list's rows: the pages of one host gathered into one counted row, in the first one's place; a lone page keeps its remark.
    expect(
      foundationMessagePrintSourceRows([
        'Website: https://orbit.example.org (home)',
        'Website: https://orbit.example.org/md/about',
        'Link: https://github.com/orbit (org page and repos API)',
        'Website: https://orbit.example.org/md/members',
        'LFX record orbit and standard metrics',
        'LFX Insights: members',
      ])
    ).toEqual([
      `orbit.example.org${FRAMEWORK_PORTRAIT_SEP}3 pages`,
      `github.com${FRAMEWORK_PORTRAIT_SEP}org page and repos API`,
      MKTG_READABLE_SOURCE.lfxRecord,
      'LFX Insights: members',
    ]);
    expect(foundationMessagePrintSourceRows(['Docs', 'Docs'])).toEqual(['Docs', 'Docs']);
    for (const row of foundationMessagePrintSourceRows(['Website: https://a.example.org/x/y', 'Link: https://b.example.org/z (notes)']))
      expect(row).not.toContain('/');
    // The LFX record by the grammar's name, never its slug; an image URL as the grammar's words.
    expect(foundationMessagePrintSourceLabel('LFX record agentic-ai-foundation and standard metrics')).toBe(MKTG_READABLE_SOURCE.lfxRecord);
    expect(foundationMessagePrintSourceLabel('Link: https://cdn.example.org/a1b2c3d4e5f6a7b8.svg')).toBe(MKTG_READABLE_SOURCE.linkedImage);
    // No known prefix, or a prefix inside the text: the text itself.
    expect(foundationMessagePrintSourceLabel('LFX Insights: members')).toBe('LFX Insights: members');
    expect(foundationMessagePrintSourceLabel('The Website: page')).toBe('The Website: page');
    expect(foundationMessagePrintSourceLabel('  Link:   spaced  ')).toBe('spaced');
    // One middle-dot rule for every joined line: a plain space either side of the dot, the empty parts left out.
    expect(MKTG_PRINT_DOT).toBe(' · ');
    expect(mktgPrintJoin(['Goal 1', '', 'Events'])).toBe('Goal 1 · Events');
    // The saved PDF's file name keeps the prints' plain dot; the framework's pages take FRAMEWORK_PORTRAIT_SEP (S-b).
    expect(mktgPrintDocumentTitle('Orbit', 'Messaging Framework', 2, '2026-11-04T10:00:00Z')).toBe('Orbit · Messaging Framework · v2 · 2026-11-04');
    // A report sentence: the URL in it rewritten, the sentence's punctuation kept.
    expect(foundationMessagePrintReportText('The members page https://www.orbit.example.org/members?x=1 answered with a sign-in wall.')).toBe(
      'The members page orbit.example.org/members answered with a sign-in wall.'
    );
  });

  it('reads an address and its remark in one pass of the source, however long and hostile the source is', () => {
    // The address ends at the first whitespace; a bare address's remark glued to its path opens at the token's last parenthesis
    // when the remark runs on past a space (as the patterns this replaced read them: `orbit.example.org/a(b c)` is
    // `orbit.example.org · b c`, while `orbit.example.org/p(home)` is one token, the address); a remark on another line is no remark.
    expect(foundationMessagePrintSourceLabel('orbit.example.org/a(b c)')).toBe(`orbit.example.org${FRAMEWORK_PORTRAIT_SEP}b c`);
    expect(foundationMessagePrintSourceLabel('orbit.example.org/p(home)')).toBe('orbit.example.org');
    expect(foundationMessagePrintSourceLabel('en.wikipedia.org/wiki/Foo_(bar)')).toBe('en.wikipedia.org');
    expect(foundationMessagePrintSourceLabel('https://orbit.example.org/x (a) b')).toBe(`orbit.example.org${FRAMEWORK_PORTRAIT_SEP}(a) b`);
    expect(foundationMessagePrintSourceLabel('orbit.example.org (a) b')).toBe('orbit.example.org (a) b');
    expect(foundationMessagePrintSourceLabel('orbit.example.org\n(home)')).toBe(`orbit.example.org${FRAMEWORK_PORTRAIT_SEP}home`);
    expect(foundationMessagePrintSourceLabel('orbit.example.org (ho\nme)')).toBe('orbit.example.org (ho\nme)');
    // The patterns `^(\S+)(\s*\(.*\))?$` and `^(https?:\/\/\S+)(.*)$` took over 600 ms on these forty-thousand-character
    // sources (quadratic, CodeQL js/polynomial-redos); the split reads them in a pass.
    const hostile = [
      `orbit.example.org/${'('.repeat(40_000)} x`,
      `https://orbit.example.org/${'x'.repeat(40_000)}\n`,
      `orbit.example.org${' '.repeat(40_000)}${'('.repeat(40_000)}`,
    ];
    const started = performance.now();
    expect(hostile.map((source) => foundationMessagePrintSourceLabel(source).length)).toEqual([40_020, 17, 80_017]);
    expect(performance.now() - started).toBeLessThan(100);
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
    // A figure prints with its thousands separators (the editor's rule), and a fact that states it either way names its source.
    expect(foundationMessagePrintNumbers([{ number: '4370', label: 'registrations, stored without the separator' }], facts)).toEqual([
      { number: '4,370', label: 'registrations, stored without the separator', source: '' },
    ]);
    expect(foundationMessagePrintNumbers([{ number: '10000+', label: 'servers' }], facts)[0]).toMatchObject({ number: '10,000+', source: 'Press release' });
    // ... whichever form the record stores: a stored `10,000+` matches a proof that says `10000`, and when two sources state the
    // figure in the two forms, they disagree as sources and no pill is invented.
    expect(foundationMessagePrintNumbers([{ number: '10,000+', label: 'servers' }], [fact('Over 10000 servers were published', 'Website')])[0].source).toBe(
      'Website'
    );
    expect(
      foundationMessagePrintNumbers([{ number: '10,000+', label: 'servers' }], [fact('Over 10000 servers were published', 'Website'), ...facts])[0].source
    ).toBe('');
    expect(foundationMessagePrintNumbers([{ number: '96%', label: 'a share' }], [])[0].number).toBe('96%');
    // The label decides a four-digit figure's reading: a year under a year label, a separated count under any other (editor S1).
    expect(foundationMessagePrintNumbers([{ number: '2000', label: 'research groups run the toolchain' }], [])[0].number).toBe('2,000');
    expect(foundationMessagePrintNumbers([{ number: '2000', label: 'the year the project was founded' }], [])[0].number).toBe('2000');
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
      ['Adoption', `Docs${FRAMEWORK_PORTRAIT_SEP}Slack`],
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
