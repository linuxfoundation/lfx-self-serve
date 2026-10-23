// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for Export to Google Slides' shared contract: the intake
// renderer (a mirror of the exporter's renderFormMessage — the expected text
// below is what the agent's own renderer produced for the same form), the
// result envelope's validator, the plain failure messages, and the export
// record. Every fixture is synthetic.

import { describe, expect, it } from 'vitest';

import {
  MKTG_SLIDES_EXPORT_FAILURE_MESSAGES,
  MKTG_SLIDES_EXPORT_LOGO_NOTES,
  MKTG_SLIDES_EXPORT_RECORD_SCHEMA,
} from '../constants/mktg-slides-export.constants';
import { MktgSlidesExportBranded, MktgSlidesExportRecord } from '../interfaces/mktg-slides-export.interface';
import {
  buildMktgSlidesExportPrefix,
  buildMktgSlidesExportRecordKey,
  classifyMktgSlidesExportFailure,
  isMktgSlidesExportStale,
  mktgSlidesExportBrandSummary,
  mktgSlidesExportDeckLink,
  mktgSlidesExportDeckTitle,
  mktgSlidesExportFailed,
  mktgSlidesExportOneLine,
  parseMktgSlidesExportRecordKey,
  readMktgSlidesExportRecord,
  renderMktgSlidesExportFormMessage,
  validateMktgSlidesExportEnvelope,
} from './mktg-slides-export.utils';

const DECK_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz';
const FOLDER_ID = '1rH6qCSXSb_GEQ5-N1-IEosGjy2y8GcoH';
const SHA = 'a'.repeat(64);

const BRANDED: MktgSlidesExportBranded = {
  kit: true,
  logo: true,
  backgrounds: 5,
  text_colors: 2,
  fonts: 15,
  bars: 2,
  logos: 9,
  logos_skipped: 0,
  tables_header: '#003B5C',
};

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contract: 'slides-export-output/v1',
    kind: 'slides-export',
    project: 'example-project',
    project_name: 'Example Project',
    mode: 'create',
    deck: { id: DECK_ID, link: mktgSlidesExportDeckLink(DECK_ID), title: 'Example Project · Brand kit · 2026-10-19', folder_id: FOLDER_ID },
    slide_count: 3,
    content: {
      assets: ['kit'],
      slides: [
        { index: 1, kind: 'title', layout: 'TITLE', title: 'Example Project', object_id: 'sx1_s01' },
        { index: 2, kind: 'two-columns', layout: 'TITLE_AND_TWO_COLUMNS', title: 'Brand kit', object_id: 'sx1_s02' },
        { index: 3, kind: 'closing', layout: 'TITLE_2_1', title: '', object_id: 'sx1_s03' },
      ],
      branded: BRANDED,
    },
    content_sha256: SHA,
    generated_at: '2026-10-19T10:00:00.000Z',
    agent: { identifier: 'linux-foundation~slides-export', agent_version: '1.0.2' },
    ...overrides,
  };
}

function record(overrides: Partial<MktgSlidesExportRecord> = {}): MktgSlidesExportRecord {
  return {
    schema: MKTG_SLIDES_EXPORT_RECORD_SCHEMA,
    project: 'project-uid',
    agentKey: 'brand-kit',
    documentId: 'living',
    revisionId: `000002-${SHA}`,
    revisionNumber: 2,
    contentSha256: SHA,
    mode: 'create',
    deckId: DECK_ID,
    link: mktgSlidesExportDeckLink(DECK_ID),
    title: 'Example Project · Brand kit · 2026-10-19',
    slideCount: 3,
    assets: ['kit'],
    branded: BRANDED,
    exportedAt: '2026-10-19T10:00:00.000Z',
    agentVersion: '1.0.2',
    ...overrides,
  };
}

describe('renderMktgSlidesExportFormMessage', () => {
  it('renders the marker lines exactly as the exporter parses them', () => {
    const text = renderMktgSlidesExportFormMessage(
      {
        project_name: 'Example Project',
        run_date: '2026-10-19',
        folder_id: FOLDER_ID,
        deck_title: 'Example Project · Messaging framework · 2026-10-19',
        assets: { framework: { mh: { umbrella: 'U' } }, kit: { dark: '#003B5C' } },
      },
      new Date('2026-10-19T10:00:00Z')
    );
    expect(text).toBe(
      [
        'BATCH INTAKE SUBMISSION (Slides export)',
        'PROJECT NAME: Example Project',
        'RUN DATE: 2026-10-19',
        `FOLDER ID: ${FOLDER_ID}`,
        'DECK ID: none (create a new deck from the LF 2025 template)',
        'DECK TITLE: Example Project · Messaging framework · 2026-10-19',
        'LOGO URL: none',
        'ASSETS: framework, kit',
        '--- ASSETS (JSON) ---',
        '{',
        '  "framework": {',
        '    "mh": {',
        '      "umbrella": "U"',
        '    }',
        '  },',
        '  "kit": {',
        '    "dark": "#003B5C"',
        '  }',
        '}',
        '--- END ASSETS ---',
      ].join('\n')
    );
  });

  it('renders an update: the deck id, no folder, the agent’s default title and today’s date when none is given', () => {
    const text = renderMktgSlidesExportFormMessage(
      { project_name: 'Example Project', deck_id: DECK_ID, logo_url: 'https://cdn.example.test/logo.png', assets: { kit: {} } },
      new Date('2026-10-19T23:30:00Z')
    );
    expect(text.split('\n').slice(0, 8)).toEqual([
      'BATCH INTAKE SUBMISSION (Slides export)',
      'PROJECT NAME: Example Project',
      'RUN DATE: 2026-10-19',
      'FOLDER ID: none',
      `DECK ID: ${DECK_ID}`,
      'DECK TITLE: Example Project · Messaging · 2026-10-19',
      'LOGO URL: https://cdn.example.test/logo.png',
      'ASSETS: kit',
    ]);
  });

  it('names the assets in the deck’s order whatever order the object holds them in', () => {
    const text = renderMktgSlidesExportFormMessage({ project_name: 'P', run_date: '2026-10-19', folder_id: FOLDER_ID, assets: { kit: {}, framework: {} } });
    expect(text).toContain('\nASSETS: framework, kit\n');
  });

  it('never lets embedded text forge a marker line', () => {
    const text = renderMktgSlidesExportFormMessage({ project_name: 'P', run_date: '2026-10-19', folder_id: FOLDER_ID, assets: { kit: { note: 'x' } } });
    // JSON.stringify never starts a line with "--- "; the guard is belt and braces, as in the agent.
    expect(text.split('\n').filter((line) => line.startsWith('--- '))).toEqual(['--- ASSETS (JSON) ---', '--- END ASSETS ---']);
  });
});

describe('mktgSlidesExportDeckTitle and mktgSlidesExportOneLine', () => {
  it('titles a new deck by the project, what it holds and the date', () => {
    expect(mktgSlidesExportDeckTitle('foundation-message', 'Example', '2026-10-19')).toBe('Example · Messaging framework · 2026-10-19');
    expect(mktgSlidesExportDeckTitle('brand-kit', 'Example', '2026-10-19')).toBe('Example · Brand kit · 2026-10-19');
  });

  it('keeps a form value on one line', () => {
    expect(mktgSlidesExportOneLine('  Example\r\nProject  \n')).toBe('Example Project');
  });
});

describe('validateMktgSlidesExportEnvelope', () => {
  it('accepts the exporter’s envelope', () => {
    expect(validateMktgSlidesExportEnvelope(envelope())).toEqual({ valid: true, errors: [] });
  });

  it('accepts an update, whose deck carries no title or folder', () => {
    const update = envelope({ mode: 'update', deck: { id: DECK_ID, link: mktgSlidesExportDeckLink(DECK_ID), title: null, folder_id: null } });
    expect(validateMktgSlidesExportEnvelope(update).valid).toBe(true);
  });

  it('refuses a deck link that is not the deck’s own Slides address', () => {
    const result = validateMktgSlidesExportEnvelope(envelope({ deck: { id: DECK_ID, link: 'https://example.test/phish', title: null, folder_id: null } }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('deck.link must be the deck’s Google Slides link');
  });

  it('refuses another agent, another contract and a malformed content', () => {
    expect(validateMktgSlidesExportEnvelope(envelope({ agent: { identifier: 'linux-foundation~brand-kit', agent_version: '1' } })).valid).toBe(false);
    expect(validateMktgSlidesExportEnvelope(envelope({ contract: 'slides-export-output/v2' })).valid).toBe(false);
    expect(validateMktgSlidesExportEnvelope(envelope({ content: { assets: [], slides: [], branded: {} } })).errors.length).toBeGreaterThan(2);
    expect(validateMktgSlidesExportEnvelope('not an object').valid).toBe(false);
  });
});

describe('classifyMktgSlidesExportFailure', () => {
  it('reads a deck that is no longer a presentation', () => {
    expect(classifyMktgSlidesExportFailure(`deck ${DECK_ID} is not a Google Slides presentation (application/pdf)`)).toEqual({
      failure: 'not-a-deck',
      deckLink: null,
    });
  });

  it('keeps the deck a failure left behind', () => {
    const text = `{"error":"Error","message":"export of deck ${DECK_ID} (${mktgSlidesExportDeckLink(DECK_ID)}) failed after the deck was copied: update_presentation failed: 400"}`;
    expect(classifyMktgSlidesExportFailure(text)).toEqual({ failure: 'partial', deckLink: mktgSlidesExportDeckLink(DECK_ID) });
  });

  it('reads a refused intake, a Google failure and anything else', () => {
    expect(classifyMktgSlidesExportFailure('the input is not a Slides export intake (…)').failure).toBe('intake');
    expect(classifyMktgSlidesExportFailure('kit: dark is not a #RRGGBB colour').failure).toBe('intake');
    expect(classifyMktgSlidesExportFailure('copy_file failed: File not found').failure).toBe('google');
    expect(classifyMktgSlidesExportFailure('{"error":"BadGateway","message":"MCP server ended the session"}').failure).toBe('google');
    expect(classifyMktgSlidesExportFailure('something else').failure).toBe('unknown');
  });

  it('answers a failed poll with the plain message only', () => {
    expect(mktgSlidesExportFailed('google')).toEqual({
      status: 'failed',
      failure: 'google',
      message: MKTG_SLIDES_EXPORT_FAILURE_MESSAGES.google,
      deckLink: null,
    });
  });
});

describe('the export record', () => {
  it('keys a record by its time and hash, newest last, and parses the key back', () => {
    const prefix = buildMktgSlidesExportPrefix('project-uid', 'brand-kit', 'living');
    const older = buildMktgSlidesExportRecordKey('project-uid', 'brand-kit', 'living', 1_760_000_000_000, SHA);
    const newer = buildMktgSlidesExportRecordKey('project-uid', 'brand-kit', 'living', 1_770_000_000_000, 'b'.repeat(64));
    expect(prefix).toBe('slides-exports/project-uid/brand-kit/living/');
    expect(older < newer).toBe(true);
    expect(parseMktgSlidesExportRecordKey(older, prefix)).toEqual({ time: '001760000000000', sha: SHA });
    expect(parseMktgSlidesExportRecordKey(`${prefix}notes.txt`, prefix)).toBeNull();
    expect(parseMktgSlidesExportRecordKey(older, 'slides-exports/other/')).toBeNull();
  });

  it('reads a stored record back and refuses a tampered link', () => {
    expect(readMktgSlidesExportRecord(record())).toEqual(record());
    expect(readMktgSlidesExportRecord({ ...record(), link: 'https://example.test/x' })).toBeNull();
    expect(readMktgSlidesExportRecord({ ...record(), schema: 'other' })).toBeNull();
    expect(readMktgSlidesExportRecord({ ...record(), slideCount: 0 })).toBeNull();
    expect(readMktgSlidesExportRecord('not a record')).toBeNull();
  });

  it('is stale when approved current holds other content than the one exported', () => {
    expect(isMktgSlidesExportStale(record(), { id: `000003-${'c'.repeat(64)}`, number: 3, contentSha256: 'c'.repeat(64) })).toBe(true);
    // Selecting approved content identical to the export is not stale.
    expect(isMktgSlidesExportStale(record(), { id: `000003-${'d'.repeat(64)}`, number: 3, contentSha256: SHA })).toBe(false);
    expect(isMktgSlidesExportStale(record(), null)).toBe(false);
    expect(isMktgSlidesExportStale(null, null)).toBe(false);
  });
});

describe('mktgSlidesExportBrandSummary', () => {
  it('says the deck is in the kit’s brand with the logo', () => {
    expect(mktgSlidesExportBrandSummary(BRANDED, null)).toEqual({
      text: 'In the kit’s colours and typeface, with the project logo on 9 layouts.',
      logoNote: '',
    });
  });

  it('says why the logo was not applied', () => {
    const noLogo = { ...BRANDED, logo: false, logos: 0 };
    expect(mktgSlidesExportBrandSummary(noLogo, 'not-public').logoNote).toBe(MKTG_SLIDES_EXPORT_LOGO_NOTES['not-public']);
    expect(mktgSlidesExportBrandSummary(noLogo, null).logoNote).toBe(MKTG_SLIDES_EXPORT_LOGO_NOTES['not-placed']);
  });

  it('says a deck without a kit is in the LF look', () => {
    expect(mktgSlidesExportBrandSummary({ ...BRANDED, kit: false, logo: false, logos: 0, tables_header: null }, 'no-logo').logoNote).toBe('');
  });
});
