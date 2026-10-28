// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKEDIN_LINK_PLACEHOLDER, LINKEDIN_SHARE_LINK_ANSWER_KEY, LINKEDIN_SHARE_LINK_MAX_CHARS } from '../constants/linkedin-post.constants';
import type { LinkedinDocumentContent, LinkedinOption, LinkedinOptionPresentation, LinkedinPostTextPart } from '../interfaces/linkedin-post.interface';
import { isLinkedinOptions } from './linkedin-post-envelope.utils';

/** LFX-side share URL only: never fetched and never rendered into the agent's form. */
export function normalizeLinkedinShareLink(value: unknown): string | null {
  if (value === undefined) return '';
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return '';
  if (text.length > LINKEDIN_SHARE_LINK_MAX_CHARS || /\s/.test(text) || !/^https:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return text;
  } catch {
    return null;
  }
}

/** Validate the small LFX-only metadata carried back by an owned result poll. */
export function normalizeLinkedinShareAnswers(value: unknown): Record<string, string> | null {
  if (value === undefined) return { [LINKEDIN_SHARE_LINK_ANSWER_KEY]: '' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const answers = value as Record<string, unknown>;
  if (Object.keys(answers).some((key) => key !== LINKEDIN_SHARE_LINK_ANSWER_KEY)) return null;
  const link = normalizeLinkedinShareLink(answers[LINKEDIN_SHARE_LINK_ANSWER_KEY]);
  return link === null ? null : { [LINKEDIN_SHARE_LINK_ANSWER_KEY]: link };
}

/** Build presentation/copy bytes without mutating the raw option or its stored Markdown. */
export function presentLinkedinOption(option: LinkedinOption, shareLink = ''): LinkedinOptionPresentation {
  const link = normalizeLinkedinShareLink(shareLink) ?? '';
  const fragments = option.text.split(LINKEDIN_LINK_PLACEHOLDER);
  const parts: LinkedinPostTextPart[] = [];
  for (const [index, text] of fragments.entries()) {
    if (index) parts.push({ text: link || 'add your link', needsLink: !link, ...(link ? { href: link } : {}) });
    parts.push({ text, needsLink: false });
  }
  const post = link ? fragments.join(link) : option.text;
  const present = new Set(option.text.toLowerCase().match(/#[\p{L}\p{N}_]+/gu) ?? []);
  const hashtags = option.hashtags.filter((tag) => !present.has(tag.toLowerCase()));
  return { ...option, parts, missingLink: fragments.length > 1 && !link, copyText: [post, hashtags.join(' ')].filter(Boolean).join('\n\n') };
}

/** Stored sidecars cannot supply attribution. Only a BFF-resolved response may opt in. */
export function readLinkedinDocumentContent(sidecar: unknown, allowResolvedAuthor = false): LinkedinDocumentContent | null {
  if (!sidecar || typeof sidecar !== 'object' || !('options' in sidecar) || !isLinkedinOptions(sidecar.options)) return null;
  const notes =
    'notes' in sidecar && Array.isArray(sidecar.notes)
      ? sidecar.notes.filter((note): note is string => typeof note === 'string' && !!note.trim()).slice(0, 3)
      : [];
  const answers = 'answers' in sidecar && sidecar.answers && typeof sidecar.answers === 'object' ? (sidecar.answers as Record<string, unknown>) : {};
  const rawSource = 'source' in sidecar && sidecar.source && typeof sidecar.source === 'object' ? (sidecar.source as Record<string, unknown>) : null;
  const source =
    rawSource &&
    typeof rawSource['label'] === 'string' &&
    rawSource['label'].length <= LINKEDIN_SHARE_LINK_MAX_CHARS &&
    typeof rawSource['fetched'] === 'boolean' &&
    typeof rawSource['words'] === 'number' &&
    Number.isInteger(rawSource['words']) &&
    rawSource['words'] >= 0
      ? { label: rawSource['label'], fetched: rawSource['fetched'], words: rawSource['words'] }
      : undefined;
  return {
    options: sidecar.options,
    notes,
    answers: { [LINKEDIN_SHARE_LINK_ANSWER_KEY]: normalizeLinkedinShareLink(answers[LINKEDIN_SHARE_LINK_ANSWER_KEY]) ?? '' },
    ...(source ? { source } : {}),
    ...(allowResolvedAuthor &&
    'author' in sidecar &&
    sidecar.author &&
    typeof sidecar.author === 'object' &&
    'name' in sidecar.author &&
    (sidecar.author.name === null || typeof sidecar.author.name === 'string') &&
    'isAuthor' in sidecar &&
    typeof sidecar.isAuthor === 'boolean'
      ? { author: { name: sidecar.author.name }, isAuthor: sidecar.isAuthor }
      : {}),
  };
}
