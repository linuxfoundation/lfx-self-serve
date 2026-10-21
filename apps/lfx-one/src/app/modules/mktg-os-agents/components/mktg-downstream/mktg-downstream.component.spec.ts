// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { MKTG_DOCUMENT_TYPES, MKTG_REBUILD_NAVIGATION_STATE_KEY } from '@lfx-one/shared/constants';
import { MktgDocumentsResponse, MktgRevisionRef } from '@lfx-one/shared/interfaces';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { UserService } from '@services/user.service';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MktgDownstreamComponent } from './mktg-downstream.component';

const reference: MktgRevisionRef = { agentKey: 'foundation-message', revisionId: `000003-${'c'.repeat(64)}`, revisionNumber: 3, contentSha256: 'd'.repeat(64) };
const listing = (stale = true): MktgDocumentsResponse => ({
  project: 'synthetic-project',
  approvedFramework: reference,
  groups: MKTG_DOCUMENT_TYPES.filter((type) => ['boilerplates', 'faq'].includes(type.agentKey)).map((type) => ({
    type,
    documents: [
      {
        agentKey: type.agentKey,
        documentId: 'living',
        revisionCount: 1,
        latestRevisionId: 'revision',
        approvedCurrent: null,
        updatedAt: null,
        createdAt: null,
        needsRebuild: stale ? { builtFrom: { ...reference, revisionNumber: 1 }, rebuildFrom: reference } : null,
      },
    ],
  })),
});

describe('Framework Downstream card', () => {
  let fixture: ComponentFixture<MktgDownstreamComponent>;
  let reads: Subject<MktgDocumentsResponse>[];
  const impersonating = signal(false);
  beforeEach(async () => {
    reads = [];
    impersonating.set(false);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: UserService, useValue: { impersonating } },
        {
          provide: MktgDocumentStoreService,
          useValue: {
            listDocuments: vi.fn(() => {
              const read = new Subject<MktgDocumentsResponse>();
              reads.push(read);
              return read;
            }),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(MktgDownstreamComponent);
    fixture.componentRef.setInput('project', 'synthetic-project');
    fixture.componentRef.setInput('writer', true);
    await fixture.whenStable();
  });
  it('renders the board copy from the shared server projection and hides when nothing is stale', async () => {
    reads[0].next(listing());
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="mktg-downstream-card"]')?.classList.contains('bg-amber-50')).toBe(true);
    expect(root.querySelector('[data-testid="mktg-downstream-copy"]')?.textContent).toContain('Boilerplates and FAQ were built from v1. Rebuild them from v3?');
    expect(root.querySelector('[data-testid="mktg-downstream-rebuild"]')?.textContent).toContain('Rebuild both');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    root.querySelector<HTMLButtonElement>('[data-testid="mktg-downstream-rebuild"] button')?.click();
    expect(navigate).toHaveBeenCalledWith(
      ['families', 'positioning-brand'],
      expect.objectContaining({
        state: { [MKTG_REBUILD_NAVIGATION_STATE_KEY]: { project: 'synthetic-project', frameworkRevisionId: reference.revisionId } },
        queryParams: { revision: null },
      })
    );
    fixture.componentRef.setInput('refreshKey', 'new-approval');
    await fixture.whenStable();
    reads[1].next(listing(false));
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="mktg-downstream-card"]')).toBeNull();
  });
  it('distinguishes loading/error from an empty stale set and retries', async () => {
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="mktg-downstream-loading"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="mktg-downstream-card"]')).toBeNull();
    reads[0].error(new Error('unavailable'));
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="mktg-downstream-error"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="mktg-downstream-card"]')?.classList.contains('bg-amber-50')).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-testid="mktg-downstream-retry"] button')?.click();
    await fixture.whenStable();
    reads[1].next(listing());
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="mktg-downstream-copy"]')).not.toBeNull();
  });
  it('disables the action without write access and during impersonation', async () => {
    reads[0].next(listing());
    fixture.componentRef.setInput('writer', false);
    await fixture.whenStable();
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="mktg-downstream-rebuild"] button');
    expect(button?.disabled).toBe(true);
    fixture.componentRef.setInput('writer', true);
    impersonating.set(true);
    await fixture.whenStable();
    expect(button?.disabled).toBe(true);
  });
});
