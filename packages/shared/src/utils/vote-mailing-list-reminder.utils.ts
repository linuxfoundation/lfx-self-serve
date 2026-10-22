// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Deliberately imports siblings directly, never the `utils` barrel or `./vote.utils` — those pull in
// `@angular/forms`, which throws in non-Angular runtimes (docs/architecture/shared/package-architecture.md).
import {
  VOTE_MAILING_LIST_REMINDER_MAILTO_MAX_CHARS,
  VOTE_MAILING_LIST_REMINDER_TITLE_MAX_CHARS,
  VOTE_MAILING_LIST_REMINDER_TITLE_MAX_ENCODED_CHARS,
} from '../constants/vote.constants';
import type { Vote, VoteMailingListReminderDraft } from '../interfaces/poll.interface';
import { formatVoteDeadline } from './date-time.utils';
import { isMailtoSafeEmail } from './email.utils';

/** Subject and body for the mailing-list reminder a vote manager sends from their own email app (#3658). */
export function buildVoteMailingListReminder(vote: Pick<Vote, 'name' | 'end_time' | 'end_time_timezone'>, permalinkUrl: string): VoteMailingListReminderDraft {
  // Unicode mode matches only unpaired surrogates, leaving valid emoji and other pairs intact.
  const normalizedTitle = (vote.name ?? '')
    .replace(/[\uD800-\uDFFF]/gu, '\uFFFD')
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim();
  const title = shortenVoteTitle(normalizedTitle);
  const deadline = formatVoteDeadline(vote.end_time, vote.end_time_timezone);

  return {
    subject: `Reminder: please vote on "${title}"`,
    body: [
      'Hi all,',
      '',
      `Voting is open for "${title}" and closes on ${deadline}.`,
      '',
      "If you're an eligible voter and haven't voted yet, please vote here:",
      permalinkUrl,
      '',
      "If you've already voted, thank you, there's nothing more to do.",
    ].join('\n'),
  };
}

/**
 * `mailto:` href addressed only to `address`, or `null` when the address could add recipients/headers
 * or the draft cannot be encoded or would exceed what mail clients accept. The address is not encoded: it has passed
 * `isMailtoSafeEmail`, so it is a plain single recipient.
 */
export function buildMailtoHref(address: string, draft: VoteMailingListReminderDraft): string | null {
  if (!isMailtoSafeEmail(address)) {
    return null;
  }

  try {
    const href = `mailto:${address}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
    return href.length <= VOTE_MAILING_LIST_REMINDER_MAILTO_MAX_CHARS ? href : null;
  } catch (error) {
    if (error instanceof URIError) {
      return null;
    }
    throw error;
  }
}

/** Capped twice: code points for readability, encoded chars because CJK/emoji expand ~3–9× in the href. */
function shortenVoteTitle(title: string): string {
  // Array.from iterates code points, so a supplementary-plane char (emoji, rare CJK) is never split mid-surrogate.
  const codePoints = Array.from(title);
  const raw = codePoints.slice(0, VOTE_MAILING_LIST_REMINDER_TITLE_MAX_CHARS).join('');
  if (codePoints.length <= VOTE_MAILING_LIST_REMINDER_TITLE_MAX_CHARS && encodeURIComponent(raw).length <= VOTE_MAILING_LIST_REMINDER_TITLE_MAX_ENCODED_CHARS) {
    return title;
  }

  const budget = VOTE_MAILING_LIST_REMINDER_TITLE_MAX_ENCODED_CHARS - encodeURIComponent('…').length;
  let encoded = 0;
  const kept: string[] = [];
  for (const char of raw) {
    encoded += encodeURIComponent(char).length;
    if (encoded > budget) {
      break;
    }
    kept.push(char);
  }

  return `${kept.join('')}…`;
}
