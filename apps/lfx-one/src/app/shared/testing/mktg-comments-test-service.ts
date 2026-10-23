// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Provider, signal } from '@angular/core';
import type { MktgDocumentComment, MktgDocumentCommentDraft, MktgDocumentCommentScope } from '@lfx-one/shared/interfaces';
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
  const scope = overrides.selectedScope ?? signal<MktgDocumentCommentScope | null>(null);
  const drafts = new Map<string, MktgDocumentCommentDraft>();
  return {
    provide: MktgDocumentCommentsService,
    useValue: {
      threads: signal<MktgDocumentComment[]>([]),
      selectedScope: scope,
      fieldDraft: (field: string, create: () => MktgDocumentCommentDraft) => {
        const key = JSON.stringify([scope(), field]);
        let draft = drafts.get(key);
        if (!draft) {
          draft = create();
          drafts.set(key, draft);
        }
        return draft;
      },
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
