// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { AEO_GEO_CATEGORIES, AEO_GEO_INTAKE_ERRORS, AEO_GEO_READER_CAVEATS, AEO_GEO_SECTIONS } from '../constants/aeo-geo.constants';
import type { AeoGeoEnvelope } from '../interfaces/aeo-geo.interface';
import {
  aeoGeoReaderCaveat,
  aeoGeoReaderCaveats,
  buildAeoGeoFormPayload,
  extractAeoGeoEnvelopeCandidates,
  isAeoGeoEnvelope,
  isAeoGeoKeyPageUrl,
  isAeoGeoReport,
  isPublicAeoGeoHost,
  normalizeAeoGeoDomain,
  renderAeoGeoFormText,
  validateAeoGeoIntakeAnswers,
} from './aeo-geo.utils';

import { aeoGeoEnvelopeFixture, aeoGeoReportFixture } from './aeo-geo.fixture';

function envelope(): AeoGeoEnvelope {
  return {
    contract: 'aeo-geo-output/v1',
    kind: 'aeo-geo-report',
    domain: 'project.example',
    report_filename: 'project.example AEO-GEO Report.md',
    version: 1,
    document_markdown: [
      '# AEO/GEO Analysis: project.example',
      'Overall score: **6.0 / 10** — A useful baseline.',
      AEO_GEO_SECTIONS[0],
      '| Category | Score | Summary |',
      '|---|---|---|',
      ...AEO_GEO_CATEGORIES.map(({ label }) => `| ${label} | 6/10 | Evidence from the audited source. |`),
      ...AEO_GEO_SECTIONS.slice(1).flatMap((heading) => [heading, 'Synthetic evidence and actionable recommendations for the site.']),
      'https://project.example/',
    ].join('\n'),
    content_sha256: 'a'.repeat(64),
    overall_score: 6,
    verdict: 'A useful baseline',
    scores: { ai_crawler_access: 6, llms_txt: 6, content_answerability: 6, technical_metadata: 6, external_authority: 6, content_depth_freshness: 6 },
    inputs: { key_pages_provided: false, pages_audited: ['https://project.example/'] },
    capabilities: { web_fetch: true, web_search: true },
    intake: { mode: 'form', completed_at: '2026-10-15T10:00:00Z' },
    generated_at: '2026-10-15T10:00:00Z',
    agent: { agent_version: '1.0.0', prompt_manifest_sha256: 'b'.repeat(64) },
  };
}

describe('AEO/GEO intake and renderer', () => {
  it.each(['https://project.example/about', 'http://reference.example.org/a?b=1', 'https://xn--bcher-kva.example/'])('accepts key-page URL %s', (url) => {
    expect(isAeoGeoKeyPageUrl(url)).toBe(true);
  });
  it.each([
    'http://10.0.0.1/a',
    'https://?',
    'https://[invalid',
    'http://0x7f000001/',
    'http://0x7f.0x0.0x0.0x1/a',
    'https://metadata.google.internal./',
    'ftp://project.example/a',
    '/about',
  ])('rejects key-page URL %s', (url) => {
    expect(isAeoGeoKeyPageUrl(url)).toBe(false);
  });
  it.each([
    '169.254.169.254',
    '10.0.0.10',
    '[::1]',
    'localhost',
    'metadata.google.internal',
    'intranet.local',
    'host.localhost',
    'host.lan',
    'host.home',
    'host.home.arpa',
    'host.corp',
    'host.intranet',
    'host.onion',
    'host.ip6.arpa',
    'host.in-addr.arpa',
    'site.123',
  ])('rejects non-public intake host %s', (domain) => {
    expect(isPublicAeoGeoHost(domain)).toBe(false);
    expect(() => normalizeAeoGeoDomain(domain)).toThrow();
    expect(validateAeoGeoIntakeAnswers({ domain }).valid).toBe(false);
  });
  it.each(['http://169.254.169.254/latest/meta-data/', 'http://0x7f000001/', 'http://2130706433/', 'http://[::1]/', 'https://metadata.google.internal./'])(
    'rejects non-public key page %s',
    (page) => {
      const result = validateAeoGeoIntakeAnswers({ domain: 'project.example.org', key_pages: `${page}\nhttps://project.example.org/about` });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(AEO_GEO_INTAKE_ERRORS.key_pages);
    }
  );
  it.each(['project.example', 'project.test', 'project.invalid', 'xn--bcher-kva.example'])(
    'preserves public or reserved fixture hostname %s and cross-domain key pages',
    (domain) => {
      expect(isPublicAeoGeoHost(domain)).toBe(true);
      expect(validateAeoGeoIntakeAnswers({ domain, key_pages: 'https://reference.example/a\nhttps://other.example/b' }).valid).toBe(true);
    }
  );
  it.each(['0x7f.0x0.0x0.0x1', '0177.0.0.1', '2130706433', '0x7f.0.0.1', '127.1', '[::1]'])('rejects canonicalized literal intake address %s', (domain) => {
    expect(() => normalizeAeoGeoDomain(domain)).toThrow(AEO_GEO_INTAKE_ERRORS.domain);
  });
  it('normalizes domain and URL inputs exactly like the live agent', () => {
    expect(normalizeAeoGeoDomain('https://www.Example.org:443/path')).toBe('www.example.org');
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

describe('AEO/GEO envelope gates', () => {
  it.each(['project', 'domain'] as const)('accepts the full recorded %s 2.0 report with its original metrics and section counts', (kind) => {
    const recorded = aeoGeoEnvelopeFixture(kind);
    expect(isAeoGeoEnvelope(recorded)).toBe(true);
    const report = recorded.report;
    if (!report) {
      throw new Error('Recorded report fixture is missing.');
    }
    expect(report.findings).toHaveLength(5);
    expect(report.recommendations).toHaveLength(kind === 'project' ? 7 : 6);
    expect(report.caveats).toHaveLength(kind === 'project' ? 9 : 7);
    expect(report.sources).toHaveLength(kind === 'project' ? 11 : 15);
  });
  it('mirrors report min(1) strings and regex URL gates', () => {
    const report = aeoGeoReportFixture();
    report.headline = ' ';
    report.verdict = ' ';
    report.scorecard.forEach((row) => {
      row.summary = ' ';
    });
    report.findings.forEach((row) => {
      row.title = ' ';
      row.detail = ' ';
      row.evidence = [' '];
    });
    report.recommendations.forEach((row) => {
      row.title = ' ';
      row.detail = ' ';
    });
    report.caveats = [' '];
    report.sources.push({ url: 'https://fixture-user@reference.example/source', role: 'external' });
    expect(isAeoGeoReport(report)).toBe(true);
    expect(isAeoGeoReport({ ...report, headline: '' })).toBe(false);
  });

  it('accepts legacy envelopes and validates every typed-report equality and required section', () => {
    const legacy = envelope();
    expect(isAeoGeoEnvelope(legacy)).toBe(true);
    expect(isAeoGeoEnvelope({ ...legacy, document_markdown: legacy.document_markdown.replace(/^(Overall score:.*)$/m, '$1\t ') })).toBe(true);
    const report = aeoGeoReportFixture(legacy, legacy.inputs.pages_audited);
    expect(isAeoGeoReport({ ...report, future: true })).toBe(true);
    expect(isAeoGeoEnvelope({ ...legacy, report })).toBe(true);
    for (const invalid of [
      { ...report, overall_score: 7 },
      { ...report, verdict: 'Different verdict' },
      { ...report, scorecard: [...report.scorecard].reverse() },
      { ...report, scorecard: report.scorecard.map((row) => ({ ...row, score: 6.5 })) },
      { ...report, findings: [] },
      { ...report, sources: [] },
      { ...report, recommendations: [{ ...report.recommendations[0], priority: 0 }] },
      { ...report, recommendations: [{ ...report.recommendations[0], priority: 2 }] },
      { ...report, sources: report.sources.map((source) => ({ ...source, role: 'search' })) },
      { ...report, sources: [{ url: 'javascript:alert(1)', role: 'audited' }] },
    ]) {
      expect(isAeoGeoEnvelope({ ...legacy, report: invalid })).toBe(false);
    }
    expect(isAeoGeoReport({ ...report, caveats: null })).toBe(false);
  });
  it('accepts the full contract and extracts finalize tool result wrappers', () => {
    const valid = envelope();
    expect(isAeoGeoEnvelope(valid)).toBe(true);
    expect(extractAeoGeoEnvelopeCandidates(JSON.stringify({ result: { envelope_json: JSON.stringify(valid) } }))).toEqual([valid]);
  });
  it('ignores a hostile 50k-space row in an otherwise valid report', () => {
    const report = envelope();
    report.document_markdown += '\n|' + ' '.repeat(50_000) + 'x';
    expect(isAeoGeoEnvelope(report)).toBe(true);
  });
  it.each([
    { length: 16, valid: true },
    { length: 17, valid: false },
  ])('only matches score cells up to 16 characters (length $length)', ({ length, valid }) => {
    const report = envelope();
    const scoreCell = `6${' '.repeat(length - 4)}/10`;
    report.document_markdown = report.document_markdown.replace('| llms.txt | 6/10 |', `| llms.txt | ${scoreCell} |`);
    expect(isAeoGeoEnvelope(report)).toBe(valid);
  });
  it('accepts extra N/10 rows outside the Scorecard, matching the upstream G1 gate', () => {
    const report = envelope();
    report.document_markdown = report.document_markdown.replace(
      '## Recommendations (priority order)',
      '## Recommendations (priority order)\n\n| Next audit target | 8/10 | A separate recommendation metric. |'
    );
    expect(isAeoGeoEnvelope(report)).toBe(true);
  });
  it('still rejects missing, reordered or mismatched category rows among extra scores', () => {
    for (const change of [
      (doc: string) => doc.replace('| llms.txt |', '| Other metric |'),
      (doc: string) =>
        doc
          .replace('| AI crawler access |', '| Temporary label |')
          .replace('| llms.txt |', '| AI crawler access |')
          .replace('| Temporary label |', '| llms.txt |'),
      (doc: string) => doc.replace('| llms.txt | 6/10', '| llms.txt | 5/10'),
    ]) {
      const report = envelope();
      report.document_markdown = change(report.document_markdown) + '\n| Unrelated metric | 9/10 | Extra evidence. |';
      expect(isAeoGeoEnvelope(report)).toBe(false);
    }
  });
  it('rejects schema drift, score/headline disagreement, missing sources and structural drift', () => {
    for (const mutate of [
      (e: AeoGeoEnvelope) => {
        e.scores.llms_txt = 11;
      },
      (e: AeoGeoEnvelope) => {
        e.overall_score = 9;
      },
      (e: AeoGeoEnvelope) => {
        e.report_filename = 'other.md';
      },
      (e: AeoGeoEnvelope) => {
        e.verdict = 'Invented verdict';
      },
      (e: AeoGeoEnvelope) => {
        e.inputs.key_pages_provided = true;
      },
      (e: AeoGeoEnvelope) => {
        e.inputs.pages_audited.push('https://project.example/missing');
      },
      (e: AeoGeoEnvelope) => {
        e.inputs.pages_audited.push(e.inputs.pages_audited[0]);
      },
      (e: AeoGeoEnvelope) => {
        e.document_markdown = e.document_markdown.replace('## Scorecard', '## Missing');
      },
      (e: AeoGeoEnvelope) => {
        e.document_markdown = e.document_markdown.replace('| llms.txt | 6/10', '| llms.txt | 8/10');
      },
      (e: AeoGeoEnvelope) => {
        e.agent.prompt_manifest_sha256 = 'bad';
      },
      (e: AeoGeoEnvelope) => {
        e.generated_at = 'yesterday';
      },
    ]) {
      const candidate = envelope();
      mutate(candidate);
      expect(isAeoGeoEnvelope(candidate)).toBe(false);
    }
    expect(isAeoGeoEnvelope({ ...envelope(), extra: true })).toBe(false);
    expect(isAeoGeoEnvelope({ ...envelope(), inputs: { ...envelope().inputs, extra: true } })).toBe(false);
  });

  it('accepts the Plan-2 quality ledger as an opaque top-level field while still rejecting other unknown keys', () => {
    // aeo-geo ≥ 2.1.0 writes `quality` (its shape is the agent's; LFX One stores it and never reads it).
    const quality = { reads: [{ key: 'home', kind: 'page', required: true, outcome: 'complete', pages_read: 1, bytes: 51234, truncated: false }] };
    expect(isAeoGeoEnvelope({ ...envelope(), quality })).toBe(true);
    expect(isAeoGeoEnvelope({ ...envelope(), quality: null })).toBe(true);
    expect(isAeoGeoEnvelope({ ...envelope(), quality, extra: true })).toBe(false);
    // The ledger changes nothing the report view reads: the named fields are the same with and without it.
    const { quality: ignored, ...named } = { ...envelope(), quality };
    expect(ignored).toBe(quality);
    expect(named).toEqual(envelope());
  });
});

describe('AEO/GEO reader caveats', () => {
  // The shapes the live agent wrote for a project with an LFX scope, with example identifiers; the report prints none of them.
  it('maps a failed third-party search to one reader sentence and keeps the audit sentences after it', () => {
    const caveat =
      "Web search (Example Search Service) returned 'You have exceeded your credits limit' for both planned queries ('Example Foundation open standards' and 'what is the Example Foundation'). " +
      'No independent third-party coverage, rankings or search summaries were verified. The External authority score of 5 is a conservative placeholder based only on on-site evidence. It is not a measurement.';
    const mapped =
      `${AEO_GEO_READER_CAVEATS.search_unavailable} No independent third-party coverage, rankings or search summaries were verified. ` +
      'The External authority score of 5 is a conservative placeholder based only on on-site evidence. It is not a measurement.';
    expect(aeoGeoReaderCaveat(caveat)).toBe(mapped);
    // The same shape with curly quotes, with another verb, with a backtick span, and without a quote at all.
    expect(aeoGeoReaderCaveat(caveat.replace("'You have exceeded your credits limit'", '\u2018You have exceeded your credits limit\u2019'))).toBe(mapped);
    expect(aeoGeoReaderCaveat("Web search failed with 'You have exceeded your credits limit'. No coverage was verified.")).toBe(
      `${AEO_GEO_READER_CAVEATS.search_unavailable} No coverage was verified.`
    );
    expect(aeoGeoReaderCaveat('Web search failed: You have exceeded your credits limit. No coverage was verified.')).toBe(
      `${AEO_GEO_READER_CAVEATS.search_unavailable} No coverage was verified.`
    );
    expect(aeoGeoReaderCaveat('The search returned `credits limit reached` for every query.')).toBe(AEO_GEO_READER_CAVEATS.search_unavailable);
    // An abbreviation's period is not a boundary, so the whole search sentence maps and the next one stays.
    expect(
      aeoGeoReaderCaveat("Third-party searches (e.g. Example Search Service) returned 'You have exceeded your credits limit'. No coverage was verified.")
    ).toBe(`${AEO_GEO_READER_CAVEATS.search_unavailable} No coverage was verified.`);
    // A search that worked is audit content, quoted result or not.
    expect(aeoGeoReaderCaveat('A name search returned "Example Foundation" as the top result.')).toBe(
      'A name search returned "Example Foundation" as the top result.'
    );
    expect(aeoGeoReaderCaveat('The search returned three results for the project name.')).toBe('The search returned three results for the project name.');
    // A failure word inside the quoted title is audit content; outside the quotes it is the provider's failure.
    expect(aeoGeoReaderCaveat('The search returned "Error handling guide" as its top result.')).toBe(
      'The search returned "Error handling guide" as its top result.'
    );
    expect(aeoGeoReaderCaveat("Search failed with 'Unauthorized'.")).toBe(AEO_GEO_READER_CAVEATS.search_unavailable);
  });

  it('decides by the subject: a provider quoting its message maps, a result title and the audited site pass verbatim', () => {
    // The provider is the subject and the quoted text is its message: a failure word anywhere is the evidence.
    expect(aeoGeoReaderCaveat("Web search returned 'Service unavailable'.")).toBe(AEO_GEO_READER_CAVEATS.search_unavailable);
    expect(aeoGeoReaderCaveat('The search provider responded with "503 Service Unavailable" for every query. Coverage was not verified.')).toBe(
      `${AEO_GEO_READER_CAVEATS.search_unavailable} Coverage was not verified.`
    );
    expect(aeoGeoReaderCaveat("The API responded 'Service unavailable'. Metrics were not read.")).toBe('Metrics were not read.');
    // A quoted result title is never a failure, whatever its words.
    expect(aeoGeoReaderCaveat('Search returned "Rate-limited API guide" as its first result.')).toBe(
      'Search returned "Rate-limited API guide" as its first result.'
    );
    expect(aeoGeoReaderCaveat('The search returned "Quota exceeded: what it means" as the top result.')).toBe(
      'The search returned "Quota exceeded: what it means" as the top result.'
    );
    // The audited site is the subject: its statuses and rate limiting are audit evidence.
    expect(aeoGeoReaderCaveat('The homepage rate-limited the crawler with HTTP 429.')).toBe('The homepage rate-limited the crawler with HTTP 429.');
    expect(aeoGeoReaderCaveat("The homepage returned 'Service unavailable' on the second fetch.")).toBe(
      "The homepage returned 'Service unavailable' on the second fetch."
    );
    expect(aeoGeoReaderCaveat('The rate limit was reached on the third fetch of the sitemap.')).toBe(
      'The rate limit was reached on the third fetch of the sitemap.'
    );
  });

  it('needs evidence of failure beside the provider subject: a quoted successful result passes, a quoted failure maps', () => {
    // The quoted text is what the search returned, and it is a result, not a failure, in any phrasing.
    expect(aeoGeoReaderCaveat('The search returned "Example Foundation" for both queries.')).toBe('The search returned "Example Foundation" for both queries.');
    expect(aeoGeoReaderCaveat('Web search for "aaif" returned "Agentic AI Foundation" first.')).toBe(
      'Web search for "aaif" returned "Agentic AI Foundation" first.'
    );
    // A failure word inside or outside the quotes, or an HTTP status outside them, is the evidence; a number inside the quotes is never read.
    expect(aeoGeoReaderCaveat('The search provider responded with "503 Service Unavailable" for every query.')).toBe(AEO_GEO_READER_CAVEATS.search_unavailable);
    expect(aeoGeoReaderCaveat('The search provider responded with "502 Bad Gateway" for every query.')).toBe(
      'The search provider responded with "502 Bad Gateway" for every query.'
    );
    expect(aeoGeoReaderCaveat("Search failed with 'Unauthorized'.")).toBe(AEO_GEO_READER_CAVEATS.search_unavailable);
    expect(aeoGeoReaderCaveat("Web search returned 'Service unavailable'.")).toBe(AEO_GEO_READER_CAVEATS.search_unavailable);
    expect(aeoGeoReaderCaveat('The search returned "nothing useful" with HTTP 500 for both queries.')).toBe(AEO_GEO_READER_CAVEATS.search_unavailable);
    // A bare number outside the quotes is not a status.
    expect(aeoGeoReaderCaveat('The search returned "Example Foundation" within the first 100 results.')).toBe(
      'The search returned "Example Foundation" within the first 100 results.'
    );
    // Only an error status is evidence: a successful status beside a quoted result, or a number inside a quoted title, is not.
    expect(aeoGeoReaderCaveat('The search returned "Example Foundation" with HTTP 200.')).toBe('The search returned "Example Foundation" with HTTP 200.');
    expect(aeoGeoReaderCaveat('The search returned "Top 100 open source foundations" for the project name.')).toBe(
      'The search returned "Top 100 open source foundations" for the project name.'
    );
    // Inside the quotes a number is never read, wherever it stands: a title that opens with one, carries one after an apostrophe or
    // in a nested quotation, or a quoted status line without a failure word, is audit content.
    expect(aeoGeoReaderCaveat('The search returned "Fortune 500 open source companies" for the project name.')).toBe(
      'The search returned "Fortune 500 open source companies" for the project name.'
    );
    expect(aeoGeoReaderCaveat('The search returned "Top 400 projects" for the project name.')).toBe(
      'The search returned "Top 400 projects" for the project name.'
    );
    for (const title of [
      '500 Startups',
      '404 Media',
      '503 Club',
      "Women's 500 fastest-growing companies",
      "O'Reilly 404 page design",
      "Don't miss the 503 Club",
      "Investors' 500",
      "Founders' 404 Not Found stories",
      "500's best",
      "Rock 'n' 500",
      "Top 'Bad' 404",
      "A guide to '404' pages",
    ]) {
      expect(aeoGeoReaderCaveat(`The search returned "${title}" for the project name.`)).toBe(`The search returned "${title}" for the project name.`);
    }
    expect(aeoGeoReaderCaveat('The search returned "O\'Reilly" and "404 page design" for the project name.')).toBe(
      'The search returned "O\'Reilly" and "404 page design" for the project name.'
    );
    // A failure word in a second span still counts; a status line in it, without one, does not.
    expect(aeoGeoReaderCaveat('The search returned "Example Foundation" and then "503 Service Unavailable".')).toBe(AEO_GEO_READER_CAVEATS.search_unavailable);
    expect(aeoGeoReaderCaveat('The search returned "Example Foundation" and then "502 Bad Gateway".')).toBe(
      'The search returned "Example Foundation" and then "502 Bad Gateway".'
    );
    expect(aeoGeoReaderCaveat('The search provider responded with "404 Not Found".')).toBe('The search provider responded with "404 Not Found".');
    expect(aeoGeoReaderCaveat('The search returned "429 Too Many Requests".')).toBe('The search returned "429 Too Many Requests".');
    expect(aeoGeoReaderCaveat("Web search returned '404 not found'.")).toBe("Web search returned '404 not found'.");
    expect(aeoGeoReaderCaveat('Web search returned \u201c503 Service Unavailable\u201d.')).toBe(AEO_GEO_READER_CAVEATS.search_unavailable);
    // "failed" is not a failure word, and the quoted number is never read: a quoted status in a sentence is a quotation.
    expect(aeoGeoReaderCaveat('Web search failed with "404".')).toBe('Web search failed with "404".');
    expect(aeoGeoReaderCaveat('Web search returned `404` for both queries.')).toBe('Web search returned `404` for both queries.');
    expect(aeoGeoReaderCaveat('Web search returned "status 404" for both queries.')).toBe('Web search returned "status 404" for both queries.');
    // Outside the quotes a status may carry "code" and a colon.
    expect(aeoGeoReaderCaveat('The search returned "Not found" with status: 404.')).toBe(AEO_GEO_READER_CAVEATS.search_unavailable);
    expect(aeoGeoReaderCaveat('The search returned "Not found" with status code 404.')).toBe(AEO_GEO_READER_CAVEATS.search_unavailable);
    // A quoted status line, with or without an HTTP version, is a quotation; the same status outside the quotes is a failure.
    expect(aeoGeoReaderCaveat('The search provider responded with "HTTP/1.1 404 Not Found".')).toBe(
      'The search provider responded with "HTTP/1.1 404 Not Found".'
    );
    expect(aeoGeoReaderCaveat('The search returned "HTTP/2 429 Too Many Requests".')).toBe('The search returned "HTTP/2 429 Too Many Requests".');
    expect(aeoGeoReaderCaveat('The search returned "Example Foundation" with HTTP/1.1 503.')).toBe(AEO_GEO_READER_CAVEATS.search_unavailable);
    expect(aeoGeoReaderCaveat('The search returned "HTTP/2 200 OK" for the project name.')).toBe('The search returned "HTTP/2 200 OK" for the project name.');
    // A caveat that is nothing but a status line is a provider failure on its own, with no subject: the number alone, with an HTTP
    // prefix, or with a recognised reason phrase. Prose after the number is a sentence, and a sentence around a status is not a line.
    for (const line of ['HTTP/1.1 404 Not Found', '404 Not Found', '502 Bad Gateway', '503', 'HTTP 503', 'HTTP 503 Service Unavailable.']) {
      expect(aeoGeoReaderCaveat(line)).toBe(AEO_GEO_READER_CAVEATS.search_unavailable);
    }
    for (const line of ['HTTP 200 OK', '500 pages were not inspected.', '404 pages returned errors.', '500 Startups', 'The homepage returned 404 Not Found.']) {
      expect(aeoGeoReaderCaveat(line)).toBe(line);
    }
  });

  it('never splits a sentence inside its quotes, so a quoted title stays whole and a multi-sentence provider error maps as one', () => {
    for (const caveat of [
      'Search returned "What is AEO?" as its first result.',
      'Search returned "Really? Yes!" as its top result.',
      'The search returned "v2.0 release notes" as its top result.',
      'Search returned "Is the API unavailable?" as its first result.',
      'The search returned "No results. Try a broader query." for the project name. Coverage was not verified.',
    ]) {
      expect(aeoGeoReaderCaveat(caveat)).toBe(caveat);
    }
    // The provider's whole message maps with the sentence that quotes it; none of its later sentences leaks.
    expect(aeoGeoReaderCaveat('Web search returned "Quota exceeded. Try again later." for both queries.')).toBe(AEO_GEO_READER_CAVEATS.search_unavailable);
    expect(aeoGeoReaderCaveat("Web search returned 'Quota exceeded. Try again later.' for both queries. No coverage was verified.")).toBe(
      `${AEO_GEO_READER_CAVEATS.search_unavailable} No coverage was verified.`
    );
    // A quotation that closes a sentence is still a boundary when the next sentence starts in uppercase, or with a file
    // name or a property: the audit sentence after a quoted failure is kept, never glued into the failure.
    expect(aeoGeoReaderCaveat('The page says "Welcome." The project_uid was not read.')).toBe('The page says "Welcome."');
    expect(aeoGeoReaderCaveat('Web search returned "Quota exceeded." robots.txt allows all crawlers.')).toBe(
      `${AEO_GEO_READER_CAVEATS.search_unavailable} robots.txt allows all crawlers.`
    );
    expect(aeoGeoReaderCaveat('Web search failed with "Rate limit reached?" llms.txt was fetched in full.')).toBe(
      `${AEO_GEO_READER_CAVEATS.search_unavailable} llms.txt was fetched in full.`
    );
    // A hyphenated file name is a file name too: it opens its own sentence, while a hyphenated lowercase word still continues.
    expect(aeoGeoReaderCaveat('Web search returned "Quota exceeded." llms-full.txt was fetched in full.')).toBe(
      `${AEO_GEO_READER_CAVEATS.search_unavailable} llms-full.txt was fetched in full.`
    );
    expect(aeoGeoReaderCaveat('Search returned "What is AEO?" well-known explainer as its first result.')).toBe(
      'Search returned "What is AEO?" well-known explainer as its first result.'
    );
    expect(aeoGeoReaderCaveat('Web search returned "Quota exceeded." sitemap.xml lists 40 URLs. og:site_name is set.')).toBe(
      `${AEO_GEO_READER_CAVEATS.search_unavailable} sitemap.xml lists 40 URLs. og:site_name is set.`
    );
    // A page's quoted text followed by a file name: both sentences stay, untouched.
    expect(aeoGeoReaderCaveat('The title said "Welcome." robots.txt allows all crawlers.')).toBe('The title said "Welcome." robots.txt allows all crawlers.');
    // An unbalanced straight quote or backtick (an inch mark, a truncated quote) opens no span: it never pairs with the next quote,
    // so the sentences between them stay separate and only the plumbing one is dropped.
    expect(aeoGeoReaderCaveat('The 5" banner. The project_uid was not read. The page is fine "ok".')).toBe('The 5" banner. The page is fine "ok".');
    expect(aeoGeoReaderCaveat('A stray ` mark. The project_uid was not read. The span `og:title` is set.')).toBe('A stray ` mark. The span `og:title` is set.');
  });

  it('names no field, slug, uid or access error for an LFX record that could not be read, and keeps the clean sentences', () => {
    const caveat =
      "The LFX record could not be read by the form's project_uid (access error). " +
      'A name search returned an entitled record (slug example-project, formation date 2025-01-01, website https://project.example, parent Example Foundation). ' +
      'It was used only to confirm identity, not as evidence of crawlability or authority. No LFX metrics were queried.';
    expect(aeoGeoReaderCaveat(caveat)).toBe(
      `${AEO_GEO_READER_CAVEATS.lfx_record_unread} A name search returned a matching record. ` +
        'It was used only to confirm identity, not as evidence of crawlability or authority. No LFX metrics were queried.'
    );
    // "entitled" is entitlement vocabulary: the reader says "matching", with the article and the case kept; the phrase alone changes.
    expect(aeoGeoReaderCaveat('A name search returned an entitled record (slug example-project), used only to confirm identity.')).toBe(
      'A name search returned a matching record, used only to confirm identity.'
    );
    expect(aeoGeoReaderCaveat('A name search returned an entitled record.')).toBe('A name search returned a matching record.');
    expect(aeoGeoReaderCaveat('An entitled record was found. Entitled record details were not read.')).toBe(
      'A matching record was found. Matching record details were not read.'
    );
    expect(aeoGeoReaderCaveat('A name search returned two entitled records.')).toBe('A name search returned two matching records.');
    expect(aeoGeoReaderCaveat('The record was read by name.')).toBe('The record was read by name.');
    expect(aeoGeoReaderCaveat('The explainer is entitled "Record keeping" and dates from 2025.')).toBe(
      'The explainer is entitled "Record keeping" and dates from 2025.'
    );
    // A following sentence that starts in lowercase is its own sentence and stays.
    expect(aeoGeoReaderCaveat("The LFX record could not be read by the form's project_uid (access error). robots.txt allows all crawlers.")).toBe(
      `${AEO_GEO_READER_CAVEATS.lfx_record_unread} robots.txt allows all crawlers.`
    );
  });

  it('drops a sentence that still carries plumbing and falls back to one sentence when nothing is left', () => {
    expect(aeoGeoReaderCaveat('The lookup for id 7f3a9c21 failed. Metrics were not read.')).toBe('Metrics were not read.');
    expect(aeoGeoReaderCaveat('The lookup failed: You have exceeded your credits limit. Metrics were not read.')).toBe('Metrics were not read.');
    expect(aeoGeoReaderCaveat('Record 3f2504e0-4f89-11d3-9a0c-0305e82c3301 was unavailable.')).toBe(AEO_GEO_READER_CAVEATS.inputs_unavailable);
    expect(aeoGeoReaderCaveat("The provider said 'quota exhausted' for the lookup.")).toBe(AEO_GEO_READER_CAVEATS.inputs_unavailable);
    expect(aeoGeoReaderCaveat("The provider failed with 'Service unavailable' for the lookup.")).toBe(AEO_GEO_READER_CAVEATS.inputs_unavailable);
    expect(aeoGeoReaderCaveat("The provider returned 'quota exceeded' after three retries.")).toBe(AEO_GEO_READER_CAVEATS.inputs_unavailable);
    expect(aeoGeoReaderCaveat('failed: You have exceeded your credits limit.')).toBe(AEO_GEO_READER_CAVEATS.inputs_unavailable);
    // A caveat that is only a plumbing parenthetical is never an empty bullet; a plumbing parenthetical inside a sentence is just removed.
    expect(aeoGeoReaderCaveat('(project_uid unavailable)')).toBe(AEO_GEO_READER_CAVEATS.inputs_unavailable);
    expect(aeoGeoReaderCaveat('(slug example-project).')).toBe(AEO_GEO_READER_CAVEATS.inputs_unavailable);
    expect(aeoGeoReaderCaveat('Metrics (project_uid) were not read.')).toBe('Metrics were not read.');
    expect(aeoGeoReaderCaveat('The project_name lookup was skipped.')).toBe(AEO_GEO_READER_CAVEATS.inputs_unavailable);
    // An id with a value is an identifier shape whatever its registry: the sentence is left out (named residual).
    expect(aeoGeoReaderCaveat('The organization has Wikidata ID Q12345. The entity is otherwise well described.')).toBe(
      'The entity is otherwise well described.'
    );
    expect(aeoGeoReaderCaveat('   ')).toBe(AEO_GEO_READER_CAVEATS.inputs_unavailable);
  });

  it('passes audit content through unchanged: statuses, abbreviations, URLs, file names, properties, markup and quoted page text', () => {
    for (const caveat of [
      'A direct fetch of the Wikipedia article returned HTTP 403 (bot policy), so it was not audited.',
      'The homepage returned HTTP 200 but llms.txt returned HTTP 404.',
      'The homepage returned "403 Forbidden".',
      'The website enforces a rate limit on crawlers.',
      'Pages fetched were truncated at 20–60 KB, so lower-page content (e.g. the full About body and Projects grid) was not fully inspected. llms.txt and sitemap.xml were also truncated at 30 KB.',
      '/md/about returns `x-robots-tag: noindex`. This seems intended, to avoid duplicating the HTML pages, and is not counted as a problem.',
      'The homepage at https://project.example/ declares ai-train=yes. Both key pages declare index, follow.',
      'The sitemap lists sitemap_index.xml and /about_us. The og:site_name tag is set, and `page_title` is read from the code span.',
      'The URL slug is descriptive. The FAQ block carries id="faq-1". The title said "Welcome".',
      'The  site   keeps double  spaces here.',
      ...(aeoGeoEnvelopeFixture('project').report?.caveats ?? []),
      ...(aeoGeoEnvelopeFixture('domain').report?.caveats ?? []),
    ]) {
      expect(aeoGeoReaderCaveat(caveat)).toBe(caveat);
    }
  });

  // The editor's fixtures 1–3 (synthetic domains), byte for byte: quoted titles, site responses and the site's own rate limiting pass through,
  // a provider's quoted message maps, emptied caveats fall back to one sentence printed once, zero caveats stay zero.
  it.each([
    [
      'fixture1-quoted-titles',
      [
        'The search returned "Why builds fail without open standards" as its top result.',
        'The best-ranked explainer is titled "Search errors explained" and dates from 2025.',
        'The homepage returned "403 Forbidden" to our second fetch, so its metadata is unverified.',
        'The website enforces a rate limit on crawlers; two fetches were slowed, none refused.',
        'The homepage rate-limited the crawler with HTTP 429.',
        'Search returned "Rate-limited API guide" as its first result.',
        "Web search returned 'Service unavailable'.",
      ],
      [
        'The search returned "Why builds fail without open standards" as its top result.',
        'The best-ranked explainer is titled "Search errors explained" and dates from 2025.',
        'The homepage returned "403 Forbidden" to our second fetch, so its metadata is unverified.',
        'The website enforces a rate limit on crawlers; two fetches were slowed, none refused.',
        'The homepage rate-limited the crawler with HTTP 429.',
        'Search returned "Rate-limited API guide" as its first result.',
        'Third-party search was not available for this run.',
      ],
    ],
    [
      'fixture2-emptied',
      [
        '(project_uid unavailable)',
        'Record 3f2504e0-4f89-11d3-9a0c-0305e82c3301 was unavailable.',
        'Metrics (project_uid) were not read. robots.txt allows all crawlers.',
        'No live AI-engine tests were run.',
      ],
      [
        "Some of the audit's inputs were unavailable for this run.",
        'Metrics were not read. robots.txt allows all crawlers.',
        'No live AI-engine tests were run.',
      ],
    ],
  ])('maps the editor fixture %s exactly', (_name, caveats, expected) => {
    expect(aeoGeoReaderCaveats(caveats)).toEqual(expected);
  });

  // The stop rule, shape by shape: a number is never read inside quotes; a bare status line maps; a fixed sentence is dropped
  // only beside a caveat that starts with it. Each row is a report's caveats and the reader's list.
  it.each<[string, string[], string[]]>([
    [
      'HTTP forms: a quoted status line is a quotation, a bare one is a failure, a successful one is content',
      ['The search provider responded with "HTTP/1.1 404 Not Found".', 'HTTP/1.1 404 Not Found', 'The search returned "HTTP/2 200 OK" for the project name.'],
      [
        'The search provider responded with "HTTP/1.1 404 Not Found".',
        AEO_GEO_READER_CAVEATS.search_unavailable,
        'The search returned "HTTP/2 200 OK" for the project name.',
      ],
    ],
    ['a bare "404" in a sentence: a quoted status, verbatim; "failed" is not a failure word', ['Search failed with "404".'], ['Search failed with "404".']],
    [
      'a leading number with a reason phrase: quoted it is a quotation, bare it is a failure',
      ['Web search returned "502 Bad Gateway" for both queries.', '502 Bad Gateway'],
      ['Web search returned "502 Bad Gateway" for both queries.', AEO_GEO_READER_CAVEATS.search_unavailable],
    ],
    [
      'a title that opens with a 4xx/5xx number',
      ['500 Startups', '404 Media', '503 Club'].map((title) => `The search returned "${title}" for the project name.`),
      ['500 Startups', '404 Media', '503 Club'].map((title) => `The search returned "${title}" for the project name.`),
    ],
    [
      'a title with an apostrophe beside the number',
      ["Investors' 500", "500's best", "Rock 'n' 500"].map((title) => `The search returned "${title}" for the project name.`),
      ["Investors' 500", "500's best", "Rock 'n' 500"].map((title) => `The search returned "${title}" for the project name.`),
    ],
    [
      'a title with a nested quotation around the number',
      ['The search returned "A guide to \'404\' pages" for the project name.'],
      ['The search returned "A guide to \'404\' pages" for the project name.'],
    ],
    [
      'the genuine fallback kept beside a caveat quoting it in single quotes, apostrophe inside',
      [`One caveat quoted '${AEO_GEO_READER_CAVEATS.inputs_unavailable}' as an example.`, '(project_uid unavailable)'],
      [`One caveat quoted '${AEO_GEO_READER_CAVEATS.inputs_unavailable}' as an example.`, AEO_GEO_READER_CAVEATS.inputs_unavailable],
    ],
    [
      'the genuine fallback kept beside a caveat quoting it in double quotes',
      [`One caveat quoted "${AEO_GEO_READER_CAVEATS.search_unavailable}" as an example.`, "Web search returned 'Service unavailable'."],
      [`One caveat quoted "${AEO_GEO_READER_CAVEATS.search_unavailable}" as an example.`, AEO_GEO_READER_CAVEATS.search_unavailable],
    ],
    [
      'the duplicate fallback dropped beside a composite that starts with it',
      [`${AEO_GEO_READER_CAVEATS.search_unavailable} llms-full.txt was fetched in full.`, "Web search returned 'Service unavailable'."],
      [`${AEO_GEO_READER_CAVEATS.search_unavailable} llms-full.txt was fetched in full.`],
    ],
    [
      'plumbing: a field and a UUID, a slug, a credits limit',
      [
        "The LFX record could not be read by the form's project_uid 3f2504e0-4f89-11d3-9a0c-0305e82c3301 (access error).",
        'A name search returned an entitled record (slug example-project).',
        "Web search (Example Search Service) returned 'You have exceeded your credits limit' for both planned queries.",
      ],
      [AEO_GEO_READER_CAVEATS.lfx_record_unread, 'A name search returned a matching record.', AEO_GEO_READER_CAVEATS.search_unavailable],
    ],
    [
      'a status outside the quotes: an error maps, a success is content',
      ['The search returned "Not found" with status code 404.', 'The search returned "Example Foundation" with HTTP 200.'],
      [AEO_GEO_READER_CAVEATS.search_unavailable, 'The search returned "Example Foundation" with HTTP 200.'],
    ],
    [
      'a bare status line: the number, an HTTP prefix or a recognised reason phrase; prose after the number is a sentence',
      ['500 pages were not inspected.', 'HTTP 503', '404 pages returned errors.'],
      ['500 pages were not inspected.', AEO_GEO_READER_CAVEATS.search_unavailable, '404 pages returned errors.'],
    ],
    [
      'an apostrophe inside a single-quoted title keeps the title inside the quotes, straight or curly',
      [
        "The search returned 'An auditor's guide to HTTP/1.1 404' for the project name.",
        'The search returned \u2018An auditor\u2019s guide to HTTP/1.1 404\u2019 for the project name.',
      ],
      [
        "The search returned 'An auditor's guide to HTTP/1.1 404' for the project name.",
        'The search returned \u2018An auditor\u2019s guide to HTTP/1.1 404\u2019 for the project name.',
      ],
    ],
    [
      'a raw provider blob, quoted or not: a JSON brace pair, a long hex id or a requestId is plumbing; a short hex colour is not',
      [
        'API error "429 Too Many Requests" {"requestId":"9f3c2a7b1d4e5f60718293a4b5c6d7e8"}.',
        'The provider answered with request_id 9f3c2a7b1d4e5f60718293a4b5c6d7e8.',
        'Trace 9f3c2a7b1d4e5f60718293a4b5c6d7e8 was logged.',
        'The brand colour is #1a2b3c.',
        'The health check returned {"ok":true} as expected.',
      ],
      [AEO_GEO_READER_CAVEATS.inputs_unavailable, 'The brand colour is #1a2b3c.'],
    ],
  ])('reads %s', (_shape, caveats, reader) => {
    expect(aeoGeoReaderCaveats(caveats)).toEqual(reader);
  });

  it('prints each distinct reader sentence once, in order of first occurrence', () => {
    // Two plumbing-only caveats both fall back to the same sentence; two identical pass-through caveats are one.
    expect(
      aeoGeoReaderCaveats(['(project_uid unavailable)', 'No live AI-engine tests were run.', 'Record 3f2504e0-4f89-11d3-9a0c-0305e82c3301 was unavailable.'])
    ).toEqual([AEO_GEO_READER_CAVEATS.inputs_unavailable, 'No live AI-engine tests were run.']);
    expect(aeoGeoReaderCaveats(['robots.txt allows all crawlers.', 'robots.txt allows all crawlers.'])).toEqual(['robots.txt allows all crawlers.']);
    // A bare fixed sentence is left out when a kept composite already carries it; alone, or beside other sentences, it stays in first position.
    const composite = `${AEO_GEO_READER_CAVEATS.search_unavailable} llms-full.txt was fetched in full.`;
    expect(
      aeoGeoReaderCaveats([
        'Web search returned "Quota exceeded." llms-full.txt was fetched in full.',
        'No live AI-engine tests were run.',
        "Web search returned 'Service unavailable'.",
      ])
    ).toEqual([composite, 'No live AI-engine tests were run.']);
    expect(
      aeoGeoReaderCaveats(["Web search returned 'Service unavailable'.", 'No live AI-engine tests were run.', 'Search failed with "Unauthorized".'])
    ).toEqual([AEO_GEO_READER_CAVEATS.search_unavailable, 'No live AI-engine tests were run.']);
    expect(aeoGeoReaderCaveats(["Web search returned 'Service unavailable'."])).toEqual([AEO_GEO_READER_CAVEATS.search_unavailable]);
    // A caveat that merely QUOTES the fixed sentence does not carry it: the genuine fallback line stays beside it.
    const quoting = `One caveat quoted the fallback sentence "${AEO_GEO_READER_CAVEATS.search_unavailable}" as an example.`;
    expect(aeoGeoReaderCaveats([quoting, "Web search returned 'Service unavailable'."])).toEqual([quoting, AEO_GEO_READER_CAVEATS.search_unavailable]);
    // The same for the other fixed sentence: a composite LFX-record caveat absorbs a bare one.
    expect(
      aeoGeoReaderCaveats([
        "The LFX record could not be read by the form's project_uid (access error). No LFX metrics were queried.",
        'The LFX record could not be read.',
      ])
    ).toEqual([`${AEO_GEO_READER_CAVEATS.lfx_record_unread} No LFX metrics were queried.`]);
    // Distinct sentences all stay, in order; an empty report stays empty.
    const distinct = aeoGeoEnvelopeFixture('project').report?.caveats ?? [];
    expect(aeoGeoReaderCaveats(distinct)).toEqual(distinct.map(aeoGeoReaderCaveat));
    expect(aeoGeoReaderCaveats([])).toEqual([]);
  });

  it('accepts a report with no caveats, which the view relies on to print no Caveats section', () => {
    const report = aeoGeoEnvelopeFixture('project').report;
    expect(report).toBeDefined();
    expect(isAeoGeoReport({ ...report, caveats: [] })).toBe(true);
    expect(aeoGeoReaderCaveats([])).toEqual([]);
  });

  it('stays linear on long runs of whitespace and falls back above the length cap', () => {
    for (const caveat of [
      `error${' '.repeat(100_000)}`,
      `x (${' '.repeat(100_000)}`,
      `The lookup failed:${' '.repeat(3_900)}`,
      // A status word followed by whitespace and no number: the whitespace before the number depends on the colon, so no quadratic split.
      `Web search returned "status${' '.repeat(3_900)}x".`,
      `Web search returned "x" with status${' '.repeat(3_900)}x.`,
    ]) {
      const started = performance.now();
      const mapped = aeoGeoReaderCaveat(caveat);
      expect(performance.now() - started).toBeLessThan(50);
      expect(mapped).toBe(caveat.length > 4000 ? AEO_GEO_READER_CAVEATS.inputs_unavailable : caveat);
    }
  });
});
