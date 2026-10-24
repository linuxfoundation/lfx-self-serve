// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BRAND_KIT_CHAPTERS } from '../constants/brand-kit.constants';
import {
  MKTG_BOILERPLATES_COMMENT_FIELD_REGEX,
  MKTG_DOCUMENT_COMMENT_ANCHOR_MAX_CHARS,
  MKTG_DOCUMENT_COMMENT_DOCUMENT_ROOTS,
  MKTG_DOCUMENT_COMMENT_DOCUMENT_LABEL,
  MKTG_DOCUMENT_COMMENT_LIMITS,
  MKTG_DOCUMENT_COMMENT_LABELS,
  MKTG_DOCUMENT_COMMENT_LABEL_GROUPS,
  MKTG_DOCUMENT_COMMENT_MAX_CHARS,
  MKTG_DOCUMENT_COMMENT_PATH_PART_REGEX,
  MKTG_DOCUMENT_COMMENT_PATH_REGEX,
  MKTG_DOCUMENT_COMMENT_ROOTS,
  MKTG_DOCUMENT_COMMENT_UNSAFE_PARTS,
} from '../constants/mktg-document-comments.constants';
import type {
  MktgCommentAgentKey,
  MktgDocumentCommentAnchor,
  MktgDocumentCommentAnchorKind,
  MktgDocumentCommentField,
} from '../interfaces/mktg-document-comments.interface';

/** Resolve own JSON properties only; null is a real field, inherited properties are not. */
export function readMktgDocumentCommentField(source: unknown, path: string): MktgDocumentCommentField | null {
  if (path !== path.trim() || path.length > MKTG_DOCUMENT_COMMENT_ANCHOR_MAX_CHARS || !MKTG_DOCUMENT_COMMENT_PATH_REGEX.test(path)) return null;
  const parts = path.match(MKTG_DOCUMENT_COMMENT_PATH_PART_REGEX) ?? [];
  let value: unknown = source;
  for (const part of parts) {
    if ((MKTG_DOCUMENT_COMMENT_UNSAFE_PARTS as readonly string[]).includes(part)) return null;
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) return null;
    // Array indexes must be bracketed, and object properties must be dotted.
    if (Array.isArray(value) !== /^[0-9]+$/.test(part)) return null;
    value = (value as Record<string, unknown>)[part];
  }
  return value === undefined ? null : { value };
}

/** One anchor-kind contract for validation and browser controls. */
export function mktgDocumentCommentAnchorKind(agentKey: MktgCommentAgentKey): MktgDocumentCommentAnchorKind {
  return agentKey === 'brand-kit' ? 'passage' : 'field';
}

/** Validate the stored asset's field, not a sorted display-row index or caller-supplied passage. */
export function isMktgDocumentCommentAnchor(agentKey: MktgCommentAgentKey, source: unknown, anchor: MktgDocumentCommentAnchor): boolean {
  if (anchor.kind === 'document') {
    const field = readMktgDocumentCommentField(source, anchor.key);
    return anchor.key === MKTG_DOCUMENT_COMMENT_DOCUMENT_ROOTS[agentKey] && field !== null && field.value !== null && typeof field.value === 'object';
  }
  if (anchor.kind !== mktgDocumentCommentAnchorKind(agentKey)) return false;
  const root = anchor.key.match(/^[a-zA-Z][a-zA-Z0-9_]*/)?.[0] ?? '';
  if (!(MKTG_DOCUMENT_COMMENT_ROOTS[agentKey] as readonly string[]).includes(root)) return false;
  if (agentKey === 'boilerplates' && !MKTG_BOILERPLATES_COMMENT_FIELD_REGEX.test(anchor.key)) return false;
  return readMktgDocumentCommentField(source, anchor.key) !== null;
}

/** A pinned kit passage lands back in its registered chapter, never a report/sample or arbitrary URL tab. */
export function mktgDocumentCommentTab(agentKey: MktgCommentAgentKey, key: string): string | undefined {
  if (agentKey !== 'brand-kit') return undefined;
  const chapter = /^chapters\.([a-z]+)\./.exec(key)?.[1];
  return BRAND_KIT_CHAPTERS.find((tab) => tab.id === chapter)?.id;
}

/** Same human field caption for inline pins, controls and the panel; no UI agent list. */
export function describeMktgDocumentCommentField(
  agentKey: MktgCommentAgentKey | undefined,
  key: string,
  content?: unknown,
  kind?: MktgDocumentCommentAnchorKind
): string {
  if (!agentKey) return key;
  if (kind === 'document' && key === MKTG_DOCUMENT_COMMENT_DOCUMENT_ROOTS[agentKey]) return MKTG_DOCUMENT_COMMENT_DOCUMENT_LABEL;
  const normalized = key.replace(/\[\d+\]/g, '[]');
  const base = MKTG_DOCUMENT_COMMENT_LABELS[agentKey]?.[normalized] ?? key;
  const match = /^(.+?)\[(\d+)\]/.exec(key);
  if (!match) return base;
  const prefix = match[1] ?? '';
  const group = MKTG_DOCUMENT_COMMENT_LABEL_GROUPS[agentKey]?.[prefix];
  if (!group) return base;
  const path = `${prefix}[${match[2]}]`;
  const title = readMktgDocumentCommentField(content, path + group.title)?.value;
  const suffix = typeof title === 'string' && title.trim() ? ` · ${title}` : '';
  const caption = `${group.label} ${Number(match[2]) + 1}${suffix}`;
  return normalized === `${prefix}[]` ? caption : `${base} · ${caption}`;
}

/** Per-send cap mirrors the owning agent; text is bounded but otherwise remains user data. */
export function validateMktgDocumentCommentBatch(agentKey: MktgCommentAgentKey, comments: readonly { text: string }[]): string[] {
  const errors: string[] = [];
  if (comments.length === 0 || comments.length > MKTG_DOCUMENT_COMMENT_LIMITS[agentKey]) {
    errors.push(`Send between 1 and ${MKTG_DOCUMENT_COMMENT_LIMITS[agentKey]} comments.`);
  }
  if (comments.some(({ text }) => !text.trim() || text.length > MKTG_DOCUMENT_COMMENT_MAX_CHARS)) {
    errors.push(`Each comment must contain text and be at most ${MKTG_DOCUMENT_COMMENT_MAX_CHARS} characters.`);
  }
  return errors;
}
