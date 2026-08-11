// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for vote.utils.ts — `yarn test` (this file runs under the packages/shared Vitest project).

import { describe, expect, it } from 'vitest';

import type { CommentPromptFormValue, PollCommentPrompt, VoteFormValue } from '../interfaces/poll.interface';
import {
  buildCreateVoteRequest,
  buildDraftUpdateVoteRequest,
  buildDraftVoteRequest,
  buildUpdateVoteRequest,
  isNonBlankCommentPrompt,
  mapApiCommentPromptToFormValue,
  mapCommentPromptsToApiFormat,
} from './vote.utils';

const PROJECT_UID = 'project-uid-1';

function baseFormValue(commentPrompts: CommentPromptFormValue[]): VoteFormValue {
  return {
    title: 'Test Vote',
    description: 'A test vote',
    committee: { uid: 'committee-uid-1', name: 'Test Committee' },
    eligible_participants: 'voting_rep',
    close_date: new Date('2026-12-31T00:00:00.000Z'),
    questions: [{ question: 'Do you approve?', response_type: 'single', options: ['Yes', 'No'] }],
    commentPrompts,
  };
}

const BUILDERS = [
  { name: 'buildCreateVoteRequest', build: buildCreateVoteRequest },
  { name: 'buildDraftVoteRequest', build: buildDraftVoteRequest },
  { name: 'buildUpdateVoteRequest', build: buildUpdateVoteRequest },
  { name: 'buildDraftUpdateVoteRequest', build: buildDraftUpdateVoteRequest },
];

describe.each(BUILDERS)('$name — poll_comment_prompts mapping', ({ build }) => {
  it('maps non-blank prompts to poll_comment_prompts', () => {
    const formValue = baseFormValue([{ prompt: 'Why did you vote this way?' }]);
    const request = build(formValue, PROJECT_UID);
    expect(request.poll_comment_prompts).toEqual([{ prompt: 'Why did you vote this way?' }]);
  });

  it('omits poll_comment_prompts entirely when there are no prompts', () => {
    const formValue = baseFormValue([]);
    const request = build(formValue, PROJECT_UID);
    expect(request.poll_comment_prompts).toBeUndefined();
    // undefined values are dropped by JSON.stringify, so the wire payload never sends the key
    expect('poll_comment_prompts' in JSON.parse(JSON.stringify(request))).toBe(false);
  });

  it('drops a blank prompt on submit', () => {
    const formValue = baseFormValue([{ prompt: '   ' }, { prompt: 'Real prompt' }]);
    const request = build(formValue, PROJECT_UID);
    expect(request.poll_comment_prompts).toEqual([{ prompt: 'Real prompt' }]);
  });

  it('maps multiple prompts to poll_comment_prompts in order', () => {
    const formValue = baseFormValue([{ prompt: 'Existing prompt' }, { prompt: 'New prompt' }]);
    const request = build(formValue, PROJECT_UID);
    expect(request.poll_comment_prompts).toEqual([{ prompt: 'Existing prompt' }, { prompt: 'New prompt' }]);
  });

  it('omits poll_comment_prompts when every prompt is blank', () => {
    const formValue = baseFormValue([{ prompt: '' }, { prompt: '   ' }]);
    const request = build(formValue, PROJECT_UID);
    expect(request.poll_comment_prompts).toBeUndefined();
  });
});

describe('mapApiCommentPromptToFormValue', () => {
  it('copies the prompt text from the API prompt', () => {
    const prompt: PollCommentPrompt = { prompt_id: 'p-1', prompt: 'Why did you vote this way?' };
    expect(mapApiCommentPromptToFormValue(prompt)).toEqual({ prompt: 'Why did you vote this way?' });
  });
});

describe('mapCommentPromptsToApiFormat', () => {
  it('trims prompt text', () => {
    const formValue = baseFormValue([{ prompt: '  Existing  ' }]);
    expect(mapCommentPromptsToApiFormat(formValue.commentPrompts)).toEqual([{ prompt: 'Existing' }]);
  });

  it('maps prompt text only', () => {
    const formValue = baseFormValue([{ prompt: 'New prompt' }]);
    expect(mapCommentPromptsToApiFormat(formValue.commentPrompts)).toEqual([{ prompt: 'New prompt' }]);
  });

  it('returns undefined when all prompts are blank', () => {
    const formValue = baseFormValue([{ prompt: '' }, { prompt: '   ' }]);
    expect(mapCommentPromptsToApiFormat(formValue.commentPrompts)).toBeUndefined();
  });

  it('returns undefined for nullish input', () => {
    expect(mapCommentPromptsToApiFormat(null as unknown as CommentPromptFormValue[])).toBeUndefined();
  });
});

describe('isNonBlankCommentPrompt', () => {
  it('returns true for non-blank text, ignoring surrounding whitespace', () => {
    expect(isNonBlankCommentPrompt('Why this choice?')).toBe(true);
    expect(isNonBlankCommentPrompt('  padded  ')).toBe(true);
  });

  it('returns false for blank, empty, or nullish text', () => {
    expect(isNonBlankCommentPrompt('')).toBe(false);
    expect(isNonBlankCommentPrompt('   ')).toBe(false);
    expect(isNonBlankCommentPrompt(undefined)).toBe(false);
    expect(isNonBlankCommentPrompt(null)).toBe(false);
  });
});
