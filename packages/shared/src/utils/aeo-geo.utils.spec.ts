// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { buildAeoGeoFormPayload, normalizeAeoGeoDomain, renderAeoGeoFormText, validateAeoGeoIntakeAnswers } from './aeo-geo.utils';

describe('AEO/GEO intake and renderer', () => {
  it('normalizes domain and URL inputs exactly like the live agent', () => {
    expect(normalizeAeoGeoDomain(' HTTPS://WWW.Project.Example.:443/path?q=1 ')).toBe('www.project.example');
    expect(() => normalizeAeoGeoDomain('no hostname')).toThrow();
  });
  it('accepts blank or 2–5 distinct http(s) pages, and rejects malformed answers', () => {
    expect(validateAeoGeoIntakeAnswers({ domain: 'project.example' }).valid).toBe(true);
    expect(validateAeoGeoIntakeAnswers({ domain: 'project.example', key_pages: '\n' }).valid).toBe(true);
    for (const count of [2, 5]) {
      expect(
        validateAeoGeoIntakeAnswers({
          domain: 'project.example',
          key_pages: Array.from({ length: count }, (_, i) => `https://project.example/${i}`).join('\n'),
        }).valid
      ).toBe(true);
    }
    for (const answers of [
      null,
      [],
      { domain: 7 },
      { domain: 'localhost' },
      { domain: 'project.example', feedback: 'revise' },
      { domain: 'project.example', key_pages: 5 },
      { domain: 'project.example', key_pages: 'https://project.example/a' },
      { domain: 'project.example', key_pages: 'https://project.example/a\nhttps://project.example/a' },
      { domain: 'project.example', key_pages: 'ftp://project.example/a\nhttps://project.example/b' },
      { domain: 'project.example', key_pages: 'https://?\nhttps://[invalid' },
      { domain: 'project.example', key_pages: Array.from({ length: 6 }, (_, i) => `https://project.example/${i}`).join('\n') },
    ]) {
      expect(validateAeoGeoIntakeAnswers(answers).valid).toBe(false);
    }
  });
  it('renders optional project context exactly as the 2.0 LFX SCOPE block', () => {
    const answers = { domain: 'project.example', project_name: ' Synthetic Project ', project_uid: ' project-1 ' };
    expect(validateAeoGeoIntakeAnswers(answers).valid).toBe(true);
    const input = buildAeoGeoFormPayload(answers);
    expect(input.project_name).toBe('Synthetic Project');
    const text = renderAeoGeoFormText(input, new Date('2026-10-19T10:00:00Z'));
    expect(text).toContain('LFX SCOPE: {"project_name":"Synthetic Project","project_uid":"project-1"}\n\nKEY PAGES');
    expect(renderAeoGeoFormText({ type: 'aeo_geo_intake_form', domain: 'project.example', project_uid: 'project-1' })).toContain(
      'LFX SCOPE: {"project_name":null,"project_uid":"project-1"}'
    );
    for (const value of ['', 'x'.repeat(201), 4]) {
      expect(validateAeoGeoIntakeAnswers({ domain: 'project.example', project_name: value }).valid).toBe(false);
    }
  });
  it('preserves the provenance marker blocks the finalize tool parses', () => {
    const input = buildAeoGeoFormPayload({ domain: 'https://project.example/path', key_pages: 'https://project.example/about\nhttps://project.example/faq' });
    const rendered = renderAeoGeoFormText(input, new Date('2026-10-15T10:00:00Z'));
    expect(rendered).toContain('TARGET DOMAIN: project.example');
    expect(rendered).toContain(
      'KEY PAGES (Phase 2): the requester named these 2 pages. Audit exactly\nthese (plus the homepage) as your key pages; fetch other pages only when\na finding needs them, and list everything you fetched under Sources.\n- https://project.example/about\n- https://project.example/faq\n'
    );
    expect(rendered).toContain('line: 2026-10-15.');
    expect(rendered).not.toContain('FEEDBACK');
    expect(renderAeoGeoFormText(buildAeoGeoFormPayload({ domain: 'project.example' }))).toContain(
      'KEY PAGES (Phase 2): none provided — identify and fetch 2–5 key pages'
    );
  });
});
