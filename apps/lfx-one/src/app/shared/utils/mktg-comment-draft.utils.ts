// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { MKTG_DOCUMENT_COMMENT_MAX_CHARS } from '@lfx-one/shared/constants';
import type { MktgDocumentCommentDraft } from '@lfx-one/shared/interfaces';

/** Browser-memory composer state; no asset data, storage or network side effects. */
export function createMktgCommentDraft(): MktgDocumentCommentDraft {
  return {
    form: new FormGroup({
      text: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(MKTG_DOCUMENT_COMMENT_MAX_CHARS)] }),
    }),
    clientRequestId: null,
    submittedText: '',
    opened: signal(false),
  };
}
