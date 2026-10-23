// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_DOCUMENT_COMMENT_MAX_CHARS } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';
import { createMktgCommentDraft } from './mktg-comment-draft.utils';

describe('comment draft memory state', () => {
  it('creates independent bounded forms without a nonce or open composer', () => {
    const first = createMktgCommentDraft();
    const second = createMktgCommentDraft();
    expect(first.form).not.toBe(second.form);
    expect(first.form.invalid).toBe(true);
    expect(first.clientRequestId).toBeNull();
    expect(first.opened()).toBe(false);
    first.form.controls.text.setValue('Synthetic comment');
    first.opened.set(true);
    expect(first.form.valid).toBe(true);
    expect(second.form.controls.text.value).toBe('');
    expect(second.opened()).toBe(false);
    first.form.controls.text.setValue('x'.repeat(MKTG_DOCUMENT_COMMENT_MAX_CHARS + 1));
    expect(first.form.invalid).toBe(true);
  });
});
