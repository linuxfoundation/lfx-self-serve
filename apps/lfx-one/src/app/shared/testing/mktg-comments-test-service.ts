// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Provider, signal } from '@angular/core';
import type { MktgDocumentComment, MktgDocumentCommentScope } from '@lfx-one/shared/interfaces';
import { MktgDocumentCommentsService } from '@services/mktg-document-comments.service';
import { EMPTY } from 'rxjs';

/** Synthetic role attribution and opaque identifiers only. */
export function mktgCommentFixture(overrides: Partial<MktgDocumentComment> = {}): MktgDocumentComment {
  return {
    id: 'synthetic-comment',
    anchor: { kind: 'field', key: 'mf.positioning' },
    revisionId: `000001-${'a'.repeat(64)}`,
    author: { name: 'Project writer' },
    text: 'Shorten the positioning.',
    createdAt: '2026-10-21T10:00:00Z',
    status: 'open',
    sentInRun: null,
    resultRevisionId: null,
    resolution: null,
    ...overrides,
  };
}
export function mktgCommentScopeFixture(): MktgDocumentCommentScope {
  return { projectUid: 'synthetic-project', agentKey: 'foundation-message', documentId: 'living', revisionId: `000001-${'a'.repeat(64)}` };
}

/** Presentational hosts do not own comment HTTP. Individual comment specs supply the state they exercise. */
export function provideMktgCommentsStub(overrides: Partial<MktgDocumentCommentsService> = {}): Provider {
  return {
    provide: MktgDocumentCommentsService,
    useValue: {
      threads: signal<MktgDocumentComment[]>([]),
      selectedScope: signal<MktgDocumentCommentScope | null>(null),
      draftScopeKey: signal(''),
      labelContent: signal<unknown>(null),
      setLabelContent: () => undefined,
      loaded: signal(false),
      loading: signal(false),
      saving: signal(false),
      loadError: signal(''),
      saveError: signal(''),
      select: () => undefined,
      refresh: () => undefined,
      add: () => EMPTY,
      ...overrides,
    },
  };
}
