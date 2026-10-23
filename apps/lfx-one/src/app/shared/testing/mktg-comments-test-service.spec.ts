// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MktgDocumentCommentsService } from '@services/mktg-document-comments.service';
import { describe, expect, it, vi } from 'vitest';
import { mktgCommentFixture, mktgCommentScopeFixture, provideMktgCommentsStub } from './mktg-comments-test-service';

describe('synthetic comment test provider', () => {
  it('needs no HTTP/user providers, has no implicit writes, and keeps fixture revision IDs consistent', () => {
    TestBed.configureTestingModule({ providers: [provideMktgCommentsStub()] });
    const service = TestBed.inject(MktgDocumentCommentsService);
    expect(service.loaded()).toBe(false);
    expect(service.threads()).toEqual([]);
    expect(service.labelContent()).toBeNull();
    expect(mktgCommentFixture().revisionId).toBe(mktgCommentScopeFixture().revisionId);
    const next = vi.fn();
    service.add({ kind: 'field', key: 'mf.positioning' }, 'Synthetic text', 'opaque-request').subscribe(next);
    expect(next).not.toHaveBeenCalled();
  });
});
