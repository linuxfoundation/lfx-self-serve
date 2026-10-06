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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  let scrollIntoView: typeof HTMLElement.prototype.scrollIntoView;
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
  const openOptions = async (id: string) => {
    find(id)!.querySelector<HTMLElement>('[role="combobox"]')!.click();
    await settle();
    return Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'));
  };
  const chooseOption = async (id: string, label: string) => {
    const options = await openOptions(id);
    options.find((option) => option.textContent?.trim() === label)!.click();
    await settle();
  };
  afterEach(() => {
    fixture.destroy();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    vi.unstubAllGlobals();
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    scrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    // jsdom lacks browser APIs used by PrimeNG's real select overlays.
    vi.stubGlobal('matchMedia', (media: string) => ({
      matches: false,
      media,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: () => false,
    }));
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
  it('shows initial skeletons without refresh or empty messages, then confirmed empty', async () => {
    expect(find('my-newsletters-table')!.querySelector('.lfx-skeleton-row')).not.toBeNull();
    expect(find('my-newsletters-refresh-status')).toBeNull();
    expect(text()).not.toMatch(/No newsletters yet|No results found/);
    await respond({ newsletters: [], complete: true });
    expect(find('my-newsletters-empty-state')!.textContent).toContain('Join a group');
  });
  it.each([false, null, true])('keeps rendered rows, options and %s completeness throughout a pending retry', async (complete) => {
    await respond(complete === null ? [row()] : { newsletters: [row()], complete });
    const previousRows = fixture.componentInstance.myNewsletters();
    feed = new Subject();
    gateway.getMyNewsletters.mockReturnValue(feed);
    if (complete === true) {
      fixture.componentInstance.onRetry();
      await settle();
    } else {
      await click('my-newsletters-retry');
    }

    expect(find('my-newsletters-row-issue')).not.toBeNull();
    expect(find('my-newsletters-row-issue')!.textContent).toContain('Child news');
    expect(fixture.componentInstance.complete()).toBe(complete);
    expect(fixture.componentInstance.loading()).toBe(true);
    expect(find('my-newsletters-refresh-status')?.getAttribute('role')).toBe('status');
    expect(find('my-newsletters-refresh-status')?.textContent).toContain('Refreshing newsletters…');
    expect(find('my-newsletters-table')!.querySelector('.lfx-skeleton-row')).toBeNull();
    expect(text()).not.toMatch(/No newsletters yet|No results found/);

    await new Promise((resolve) => setTimeout(resolve, 240));
    await settle();
    expect(find('my-newsletters-row-issue')?.textContent).toContain('Child news');
    const foundations = await openOptions('my-newsletters-foundation-filter');
    expect(foundations.map((option) => option.textContent?.trim())).toEqual(['All Foundations', 'Foundation']);
    foundations[0]!.click();
    await settle();
    const projects = await openOptions('my-newsletters-project-filter');
    expect(projects.map((option) => option.textContent?.trim())).toEqual(['All Projects', 'Child']);
    projects[0]!.click();
    await settle();
    expect(fixture.componentInstance.myNewsletters()).toBe(previousRows);
    expect(fixture.componentInstance.complete()).toBe(complete);
    expect(find('my-newsletters-row-issue')).not.toBeNull();
    await respond({ newsletters: [row()], complete: true });
    expect(find('my-newsletters-refresh-status')).toBeNull();
  });
  it('replaces retained rows on success, including a confirmed empty response', async () => {
    await respond({ newsletters: [row()], complete: false });
    feed = new Subject();
    gateway.getMyNewsletters.mockReturnValue(feed);
    await click('my-newsletters-retry');
    expect(find('my-newsletters-row-issue')).not.toBeNull();
    await respond({
      newsletters: [row({ id: 'replacement', subject: 'Replacement news', project_uid: 'new-child', project_name: 'New child' })],
      complete: true,
    });
    expect(find('my-newsletters-row-issue')).toBeNull();
    expect(find('my-newsletters-row-replacement')?.textContent).toContain('Replacement news');
    expect(fixture.componentInstance.myNewsletters().map((newsletter) => newsletter.id)).toEqual(['replacement']);
    expect(find('my-newsletters-refresh-status')).toBeNull();
    const projects = await openOptions('my-newsletters-project-filter');
    expect(projects.map((option) => option.textContent?.trim())).toEqual(['All Projects', 'New child']);
    projects[0]!.click();
    await settle();

    feed = new Subject();
    gateway.getMyNewsletters.mockReturnValue(feed);
    fixture.componentInstance.onRetry();
    await settle();
    expect(find('my-newsletters-row-replacement')).not.toBeNull();
    await respond({ newsletters: [], complete: true });
    expect(find('my-newsletters-empty-state')?.textContent).toContain('No newsletters yet');
    expect(find('my-newsletters-row-replacement')).toBeNull();
    expect(find('my-newsletters-refresh-status')).toBeNull();
    expect(find('my-newsletters-foundation-filter')).toBeNull();
    expect(find('my-newsletters-project-filter')).toBeNull();
    expect(fixture.componentInstance.myNewsletters()).toEqual([]);
    expect(fixture.componentInstance.complete()).toBe(true);
  });
  it('preserves rendered search and filter selections during and after an asynchronous retry', async () => {
    await respond({ newsletters: [row(), row({ id: 'sibling', project_uid: 'sibling', project_name: 'Sibling', subject: 'Sibling news' })], complete: false });
    await chooseOption('my-newsletters-foundation-filter', 'Foundation');
    await chooseOption('my-newsletters-project-filter', 'Child');
    const input = find('my-newsletters-search-input')!.querySelector<HTMLInputElement>('input')!;
    input.value = 'Child';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 220));
    await settle();
    expect(find('my-newsletters-row-issue')).not.toBeNull();
    expect(find('my-newsletters-row-sibling')).toBeNull();

    feed = new Subject();
    gateway.getMyNewsletters.mockReturnValue(feed);
    await click('my-newsletters-retry');
    expect(find('my-newsletters-row-issue')).not.toBeNull();
    expect(find('my-newsletters-search-input')!.querySelector<HTMLInputElement>('input')!.value).toBe('Child');
    expect(find('my-newsletters-foundation-filter')?.querySelector('[role="combobox"]')?.textContent).toContain('Foundation');
    expect(find('my-newsletters-project-filter')?.querySelector('[role="combobox"]')?.textContent).toContain('Child');
    expect(fixture.componentInstance.searchForm.getRawValue()).toEqual({ search: 'Child', foundationFilter: 'foundation', projectFilter: 'child' });
    await respond({ newsletters: [row({ id: 'updated', subject: 'Child updated' })], complete: true });
    expect(find('my-newsletters-row-issue')).toBeNull();
    expect(find('my-newsletters-row-updated')?.textContent).toContain('Child updated');
    expect(find('my-newsletters-search-input')!.querySelector<HTMLInputElement>('input')!.value).toBe('Child');
    expect(find('my-newsletters-foundation-filter')?.querySelector('[role="combobox"]')?.textContent).toContain('Foundation');
    expect(find('my-newsletters-project-filter')?.querySelector('[role="combobox"]')?.textContent).toContain('Child');
    expect(fixture.componentInstance.searchForm.getRawValue()).toEqual({ search: 'Child', foundationFilter: 'foundation', projectFilter: 'child' });
  });
  it('clears retained rows on failed refresh and keeps URL resolution gated while pending or failed', async () => {
    await respond({ newsletters: [row()], complete: false });
    feed = new Subject();
    gateway.getMyNewsletters.mockReturnValue(feed);
    await click('my-newsletters-retry');
    params.next(convertToParamMap({ issue: 'absent', project: 'other' }));
    await settle();
    expect(find('my-newsletters-row-issue')).not.toBeNull();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(gateway.getNewsletter).not.toHaveBeenCalled();
    feed.error(new Error('Refresh unavailable'));
    await settle();
    expect(find('my-newsletters-error')?.textContent).toContain('Could not load newsletters');
    expect(find('my-newsletters-row-issue')).toBeNull();
    expect(find('my-newsletters-refresh-status')).toBeNull();
    expect(find('my-newsletters-foundation-filter')).toBeNull();
    expect(find('my-newsletters-project-filter')).toBeNull();
    expect(fixture.componentInstance.myNewsletters()).toEqual([]);
    expect(fixture.componentInstance.complete()).toBeNull();
    expect(fixture.componentInstance.loading()).toBe(false);
    expect(router.navigate).not.toHaveBeenCalled();
    expect(text()).not.toContain('No newsletters yet');

    feed = new Subject();
    gateway.getMyNewsletters.mockReturnValue(feed);
    await click('my-newsletters-error');
    expect(find('my-newsletters-table')!.querySelector('.lfx-skeleton-row')).not.toBeNull();
    expect(find('my-newsletters-row-issue')).toBeNull();
    expect(find('my-newsletters-refresh-status')).toBeNull();
    expect(router.navigate).not.toHaveBeenCalled();
    feed.error(new Error('Retry unavailable'));
    await settle();
    expect(find('my-newsletters-error')).not.toBeNull();
    expect(fixture.componentInstance.myNewsletters()).toEqual([]);
    expect(router.navigate).not.toHaveBeenCalled();
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
  it.each([
    { complete: false, withRows: false },
    { complete: null, withRows: false },
    { complete: false, withRows: true },
    { complete: null, withRows: true },
  ])('preserves a missing issue link until DOM Retry recovers (complete=$complete, withRows=$withRows)', async ({ complete, withRows }) => {
    params.next(convertToParamMap({ issue: 'issue', project: 'child-slug', keep: 'yes' }));
    await settle();
    expect(router.navigate).not.toHaveBeenCalled();
    const newsletters = withRows ? [row({ id: 'other', subject: 'Other news' })] : [];
    await respond(complete === null ? newsletters : { newsletters, complete });

    expect(router.navigate).not.toHaveBeenCalled();
    expect([params.value.get('issue'), params.value.get('project'), params.value.get('keep')]).toEqual(['issue', 'child-slug', 'yes']);
    expect(gateway.getNewsletter).not.toHaveBeenCalled();
    expect(overlay('newsletter-preview-drawer-body')).toBeNull();
    expect(find('my-newsletters-completeness-notice')?.textContent).toContain(
      complete === false ? 'Some newsletters could not be loaded' : "We couldn't verify that this list is complete"
    );
    expect(find('my-newsletters-row-other') !== null).toBe(withRows);

    feed = new Subject();
    gateway.getMyNewsletters.mockReturnValue(feed);
    await click('my-newsletters-retry');
    expect(router.navigate).not.toHaveBeenCalled();
    await respond({ newsletters: [row()], complete: true });
    expect(gateway.getNewsletter).toHaveBeenCalledWith('child', 'issue');
    expect(overlay('newsletter-preview-drawer-body')?.textContent).toContain('Rendered body');
    expect(overlay('newsletter-preview-drawer-header')?.textContent).toContain('Child');
    expect(router.navigate).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { issue: 'issue', project: 'child-slug' }, queryParamsHandling: 'merge', preserveFragment: true })
    );
  });
  it.each([false, null])('opens a matching issue from a %s feed without waiting for completeness', async (complete) => {
    params.next(convertToParamMap({ issue: 'issue', project: 'child-slug', keep: 'yes' }));
    await settle();
    expect(gateway.getNewsletter).not.toHaveBeenCalled();
    await respond(complete === null ? [row()] : { newsletters: [row()], complete });

    expect(fixture.componentInstance.complete()).toBe(complete);
    expect(gateway.getNewsletter).toHaveBeenCalledWith('child', 'issue');
    expect(overlay('newsletter-preview-drawer-body')?.textContent).toContain('Rendered body');
    expect(router.navigate).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { issue: 'issue', project: 'child-slug' }, queryParamsHandling: 'merge', preserveFragment: true })
    );
  });
  it.each([false, null])('keeps zero-row %s responses unconfirmed and retryable', async (complete) => {
    await respond(complete === null ? [] : { newsletters: [], complete });
    expect(find('my-newsletters-completeness-notice')!.textContent).toContain(
      complete === false ? 'Some newsletters could not be loaded' : "We couldn't verify that this list is complete"
    );
    expect(text()).not.toMatch(/No newsletters yet|No results found/);
    feed = new Subject();
    gateway.getMyNewsletters.mockReturnValue(feed);
    await click('my-newsletters-retry');
    expect(find('my-newsletters-table')!.querySelector('.lfx-skeleton-row')).not.toBeNull();
    expect(find('my-newsletters-refresh-status')).toBeNull();
    expect(text()).not.toMatch(/No newsletters yet|No results found/);
    await respond({ newsletters: [row()], complete: true });
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
