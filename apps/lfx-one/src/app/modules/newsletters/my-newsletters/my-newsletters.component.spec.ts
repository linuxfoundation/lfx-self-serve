// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MyNewsletter, MyNewslettersApiResponse } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { PersonaService } from '@services/persona.service';
import { ClipboardShareService } from '@services/clipboard-share.service';
import { SelectComponent } from '@components/select/select.component';
import { MessageService } from 'primeng/api';
import { BehaviorSubject, Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MyNewslettersComponent } from './my-newsletters.component';

function row(overrides: Partial<MyNewsletter> = {}): MyNewsletter {
  return {
    id: 'issue',
    project_uid: 'child',
    subject: 'Child news',
    project_slug: 'child-slug',
    project_name: 'Child',
    is_foundation: false,
    parent_project_uid: 'foundation',
    parent_project_name: 'Foundation',
    parent_is_foundation: true,
    sent_at: '2026-08-13T10:00:00Z',
    ...overrides,
  };
}

describe('MyNewslettersComponent', () => {
  let fixture: ComponentFixture<MyNewslettersComponent>;
  let feed: Subject<MyNewslettersApiResponse>;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  const gateway = { getMyNewsletters: vi.fn(), getNewsletter: vi.fn() };
  const router = { navigate: vi.fn() };
  const messages = { add: vi.fn() };
  const clipboard = { copyLink: vi.fn() };
  const find = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  // PrimeNG moves the drawer overlay outside the fixture into document.body.
  const overlay = (id: string): HTMLElement | null => document.body.querySelector(`[data-testid="${id}"]`);
  const text = () => (fixture.nativeElement as HTMLElement).textContent!;
  const settle = () => fixture.whenStable();
  const respond = async (response: MyNewslettersApiResponse) => {
    feed.next(response);
    await settle();
  };
  const click = async (id: string) => {
    find(id)!.querySelector<HTMLButtonElement>('button')!.click();
    await settle();
  };
  beforeEach(async () => {
    vi.clearAllMocks();
    feed = new Subject();
    params = new BehaviorSubject(convertToParamMap({}));
    gateway.getMyNewsletters.mockReturnValue(feed);
    gateway.getNewsletter.mockReturnValue(of({ body_html: '<p>Rendered body</p>' }));
    await TestBed.configureTestingModule({
      imports: [MyNewslettersComponent],
      providers: [
        provideNoopAnimations(),
        { provide: NewsletterService, useValue: gateway },
        { provide: PersonaService, useValue: { personaLoaded: signal(true) } },
        { provide: ActivatedRoute, useValue: { queryParamMap: params } },
        { provide: Router, useValue: router },
        { provide: MessageService, useValue: messages },
        { provide: ClipboardShareService, useValue: clipboard },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MyNewslettersComponent);
    await settle();
  });
  it('shows loading without either empty message, then confirmed empty', async () => {
    expect(find('my-newsletters-table')).not.toBeNull();
    expect(text()).not.toMatch(/No newsletters yet|No results found/);
    await respond({ newsletters: [], complete: true });
    expect(find('my-newsletters-empty-state')!.textContent).toContain('Join a group');
  });
  it('gates URL resolution during errors and recovers through the DOM Retry', async () => {
    params.next(convertToParamMap({ issue: 'issue', project: 'child-slug', keep: 'yes' }));
    await settle();
    expect(router.navigate).not.toHaveBeenCalled();
    feed.error(new Error('Unavailable'));
    await settle();
    expect(find('my-newsletters-error')!.textContent).toContain('Could not load newsletters');
    expect(text()).not.toContain('No newsletters yet');
    expect(router.navigate).not.toHaveBeenCalled();
    feed = new Subject();
    gateway.getMyNewsletters.mockReturnValue(feed);
    await click('my-newsletters-error');
    expect(find('my-newsletters-error')).toBeNull();
    expect(router.navigate).not.toHaveBeenCalled();
    await respond({ newsletters: [row()], complete: true });
    expect(gateway.getMyNewsletters).toHaveBeenCalledTimes(2);
    expect(gateway.getNewsletter).toHaveBeenCalledWith('child', 'issue');
    expect(overlay('newsletter-preview-drawer-body')!.textContent).toContain('Rendered body');
  });
  it.each([false, null])('keeps zero-row %s responses unconfirmed and retryable', async (complete) => {
    await respond(complete === null ? [] : { newsletters: [], complete });
    expect(find('my-newsletters-completeness-notice')!.textContent).toContain(
      complete === false ? 'Some newsletters could not be loaded' : "We couldn't verify that this list is complete"
    );
    expect(text()).not.toMatch(/No newsletters yet|No results found/);
    gateway.getMyNewsletters.mockReturnValue(of({ newsletters: [row()], complete: true }));
    await click('my-newsletters-retry');
    expect(find('my-newsletters-row-issue')).not.toBeNull();
    expect(find('my-newsletters-completeness-notice')).toBeNull();
  });
  it.each([false, null])('retains healthy rows and the %s notice through filter misses', async (complete) => {
    await respond(complete === null ? [row()] : { newsletters: [row()], complete });
    expect(find('my-newsletters-row-issue')).not.toBeNull();
    fixture.componentInstance.searchForm.controls.search.setValue('missing');
    await new Promise((resolve) => setTimeout(resolve, 220));
    await settle();
    expect(find('my-newsletters-no-results')!.textContent).toContain('Reset filters');
    gateway.getMyNewsletters.mockReturnValue(of(complete === null ? [row()] : { newsletters: [row()], complete }));
    await click('my-newsletters-retry');
    expect(fixture.componentInstance.searchForm.controls.search.value).toBe('missing');
    expect(find('my-newsletters-no-results')).not.toBeNull();
    await click('my-newsletters-no-results');
    expect(find('my-newsletters-row-issue')).not.toBeNull();
    expect(find('my-newsletters-completeness-notice')).not.toBeNull();
    expect(gateway.getMyNewsletters).toHaveBeenCalledTimes(2);
  });
  it('cancels superseded requests and ignores late results', async () => {
    const cancelled = vi.fn();
    gateway.getMyNewsletters.mockReturnValue(new Observable(() => cancelled));
    fixture.componentInstance.onRetry();
    fixture.componentInstance.onRetry();
    expect(cancelled).toHaveBeenCalledTimes(1);
    await respond({ newsletters: [row()], complete: true });
    expect(fixture.componentInstance.loading()).toBe(true);
  });
  it('offers confirmed child-only foundations, sorted/deduped, and excludes unresolved metadata', async () => {
    await respond({
      newsletters: [
        row(),
        row({ id: 'duplicate' }),
        row({ id: 'other', project_uid: 'other', parent_project_uid: 'alpha', parent_project_name: 'Alpha' }),
        row({
          id: 'unknown',
          project_uid: 'unknown',
          project_slug: undefined,
          is_foundation: undefined,
          parent_project_uid: undefined,
          parent_is_foundation: undefined,
        }),
        row({ id: 'not-foundation', parent_is_foundation: false, parent_project_uid: 'ordinary' }),
      ],
      complete: true,
    });
    const select = (id: string) => fixture.debugElement.query(By.css(`[data-testid="${id}"]`)).componentInstance as SelectComponent;
    expect(select('my-newsletters-foundation-filter').options()).toEqual([
      { label: 'All Foundations', value: null },
      { label: 'Alpha', value: 'alpha' },
      { label: 'Foundation', value: 'foundation' },
    ]);
    expect(
      select('my-newsletters-project-filter')
        .options()
        .map((option) => option.value)
    ).not.toContain('unknown');
    expect(find('my-newsletters-open-unknown')!.tagName).toBe('BUTTON');
    select('my-newsletters-project-filter').onChange.emit({ value: 'other' });
    select('my-newsletters-foundation-filter').onChange.emit({ value: 'foundation' });
    await settle();
    expect(fixture.componentInstance.searchForm.controls.projectFilter.value).toBeNull();
    expect(find('my-newsletters-row-issue')).not.toBeNull();
    expect(find('my-newsletters-row-other')).toBeNull();
    expect(find('my-newsletters-row-unknown')).toBeNull();
    gateway.getMyNewsletters.mockReturnValue(of({ newsletters: [row()], complete: true }));
    fixture.componentInstance.onRetry();
    await settle();
    expect(find('my-newsletters-row-issue')).not.toBeNull();
    expect(
      select('my-newsletters-project-filter')
        .options()
        .map((option) => option.value)
    ).toEqual([null, 'child']);
  });
  it('preserves Sent dates, native links, owner fetch, sharing, close and browser Back', async () => {
    await respond({ newsletters: [row()], complete: true });
    expect(text()).toContain('Sent');
    expect(text()).not.toContain('Received');
    const link = find('my-newsletters-open-issue')!;
    expect(link.getAttribute('href')).toBe('/newsletters/child-slug/issue');
    const modified = new MouseEvent('click', { metaKey: true, bubbles: true, cancelable: true });
    link.dispatchEvent(modified);
    expect(modified.defaultPrevented).toBe(false);
    expect(gateway.getNewsletter).not.toHaveBeenCalled();
    link.click();
    await settle();
    expect(gateway.getNewsletter).toHaveBeenCalledWith('child', 'issue');
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { issue: 'issue', project: 'child-slug' }, queryParamsHandling: 'merge', preserveFragment: true })
    );
    expect(overlay('newsletter-preview-drawer-header')!.textContent).toContain('Sent Aug 13, 2026');
    overlay('newsletter-preview-drawer-copy-link')!.click();
    expect(clipboard.copyLink).toHaveBeenCalledWith(expect.stringContaining('/newsletters/child-slug/issue'), 'Newsletter link copied to clipboard.');
    expect(overlay('newsletter-preview-drawer-open-new-tab')!.getAttribute('target')).toBe('_blank');
    overlay('newsletter-preview-drawer-close')!.click();
    await settle();
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { issue: null, project: null }, queryParamsHandling: 'merge', preserveFragment: true })
    );
    params.next(convertToParamMap({ issue: 'issue', project: 'child-slug' }));
    await settle();
    expect(fixture.componentInstance['previewVisible']()).toBe(true);
    params.next(convertToParamMap({}));
    await settle();
    expect(fixture.componentInstance['previewVisible']()).toBe(false);
  });
  it('preserves canonical absence fallback and body-fetch error handling', async () => {
    await respond({ newsletters: [row()], complete: true });
    params.next(convertToParamMap({ issue: 'absent', project: 'other' }));
    await settle();
    expect(router.navigate).toHaveBeenCalledWith(['/newsletters', 'other', 'absent']);
    params.next(convertToParamMap({}));
    gateway.getNewsletter.mockReturnValue(throwError(() => new Error('Body failure')));
    find('my-newsletters-open-issue')!.click();
    await settle();
    expect(messages.add).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Unable to open newsletter' }));
    expect(fixture.componentInstance['previewVisible']()).toBe(false);
  });
});
