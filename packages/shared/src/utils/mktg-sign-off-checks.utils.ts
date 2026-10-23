// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_SIGN_OFF_CHECK_LABELS } from '../constants/mktg-sign-off-checks.constants';
import type { MktgDocumentAgentKey } from '../interfaces/mktg-document-store.interface';
import type { MktgSignOffCheck } from '../interfaces/mktg-sign-off-checks.interface';
import { countBoilerplatesWords } from './boilerplates.utils';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function rows(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function strings(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  return Array.isArray(value) ? value.flatMap(strings) : [];
}
function check(id: MktgSignOffCheck['id'], status: MktgSignOffCheck['status'], detail: string): MktgSignOffCheck {
  return { id, label: MKTG_SIGN_OFF_CHECK_LABELS[id], status, detail };
}

/** Only authored prose fields: never instructions/avoid definitions, SVG, URLs, input records or source labels. */
function proseOf(agent: MktgDocumentAgentKey, asset: Record<string, unknown>): string[] {
  if (agent === 'foundation-message') {
    const mf = record(asset['mf']);
    return strings([
      mf['vision'],
      mf['mission'],
      mf['positioning'],
      mf['tagline'],
      rows(mf['goals']).map((goal) => {
        const row = record(goal);
        return [row['vp'], row['key'], row['bite']];
      }),
    ]);
  }
  if (agent === 'boilerplates') return strings(rows(asset['bp']).map((row) => record(row)['t']));
  if (agent === 'faq') return strings(rows(asset['faq']).map((group) => rows(rows(group)[1]).map((question) => rows(question).slice(0, 2))));
  if (agent !== 'brand-kit') return [];
  const chapters = record(asset['chapters']);
  const logo = record(chapters['logo']);
  const color = record(chapters['color']);
  const type = record(chapters['type']);
  const visual = record(chapters['visual']);
  const icons = record(visual['icons']);
  const imagery = record(visual['imagery']);
  const voice = record(chapters['voice']);
  const usage = record(chapters['usage']);
  return strings([
    logo['system'],
    logo['clear_space'],
    logo['symbol'],
    logo['partnership'],
    logo['watchouts'],
    record(logo['minimum_size'])['rule'],
    color['summary'],
    rows(color['palette']).map((row) => record(row)['role']),
    type['summary'],
    type['note'],
    type['rules'],
    icons['rules'],
    icons['recommended'],
    imagery['rule'],
    usage['summary'],
    rows(usage['examples']).map((row) => record(row)['name']),
    voice['umbrella'],
    voice['line'],
    voice['note'],
    rows(voice['attributes']).map((row) => [record(row)['name'], record(row)['line']]),
  ]);
}

function taglineCheck(agent: MktgDocumentAgentKey, asset: Record<string, unknown>, framework: Record<string, unknown>): MktgSignOffCheck {
  if (agent !== 'foundation-message' && agent !== 'brand-kit') return check('tagline', 'n/a', 'This asset has no dedicated tagline field.');
  const expected = record(framework['mf'])['tagline'];
  const actual = agent === 'foundation-message' ? record(asset['mh'])['line'] : record(record(asset['chapters'])['voice'])['line'];
  if (agent === 'brand-kit' && (typeof actual !== 'string' || !actual.trim())) return check('tagline', 'n/a', 'This kit has no stored voice line.');
  if (typeof expected !== 'string' || !expected.trim())
    return check('tagline', agent === 'foundation-message' ? 'fail' : 'n/a', 'No framework tagline is available.');
  return check(
    'tagline',
    actual === expected ? 'pass' : 'fail',
    actual === expected ? 'The stored tagline matches verbatim.' : 'The stored tagline does not match the framework.'
  );
}

function audienceCheck(agent: MktgDocumentAgentKey, asset: Record<string, unknown>): MktgSignOffCheck {
  if (agent !== 'foundation-message') return check('audiences', 'n/a', 'Goals and audiences are checked on the framework.');
  const goals = rows(record(asset['mf'])['goals']);
  const audiences = rows(asset['icp']);
  const invalid = goals.filter((value) => {
    const goal = record(value);
    const id = goal['id'];
    return typeof id !== 'string' || !id.trim() || !strings(goal['icps']).length || !audiences.some((audience) => rows(record(audience)['goals']).includes(id));
  });
  return check(
    'audiences',
    goals.length && !invalid.length ? 'pass' : 'fail',
    goals.length && !invalid.length
      ? 'Every goal names audiences and is referenced by an audience.'
      : 'Every goal needs an audience list and an audience referencing its ID.'
  );
}

function avoidCheck(agent: MktgDocumentAgentKey, asset: Record<string, unknown>, framework: Record<string, unknown>): MktgSignOffCheck {
  const avoid = record(framework['mf'])['avoid'];
  if (!Array.isArray(avoid)) return check('avoid', 'n/a', 'No approved framework avoid-list is available.');
  const prose = proseOf(agent, asset);
  if (!prose.length) return check('avoid', 'n/a', 'No structured prose is available for this asset.');
  const phrases = avoid.map((row) => rows(row)[0]);
  if (phrases.some((phrase) => typeof phrase !== 'string' || !phrase.trim())) return check('avoid', 'n/a', 'The stored avoid-list has an unreadable phrase.');
  const hits = phrases.filter((phrase) => {
    if (typeof phrase !== 'string') return false;
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'iu');
    return prose.some((text) => pattern.test(text));
  });
  return check(
    'avoid',
    hits.length ? 'fail' : 'pass',
    hits.length ? `${hits.length} avoid-list phrase(s) occur in the asset's prose.` : 'No avoid-list phrase occurs in the asset prose.'
  );
}

function wordsCheck(agent: MktgDocumentAgentKey, asset: Record<string, unknown>): MktgSignOffCheck {
  if (agent !== 'foundation-message' && agent !== 'boilerplates') return check('words', 'n/a', 'No mechanical word limits apply to this asset.');
  const entries = agent === 'boilerplates' ? rows(asset['bp']) : rows(record(asset['mf'])['goals']);
  const failures = entries.filter((value) => {
    const row = record(value);
    const text = agent === 'boilerplates' ? row['t'] : row['bite'];
    if (typeof text !== 'string' || !text.trim()) return true;
    const words = countBoilerplatesWords(text);
    if (agent === 'foundation-message') return words < 3 || words > 10;
    const max = row['max'];
    return typeof max !== 'number' || !Number.isFinite(max) || max < 0 || words > max;
  });
  return check(
    'words',
    entries.length && !failures.length ? 'pass' : 'fail',
    entries.length && !failures.length
      ? 'All stored text is within its word limit.'
      : `${failures.length || 1} missing or over-limit text field(s); framework bites require 3–10 words.`
  );
}

function faqCheck(agent: MktgDocumentAgentKey, asset: Record<string, unknown>): MktgSignOffCheck {
  if (agent !== 'faq') return check('faq', 'n/a', 'Unanswered questions are checked on the FAQ.');
  const groups = asset['faq'];
  if (!Array.isArray(groups) || !groups.length) return check('faq', 'fail', 'No FAQ groups are stored.');
  if (groups.some((group) => !Array.isArray(rows(group)[1]) || !rows(rows(group)[1]).length))
    return check('faq', 'fail', 'A stored FAQ group has no readable questions.');
  const entries = groups.flatMap((group) => rows(rows(group)[1]));
  const unanswered = entries.filter((entry) => typeof rows(entry)[1] !== 'string' || !String(rows(entry)[1]).trim());
  return check(
    'faq',
    entries.length && !unanswered.length ? 'pass' : 'fail',
    entries.length && !unanswered.length ? 'Every stored FAQ question has an answer.' : `${unanswered.length || 1} unanswered or missing FAQ question(s).`
  );
}

/** Pure server-independent findings over stored structured content, never rendered Markdown. */
export function mktgSignOffChecks(agent: MktgDocumentAgentKey, content: unknown, approvedFramework: unknown, sidecar?: unknown): MktgSignOffCheck[] {
  const asset = record(content);
  const framework = agent === 'foundation-message' ? asset : record(approvedFramework);
  const checks = [
    taglineCheck(agent, asset, framework),
    audienceCheck(agent, asset),
    avoidCheck(agent, asset, framework),
    wordsCheck(agent, asset),
    faqCheck(agent, asset),
  ];
  const findings = record(record(sidecar)['checks'])['findings'];
  if (Array.isArray(findings) && findings.every((finding) => typeof finding === 'string')) {
    checks.push(check('agent', findings.length ? 'fail' : 'pass', findings.length ? findings.join('\n') : 'The agent reported no additional findings.'));
  }
  return checks;
}
