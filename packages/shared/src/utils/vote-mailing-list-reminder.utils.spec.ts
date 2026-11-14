// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  VOTE_MAILING_LIST_REMINDER_MAILTO_MAX_CHARS,
  VOTE_MAILING_LIST_REMINDER_TITLE_MAX_CHARS,
  VOTE_MAILING_LIST_REMINDER_TITLE_MAX_ENCODED_CHARS,
} from '../constants/vote.constants';
import { buildMailtoHref, buildVoteMailingListReminder } from './vote-mailing-list-reminder.utils';

const PERMALINK = 'https://app.example.org/votes/vote-1';
// 2026-11-16T01:00Z is Nov 15, 5:00 PM in America/Los_Angeles and 8:00 PM in America/New_York.
const END_TIME = '2026-11-16T01:00:00Z';
const ADDRESS = 'tsc@lists.example.org';

function vote(name: string, end_time_timezone?: string) {
  return { name, end_time: END_TIME, end_time_timezone };
}

/** Title as it appears inside the subject's quotes. */
function subjectTitle(subject: string): string {
  return subject.slice('Reminder: please vote on "'.length, -1);
}

describe('buildVoteMailingListReminder', () => {
  it('builds the exact subject and body for a plain title', () => {
    const draft = buildVoteMailingListReminder(vote('Approve the 2027 budget', 'America/New_York'), PERMALINK);

    expect(draft.subject).toBe('Reminder: please vote on "Approve the 2027 budget"');
    expect(draft.body).toBe(
      [
        'Hi all,',
        '',
        'Voting is open for "Approve the 2027 budget" and closes on Nov 15, 2026 8:00 PM EST.',
        '',
        "If you're an eligible voter and haven't voted yet, please vote here:",
        PERMALINK,
        '',
        "If you've already voted, thank you, there's nothing more to do.",
      ].join('\n')
    );
  });

  it.each(['\uD800', '\uDC00'])('replaces an unpaired surrogate %j without changing valid emoji', (surrogate) => {
    const title = `Budget ${surrogate} 🗳️`;
    const draft = buildVoteMailingListReminder(vote(title), PERMALINK);

    expect(subjectTitle(draft.subject)).toBe('Budget \uFFFD 🗳️');
    expect(draft.body).toContain('Voting is open for "Budget \uFFFD 🗳️"');
    expect(buildMailtoHref(ADDRESS, draft)).not.toBeNull();
  });

  it('normalizes malformed Unicode before enforcing the encoded title limit', () => {
    const draft = buildVoteMailingListReminder(vote('\uD800'.repeat(300)), PERMALINK);
    const shortened = subjectTitle(draft.subject);

    expect(shortened.endsWith('…')).toBe(true);
    expect(encodeURIComponent(shortened).length).toBeLessThanOrEqual(VOTE_MAILING_LIST_REMINDER_TITLE_MAX_ENCODED_CHARS);
    expect(buildMailtoHref(ADDRESS, draft)).not.toBeNull();
  });

  it('collapses title control characters and whitespace while preserving body paragraphs', () => {
    const draft = buildVoteMailingListReminder(vote(' \tBudget\r\n\tapproval\u0000\u007F\u0085\u2028\u2029 vote  '), PERMALINK);

    expect(subjectTitle(draft.subject)).toBe('Budget approval vote');
    expect(draft.body).toContain('Voting is open for "Budget approval vote"');
    expect(draft.body).toContain('Hi all,\n\nVoting is open');
  });

  it('falls back to the legacy vote timezone when the vote has none', () => {
    const draft = buildVoteMailingListReminder(vote('Budget'), PERMALINK);

    expect(draft.body).toContain('closes on Nov 15, 2026 5:00 PM PST.');
  });

  it('shortens a long title with an ellipsis in both subject and body', () => {
    const title = 'a'.repeat(300);
    const draft = buildVoteMailingListReminder(vote(title), PERMALINK);
    const shortened = subjectTitle(draft.subject);

    expect(shortened.endsWith('…')).toBe(true);
    expect(Array.from(shortened.slice(0, -1))).toHaveLength(VOTE_MAILING_LIST_REMINDER_TITLE_MAX_CHARS);
    expect(draft.body).toContain(`Voting is open for "${shortened}"`);
  });

  it('keeps a title that fits both caps unchanged', () => {
    const title = 'a'.repeat(VOTE_MAILING_LIST_REMINDER_TITLE_MAX_CHARS);

    expect(subjectTitle(buildVoteMailingListReminder(vote(title), PERMALINK).subject)).toBe(title);
  });

  it.each([
    ['CJK', '投票'.repeat(100)],
    ['emoji', '🗳️✅'.repeat(60)],
    ['surrogate pairs', '😀'.repeat(150)],
  ])('caps a %s title by encoded length without splitting a surrogate pair', (_label, title) => {
    const shortened = subjectTitle(buildVoteMailingListReminder(vote(title), PERMALINK).subject);

    expect(shortened.endsWith('…')).toBe(true);
    // encodeURIComponent throws URIError on a lone surrogate, so this also proves no pair was split.
    expect(encodeURIComponent(shortened).length).toBeLessThanOrEqual(VOTE_MAILING_LIST_REMINDER_TITLE_MAX_ENCODED_CHARS);
    expect(title.startsWith(shortened.slice(0, -1))).toBe(true);
  });

  it('keeps the href within the mail-app limit for a worst-case title', () => {
    const draft = buildVoteMailingListReminder(vote('😀'.repeat(500), 'America/New_York'), PERMALINK);
    const href = buildMailtoHref(ADDRESS, draft);

    expect(href).not.toBeNull();
    expect(href!.length).toBeLessThanOrEqual(VOTE_MAILING_LIST_REMINDER_MAILTO_MAX_CHARS);
  });
});

describe('buildMailtoHref', () => {
  it('addresses only the list and encodes subject and body', () => {
    const draft = { subject: 'Reminder', body: 'Line one\nLine two' };

    expect(buildMailtoHref(ADDRESS, draft)).toBe(`mailto:${ADDRESS}?subject=Reminder&body=Line%20one%0ALine%20two`);
  });

  it('round-trips special characters in the title through decodeURIComponent', () => {
    const title = `Q&A? #1 100% "final" 'vote'\nnext line`;
    const draft = buildVoteMailingListReminder(vote(title), PERMALINK);
    const href = buildMailtoHref(ADDRESS, draft)!;
    const query = href.slice(`mailto:${ADDRESS}?`.length);
    const [subjectParam, bodyParam] = query.split('&');

    expect(query.split('&')).toHaveLength(2);
    expect(decodeURIComponent(subjectParam.slice('subject='.length))).toBe(draft.subject);
    expect(decodeURIComponent(bodyParam.slice('body='.length))).toBe(draft.body);
  });

  it.each([['a@b.example,c@d.example'], ['a@b.example?cc=x@y.example'], ['a@b.example&bcc=x'], ['a@b.example\nbcc: x@y.example'], ['']])(
    'returns null for unsafe address %p',
    (address) => {
      expect(buildMailtoHref(address, { subject: 'Reminder', body: 'Body' })).toBeNull();
    }
  );

  it.each([
    { subject: 'Reminder\uD800', body: 'Body' },
    { subject: 'Reminder', body: 'Body\uDC00' },
  ])('returns null rather than throwing for malformed draft text %j', (draft) => {
    expect(buildMailtoHref(ADDRESS, draft)).toBeNull();
  });

  it('returns null when the href would exceed the mail-app limit', () => {
    expect(buildMailtoHref(ADDRESS, { subject: 'Reminder', body: 'x'.repeat(VOTE_MAILING_LIST_REMINDER_MAILTO_MAX_CHARS) })).toBeNull();
  });
});
