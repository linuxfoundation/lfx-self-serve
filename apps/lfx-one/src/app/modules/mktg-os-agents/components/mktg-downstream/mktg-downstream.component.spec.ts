// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { MKTG_DOCUMENT_TYPES, MKTG_NOT_AVAILABLE_TEXT, MKTG_POLL_RETRYING_TEXT, MKTG_REBUILD_NAVIGATION_STATE_KEY } from '@lfx-one/shared/constants';
import { MktgDocumentsResponse, MktgRevisionRef } from '@lfx-one/shared/interfaces';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { UserService } from '@services/user.service';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MktgDownstreamComponent } from './mktg-downstream.component';

const reference: MktgRevisionRef = { agentKey: 'foundation-message', revisionId: `000003-${'c'.repeat(64)}`, revisionNumber: 3, contentSha256: 'd'.repeat(64) };
const listing = (stale = true, keys = ['boilerplates', 'faq']): MktgDocumentsResponse => ({
  project: 'synthetic-project',
  approvedFramework: reference,
  groups: MKTG_DOCUMENT_TYPES.filter((type) => keys.includes(type.agentKey)).map((type) => ({
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
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    // The read goes through the shared poller, which reads only in a visible tab.
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
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
    fixture.componentRef.setInput('projectSlug', 'synthetic-slug');
    fixture.componentRef.setInput('writer', true);
    await fixture.whenStable();
  });
  it('renders the board copy from the shared server projection and renders nothing when nothing is stale', async () => {
    reads[0].next(listing());
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="mktg-downstream-card"]')?.classList.contains('bg-amber-50')).toBe(true);
    expect(root.querySelector('[data-testid="mktg-downstream-copy"]')?.textContent).toContain('Boilerplates and FAQ were built from v1. Rebuild them from v3?');
    expect(root.querySelector('[data-testid="mktg-downstream-rebuild"]')?.textContent).toContain('Rebuild both');
    TestBed.inject(Router).resetConfig([{ path: '**', children: [] }]);
    await TestBed.inject(Router).navigateByUrl('/project/mktg-os-agents/documents/foundation-message/living?project=old-slug&tab=sources');
    fixture.componentRef.setInput('project', 'next-project');
    fixture.componentRef.setInput('projectSlug', 'next-slug');
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="mktg-downstream-loading"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="mktg-downstream-copy"]')).toBeNull();
    reads[1].next({ ...listing(), project: 'next-project' });
    await fixture.whenStable();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    root.querySelector<HTMLButtonElement>('[data-testid="mktg-downstream-rebuild"] button')?.click();
    expect(navigate).toHaveBeenCalledWith(
      ['/project/mktg-os-agents', 'families', 'positioning-brand'],
      expect.objectContaining({
        state: { [MKTG_REBUILD_NAVIGATION_STATE_KEY]: { project: 'next-project', frameworkRevisionId: reference.revisionId } },
        queryParams: { project: 'next-slug' },
      })
    );
    fixture.componentRef.setInput('refreshKey', 'new-approval');
    await fixture.whenStable();
    reads[2].next(listing(false));
    await fixture.whenStable();
    expect(root.children).toHaveLength(0);
    expect(root.textContent?.trim()).toBe('');
  });
  it('keeps content and focus without a skeleton during a refreshKey re-read, then updates in place', async () => {
    const settled = vi.fn();
    fixture.componentInstance.settled.subscribe(settled);
    reads[0].next(listing());
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const card = root.querySelector('[data-testid="mktg-downstream-card"]');
    const copy = root.querySelector('[data-testid="mktg-downstream-copy"]');
    const button = root.querySelector<HTMLButtonElement>('[data-testid="mktg-downstream-rebuild"] button');
    button?.focus();
    fixture.componentRef.setInput('refreshKey', 'new-approval');
    await fixture.whenStable();
    expect(reads).toHaveLength(2);
    expect(root.querySelector('[data-testid="mktg-downstream-loading"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-downstream-card"]')).toBe(card);
    expect(root.querySelector('[data-testid="mktg-downstream-copy"]')).toBe(copy);
    expect(copy?.textContent).toContain('Boilerplates and FAQ were built from v1');
    expect(root.querySelector('[data-testid="mktg-downstream-rebuild"] button')).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(settled.mock.calls).toEqual([[JSON.stringify(['synthetic-project', ''])]]);
    const updated = listing(true, ['faq']);
    reads[1].next({ ...updated, approvedFramework: { ...reference, revisionNumber: 4 } });
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="mktg-downstream-loading"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-downstream-card"]')).toBe(card);
    expect(root.querySelector('[data-testid="mktg-downstream-copy"]')).toBe(copy);
    expect(copy?.textContent).toBe('FAQ was built from v1. Rebuild it from v4?');
    expect(document.activeElement).toBe(button);
    expect(settled).toHaveBeenLastCalledWith(JSON.stringify(['synthetic-project', 'new-approval']));
  });
  it('keeps an answered empty listing empty during a same-project re-read', async () => {
    reads[0].next(listing(false));
    await fixture.whenStable();
    fixture.componentRef.setInput('refreshKey', 'new-approval');
    await fixture.whenStable();
    expect(reads).toHaveLength(2);
    expect((fixture.nativeElement as HTMLElement).children).toHaveLength(0);
    reads[1].next(listing());
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="mktg-downstream-copy"]')).not.toBeNull();
  });
  it('keeps the loaded listing usable under one grey line while a re-read cannot reach the server, with no button', async () => {
    reads[0].next(listing());
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const card = root.querySelector('[data-testid="mktg-downstream-card"]');
    fixture.componentRef.setInput('refreshKey', 'new-approval');
    await fixture.whenStable();
    reads[1].error(new HttpErrorResponse({ status: 503 }));
    await fixture.whenStable();
    const line = root.querySelector('[data-testid="mktg-downstream-retrying"]');
    expect(line?.textContent?.trim()).toBe(MKTG_POLL_RETRYING_TEXT);
    expect(line?.getAttribute('role')).toBe('status');
    expect(line?.className).toContain('text-gray-500');
    expect(root.querySelector('[data-testid="mktg-downstream-error"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-downstream-retry"]')).toBeNull();
    expect(root.textContent).not.toContain('Try again');
    expect(root.querySelector('[data-testid="mktg-downstream-card"]')).toBe(card);
    expect(root.querySelector('[data-testid="mktg-downstream-loading"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-downstream-copy"]')?.textContent).toContain('Boilerplates and FAQ were built from v1');
    expect(root.querySelector<HTMLButtonElement>('[data-testid="mktg-downstream-rebuild"] button')?.disabled).toBe(false);
    // The network coming back re-reads at once; the good read clears the line by itself.
    window.dispatchEvent(new Event('online'));
    expect(reads).toHaveLength(3);
    reads[2].next(listing(false));
    await fixture.whenStable();
    expect(root.children).toHaveLength(0);
  });
  it('formats three stale names as an English conjunction list', async () => {
    const data = listing(true, ['boilerplates', 'faq', 'brand-kit']);
    reads[0].next(data);
    await fixture.whenStable();
    const names = data.groups.map((group) => group.type.label);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(`${names[0]}, ${names[1]}, and ${names[2]} were built from v1`);
  });
  it('opened offline: the grey line sits over the skeleton, the host is told, and the next good read replaces both', async () => {
    const root: HTMLElement = fixture.nativeElement;
    const settled = vi.fn();
    fixture.componentInstance.settled.subscribe(settled);
    expect(root.querySelector('[data-testid="mktg-downstream-loading"]')?.querySelectorAll('[data-testid="mktg-skeleton-row"]')).toHaveLength(2);
    const card = root.querySelector('[data-testid="mktg-downstream-card"]');
    expect(card?.classList.contains('min-h-56')).toBe(true);
    reads[0].error(new HttpErrorResponse({ status: 0 }));
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="mktg-downstream-retrying"]')?.textContent).toContain(MKTG_POLL_RETRYING_TEXT);
    expect(root.querySelector('[data-testid="mktg-downstream-loading"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="mktg-downstream-error"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-downstream-retry"]')).toBeNull();
    // The host's rail does not wait for the server: the card already has its state to show.
    expect(settled).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('online'));
    reads[1].next(listing());
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="mktg-downstream-retrying"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-downstream-copy"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="mktg-downstream-card"]')).toBe(card);
    expect(card?.classList.contains('min-h-56')).toBe(false);
  });
  it('shows a final refusal as one red line that names what is not available, with no Retry', async () => {
    const root: HTMLElement = fixture.nativeElement;
    reads[0].error(new HttpErrorResponse({ status: 404 }));
    await fixture.whenStable();
    const alert = root.querySelector('[data-testid="mktg-downstream-error"]');
    expect(alert?.textContent?.trim()).toBe(MKTG_NOT_AVAILABLE_TEXT.downstream);
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.className).toContain('text-red-700');
    expect(root.querySelector('[data-testid="mktg-downstream-retrying"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-downstream-retry"]')).toBeNull();
    expect(root.querySelector('button')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-downstream-card"]')?.classList.contains('bg-amber-50')).toBe(false);
    window.dispatchEvent(new Event('online'));
    expect(reads).toHaveLength(1);
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
