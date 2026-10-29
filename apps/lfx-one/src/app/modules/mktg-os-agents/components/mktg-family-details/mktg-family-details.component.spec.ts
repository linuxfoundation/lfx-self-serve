// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MKTG_DOCUMENT_TYPES } from '@lfx-one/shared/constants';
import { MktgRevisionResponse } from '@lfx-one/shared/interfaces';
import { resolveMktgKit } from '@lfx-one/shared/utils';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MktgFamilyDetailsComponent } from './mktg-family-details.component';

const revisionId = '000003-' + 'a'.repeat(64);
function family() {
  return resolveMktgKit({
    project: 'synthetic',
    groups: MKTG_DOCUMENT_TYPES.map((type) => ({
      type,
      documents:
        type.agentKey === 'foundation-message'
          ? [
              {
                agentKey: type.agentKey,
                documentId: 'living',
                revisionCount: 9,
                latestRevisionId: revisionId,
                approvedCurrent: null,
                createdAt: null,
                updatedAt: null,
              },
            ]
          : [],
    })),
  })[0];
}
function revision(): MktgRevisionResponse {
  return {
    project: 'synthetic',
    type: MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === 'foundation-message') ?? MKTG_DOCUMENT_TYPES[0],
    documentId: 'living',
    approvedCurrent: null,
    approval: null,
    revisions: [],
    markdown: '{}',
    sidecar: { report: { sources_read: ['project.example'], sources_failed: [{ name: 'README', reason: 'Timed out' }] } },
    revision: {
      id: revisionId,
      number: 3,
      createdAt: null,
      origin: 'generated',
      restoredFromNumber: null,
      intakeMode: 'form',
      status: '',
      contentSha256: 'a'.repeat(64),
      format: 'json',
      commentCount: 0,
      latest: true,
      approval: null,
    },
  };
}

describe('Family-only source details', () => {
  let getRevision: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    getRevision = vi.fn(() => of(revision()));
    TestBed.configureTestingModule({ imports: [MktgFamilyDetailsComponent], providers: [{ provide: MktgDocumentStoreService, useValue: { getRevision } }] });
  });
  function create() {
    const fixture = TestBed.createComponent(MktgFamilyDetailsComponent);
    fixture.componentRef.setInput('family', family());
    fixture.componentRef.setInput('projectUid', 'synthetic');
    return fixture;
  }
  it('collapses sources to an honest summary line with accessible Show and Hide', async () => {
    const fixture = create();
    await fixture.whenStable();
    expect(getRevision).toHaveBeenCalledWith('synthetic', 'foundation-message', 'living', revisionId);
    const root: HTMLElement = fixture.nativeElement;
    const sourceToggle = root.querySelector<HTMLButtonElement>('[data-testid="mktg-family-sources-toggle"] button');
    const list = root.querySelector('#mktg-family-sources-list');
    expect(root.querySelector('h2')?.textContent?.replace(/\s+/g, ' ')).toContain('Where it comes from · 1 source read · 1 source failed');
    expect(list?.classList.contains('hidden')).toBe(true);
    expect(sourceToggle?.getAttribute('aria-controls')).toBe(list?.id);
    expect(sourceToggle?.getAttribute('aria-expanded')).toBe('false');
    sourceToggle?.click();
    await fixture.whenStable();
    expect(sourceToggle?.textContent).toContain('Hide');
    expect(sourceToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(list?.classList.contains('hidden')).toBe(false);
    expect(list?.textContent).toContain('Sources read on the last run: project.example.');
    expect(list?.textContent).toContain('README: Timed out');
    sourceToggle?.click();
    await fixture.whenStable();
    expect(list?.classList.contains('hidden')).toBe(true);
  });
  it('omits the entire roadmap Sign-off section, toggle and dated copy', async () => {
    const fixture = create();
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="mktg-family-approve"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-family-sign-off-toggle"]')).toBeNull();
    expect(root.querySelector('#mktg-family-sign-off-text')).toBeNull();
    expect(root.textContent).not.toContain('Sign-off');
    expect(root.textContent).not.toContain('October');
    expect(root.textContent).not.toContain('November');
  });
  it('restores the whole roadmap and its accessible toggle when the shared flag projection is true', async () => {
    const fixture = create();
    // The Angular runner bundles shared constants: override only their component
    // projection before first render, without adding a product override API.
    Object.defineProperty(fixture.componentInstance, 'showComingSoon', { value: true });
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const section = root.querySelector('[data-testid="mktg-family-approve"]');
    const toggle = section?.querySelector<HTMLButtonElement>('[data-testid="mktg-family-sign-off-toggle"] button');
    const text = section?.querySelector('#mktg-family-sign-off-text');
    expect(section?.querySelector('h2')?.textContent).toContain('Sign-off');
    expect(section?.textContent).toContain('two-role sign-off arrives in November');
    expect(text?.textContent).toContain('Any project writer approves an asset in October.');
    expect(toggle?.getAttribute('aria-controls')).toBe(text?.id);
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(text?.classList.contains('hidden')).toBe(true);
    toggle?.click();
    await fixture.whenStable();
    expect(toggle?.textContent).toContain('Hide');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(text?.classList.contains('hidden')).toBe(false);
    toggle?.click();
    await fixture.whenStable();
    expect(toggle?.textContent).toContain('Show');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(text?.classList.contains('hidden')).toBe(true);
  });
  it('keeps Sources and Sign-off expanded across two equivalent listing refreshes without refetching or flashing loading', async () => {
    const fixture = create();
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    root.querySelector<HTMLButtonElement>('[data-testid="mktg-family-sources-toggle"] button')?.click();
    root.querySelector<HTMLButtonElement>('[data-testid="mktg-family-sign-off-toggle"] button')?.click();
    await fixture.whenStable();
    const sources = root.querySelector('#mktg-family-sources-list');
    const signOff = root.querySelector('#mktg-family-sign-off-text');
    for (let refresh = 0; refresh < 2; refresh++) {
      fixture.componentRef.setInput('family', family()); // The same server listing produces a new Family view object.
      await fixture.whenStable();
      expect(getRevision).toHaveBeenCalledExactlyOnceWith('synthetic', 'foundation-message', 'living', revisionId);
      expect(root.querySelector('#mktg-family-sources-list')).toBe(sources);
      expect(root.querySelector('#mktg-family-sign-off-text')).toBe(signOff);
      expect(sources?.classList.contains('hidden')).toBe(false);
      expect(signOff?.classList.contains('hidden')).toBe(false);
      expect(root.querySelector('[data-testid="mktg-family-sources-toggle"] button')?.getAttribute('aria-expanded')).toBe('true');
      expect(root.querySelector('[data-testid="mktg-family-sign-off-toggle"] button')?.getAttribute('aria-expanded')).toBe('true');
      expect(fixture.componentInstance['loading']()).toBe(false);
      expect(fixture.componentInstance['sources']()).not.toBeNull();
    }
  });

  it('still re-reads and resets details when the framework revision changes', async () => {
    const fixture = create();
    await fixture.whenStable();
    fixture.nativeElement.querySelector('[data-testid="mktg-family-sources-toggle"] button').click();
    await fixture.whenStable();
    const nextRevisionId = '000004-' + 'b'.repeat(64);
    const view = family();
    fixture.componentRef.setInput('family', {
      ...view,
      rows: view.rows.map((row) => ({ ...row, document: row.document ? { ...row.document, latestRevisionId: nextRevisionId } : null })),
    });
    await fixture.whenStable();
    expect(getRevision).toHaveBeenCalledTimes(2);
    expect(getRevision).toHaveBeenLastCalledWith('synthetic', 'foundation-message', 'living', nextRevisionId);
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-family-sources-toggle"] button')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('omits sources with no document or no report, never faking a source list', async () => {
    getRevision.mockReturnValue(of({ ...revision(), sidecar: null }));
    const fixture = create();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-family-sources"]')).toBeNull();
    fixture.componentRef.setInput('family', { ...family(), rows: [] });
    await fixture.whenStable();
    expect(getRevision).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-family-approve"]')).toBeNull();
  });
  it('keeps loading/error separate and retries without revealing roadmap copy', async () => {
    getRevision.mockReturnValue(new Subject<MktgRevisionResponse>());
    const fixture = create();
    await fixture.whenStable();
    const status = fixture.nativeElement.querySelector('[role="status"]');
    expect(status?.textContent).toContain('Loading source details');
    getRevision.mockReturnValue(throwError(() => new Error('synthetic read error')));
    fixture.componentRef.setInput('projectUid', 'other');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBe(status);
    expect(status?.textContent).toBe('');
    getRevision.mockReturnValue(of(revision()));
    fixture.nativeElement.querySelector('[data-testid="mktg-family-sources-retry"] button').click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-family-sources"]')).not.toBeNull();
  });
  it('reads only the framework row, ignores discarded-row failures and cancels the old scope', async () => {
    const view = family();
    const document = view.rows[0].document;
    if (!document) throw new Error('Synthetic framework document missing');
    const other = {
      ...view.rows[0],
      asset: { id: 'brand-extra', label: 'Brand kit', description: '', agentKey: 'brand-kit' as const },
      document: { ...document, agentKey: 'brand-kit' as const },
    };
    const old = new Subject<MktgRevisionResponse>();
    getRevision.mockImplementation((_project: string, key: string) =>
      key === 'foundation-message' ? old : throwError(() => new Error('An unrelated read must not happen'))
    );
    const fixture = create();
    fixture.componentRef.setInput('family', { ...view, rows: [other, ...view.rows] });
    await fixture.whenStable();
    expect(getRevision).toHaveBeenCalledTimes(1);
    expect(getRevision).toHaveBeenCalledWith('synthetic', 'foundation-message', 'living', revisionId);
    getRevision.mockReturnValue(of({ ...revision(), sidecar: null }));
    fixture.componentRef.setInput('projectUid', 'other');
    await fixture.whenStable();
    old.next(revision());
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-family-sources"]')).toBeNull();
    fixture.componentRef.setInput('family', { ...view, rows: [other] });
    await fixture.whenStable();
    expect(getRevision).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });
  it('does not read during SSR', async () => {
    TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });
    const fixture = create();
    await fixture.whenStable();
    expect(getRevision).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-family-sources"]')).toBeNull();
  });
});
