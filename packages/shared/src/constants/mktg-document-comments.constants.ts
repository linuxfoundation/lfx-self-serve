// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MktgCommentAgentKey, MktgDocumentCommentLabelGroup } from '../interfaces/mktg-document-comments.interface';

/** Labels are contract-specific, not a UI catalog; other agents extend their own entry. */
export const MKTG_DOCUMENT_COMMENT_LABELS: Partial<Record<MktgCommentAgentKey, Record<string, string>>> = {
  'brand-kit': {
    'chapters.logo.system': 'Logo system',
    'chapters.logo.symbol': 'Symbol',
    'chapters.logo.clear_space': 'Clear space',
    'chapters.logo.minimum_size.rule': 'Minimum size',
    'chapters.color.summary': 'Palette summary',
    'chapters.color.palette[].hex': 'Color value',
    'chapters.color.palette[].role': 'Color role',
    'chapters.color.contrast.rule': 'Contrast rule',
    'chapters.type.family': 'Typeface',
    'chapters.type.summary': 'Type summary',
    'chapters.type.note': 'Type note',
    'chapters.visual.icons.recommended': 'Recommended icons',
    'chapters.visual.imagery.rule': 'Imagery rule',
    'chapters.usage.summary': 'Usage summary',
    'chapters.usage.examples[].name': 'Example usage',
    'chapters.voice.umbrella': 'Umbrella message',
    'chapters.voice.line': 'Brand line',
    'chapters.voice.attributes[].line': 'Voice attribute',
    'chapters.voice.note': 'Voice note',
  },
  boilerplates: { 'bp[].t': 'Boilerplate text' },
  'foundation-message': {
    'mf.vision': 'Vision',
    'mf.mission': 'Mission',
    'mf.positioning': 'Positioning',
    'mf.tagline': 'Tagline',
    'mf.crosscut': 'Across the goals',
    'mf.say': 'Say list',
    'mf.avoid': 'Avoid list',
    'mf.anchor': 'Anchor questions',
    'mf.notes': 'Reviewer notes',
    'mf.goals[].vp': 'Value proposition',
    'mf.goals[].key': 'Key message',
    'mf.goals[].proof': 'Goal proof points',
    'mf.goals[].bite': 'Sound bite',
    'mf.goals[].icps': 'Goal audiences',
    'icp[].who': 'Who the audience is',
    'icp[].goals': 'Audience goals',
    'icp[].need': 'Audience need',
    'icp[].value': 'Audience value',
    'icp[].lead': 'Audience lead',
    'icp[].proof': 'Audience proof points',
    'icp[].cta': 'Call to action',
    'icp[].channels': 'Audience channels',
    'icp[].objection': 'Audience objection',
    'icp[].personas': 'Audience personas',
    'mh.umbrella': 'Umbrella message',
    'mh.line': 'Brand line',
    'mh.pillars[].m': 'Pillar message',
    'mh.pillars[].p': 'Pillar proof points',
    'mh.found': 'Message house foundation',
    'mh.aud': 'Audience leads',
  },
};
export const MKTG_DOCUMENT_COMMENT_LABEL_GROUPS: Partial<Record<MktgCommentAgentKey, Record<string, MktgDocumentCommentLabelGroup>>> = {
  'brand-kit': {
    'chapters.color.palette': { label: 'Color', title: '.name' },
    'chapters.logo.partnership': { label: 'Rule', title: '' },
    'chapters.logo.watchouts': { label: 'Watchout', title: '' },
    'chapters.type.rules': { label: 'Rule', title: '' },
    'chapters.visual.icons.rules': { label: 'Rule', title: '' },
    'chapters.visual.imagery.avoid': { label: 'Avoid', title: '' },
    'chapters.usage.examples': { label: 'Example', title: '.name' },
    'chapters.voice.attributes': { label: 'Attribute', title: '.name' },
  },
  boilerplates: { bp: { label: 'Length', title: '.l' } },
  'foundation-message': {
    'mf.goals': { label: 'Goal column', title: '.t' },
    icp: { label: 'Audience', title: '.name' },
    'mh.pillars': { label: 'Pillar', title: '.t' },
    nums: { label: 'Key number', title: '[1]' },
  },
};

/** Existing private artifact purpose; namespaced separately from immutable revisions. */
export const MKTG_DOCUMENT_COMMENTS_PREFIX = 'document-comments';
export const MKTG_DOCUMENT_COMMENTS_SCHEMA = 'mktg-document-comments/v1';
/** Agent form-schema limits, not a new agent catalog or ordering. */
export const MKTG_DOCUMENT_COMMENT_LIMITS = { 'foundation-message': 30, 'brand-kit': 30, boilerplates: 20 } as const;
export const MKTG_DOCUMENT_COMMENT_MAX_CHARS = 4000;
export const MKTG_DOCUMENT_COMMENT_CLIENT_MESSAGES = {
  load: 'Comments could not be loaded. Try again.',
  save: 'Your comment could not be saved. Keep your text and try again.',
  scope: 'Select an asset revision before adding a comment.',
  access: 'You need write access to this project to read or add comments.',
  unexpected: 'The comments response did not match the selected revision.',
} as const;
export const MKTG_DOCUMENT_COMMENT_STATUSES = ['open', 'sent', 'resolved'] as const;
export const MKTG_DOCUMENT_COMMENT_STATUS_LABELS = { open: 'Open', sent: 'Sent to the agent', resolved: 'Resolved by the agent' } as const;
export const MKTG_DOCUMENT_COMMENT_SUBMISSION_STATES = ['reserved', 'started', 'completed', 'failed', 'uncertain'] as const;
export const MKTG_DOCUMENT_COMMENT_ANCHOR_KINDS = ['field', 'passage', 'document'] as const;
/** Whole-asset scope uses existing agent field/passage adapters, not a new upstream payload. */
export const MKTG_DOCUMENT_COMMENT_DOCUMENT_ROOTS = { 'foundation-message': 'mf', 'brand-kit': 'chapters', boilerplates: 'bp' } as const;
export const MKTG_DOCUMENT_COMMENT_DOCUMENT_LABEL = 'Whole asset';
/** Bound whole-object reads/writes without discarding revision history. */
export const MKTG_DOCUMENT_COMMENT_MAX_THREADS = 500;
export const MKTG_DOCUMENT_COMMENT_STORE_MAX_BYTES = 2_000_000;
export const MKTG_DOCUMENT_COMMENT_ANCHOR_MAX_CHARS = 512;
export const MKTG_DOCUMENT_COMMENT_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
/** Only dotted properties and canonical nonnegative array indexes; never arbitrary JS. */
export const MKTG_DOCUMENT_COMMENT_PATH_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*(?:(?:\.[a-zA-Z][a-zA-Z0-9_]*)|(?:\[(?:0|[1-9][0-9]*)\]))*$/;
export const MKTG_DOCUMENT_COMMENT_PATH_PART_REGEX = /[a-zA-Z][a-zA-Z0-9_]*|[0-9]+/g;
export const MKTG_DOCUMENT_COMMENT_UNSAFE_PARTS = ['__proto__', 'prototype', 'constructor'] as const;
export const MKTG_DOCUMENT_COMMENT_ROOTS = {
  'foundation-message': ['mf', 'icp', 'mh', 'nums'],
  'brand-kit': ['kit', 'chapters'],
  boilerplates: ['bp'],
} as const;
export const MKTG_BOILERPLATES_COMMENT_FIELD_REGEX = /^bp(?:\[[0-3]\](?:\.t)?)?$/;
