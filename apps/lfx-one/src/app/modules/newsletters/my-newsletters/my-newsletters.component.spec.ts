// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MyNewsletter, MyNewsletterFoundation, MyNewsletterFoundationsResponse, NewsletterGroupJoinStatus } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { PersonaService } from '@services/persona.service';
import { SelectComponent } from '@components/select/select.component';
import { DialogService } from 'primeng/dynamicdialog';
import { BehaviorSubject, Observable, of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NewsletterInviteDialogComponent } from '../components/newsletter-invite-dialog/newsletter-invite-dialog.component';
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
    foundation_uid: 'foundation',
    foundation_slug: 'foundation-slug',
    foundation_name: 'Foundation',
    sent_at: '2026-08-13T10:00:00Z',
    ...overrides,
  };
}

function card(overrides: Partial<MyNewsletterFoundation> = {}): MyNewsletterFoundation {
  return {
    uid: 'foundation',
    slug: 'foundation-slug',
    name: 'Foundation',
    logo_url: null,
    received_count: 1,
    last_sent_at: '2026-08-13T10:00:00Z',
    newsletter_group: { uid: 'group', name: 'Foundation Newsletter' },
    can_invite: false,
    membership_name: 'Foundation',
    invite_denied_reason: 'not_member_company',
    ...overrides,
  };
}

function feedOf(newsletters: MyNewsletter[], complete: boolean, foundations: MyNewsletterFoundation[] = [card()]): MyNewsletterFoundationsResponse {
  return { foundations, newsletters, complete, inviter: { eligible: true, company_name: 'Acme Motors' } };
}

describe('MyNewslettersComponent', () => {
  let fixture: ComponentFixture<MyNewslettersComponent>;
  let feed: Subject<MyNewsletterFoundationsResponse>;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let routeParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let navigate: ReturnType<typeof vi.fn>;
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let scrollIntoView: typeof HTMLElement.prototype.scrollIntoView;
  const gateway = {
    getMyNewsletterFoundations: vi.fn(),
    getNewsletterGroupJoinStatus: vi.fn(),
    joinNewsletterGroupByInvite: vi.fn(),
  };
  const dialog = { open: vi.fn() };
  const find = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  const text = () => (fixture.nativeElement as HTMLElement).textContent!;
  const settle = () => fixture.whenStable();
  const respond = async (response: MyNewsletterFoundationsResponse) => {
    feed.next(response);
    await settle();
  };
  const nextFeed = () => {
    feed = new Subject();
    gateway.getMyNewsletterFoundations.mockReturnValue(feed);
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
    vi.restoreAllMocks();
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
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
    nextFeed();
    params = new BehaviorSubject(convertToParamMap({}));
    routeParams = new BehaviorSubject(convertToParamMap({ foundationSlug: 'foundation-slug' }));
    gateway.getNewsletterGroupJoinStatus.mockReturnValue(new Subject<NewsletterGroupJoinStatus>());
    await TestBed.configureTestingModule({
      imports: [MyNewslettersComponent],
      providers: [
        provideNoopAnimations(),
        // A real router so the header's back RouterLink renders; navigation itself is spied below.
        provideRouter([]),
        { provide: NewsletterService, useValue: gateway },
        { provide: PersonaService, useValue: { personaLoaded: signal(true) } },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: routeParams, queryParamMap: params, snapshot: { paramMap: routeParams.value } },
        },
      ],
    })
      .overrideComponent(MyNewslettersComponent, { set: { providers: [{ provide: DialogService, useValue: dialog }] } })
      .compileComponents();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as unknown as ReturnType<typeof vi.fn>;
    // RouterLink clicks also land here, so link and row clicks are both observable.
    navigateByUrl = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true) as unknown as ReturnType<typeof vi.fn>;
    fixture = TestBed.createComponent(MyNewslettersComponent);
    await settle();
  });
  it('shows initial skeletons without refresh or empty messages, then confirmed empty', async () => {
    expect(find('my-newsletters-table')!.querySelector('.lfx-skeleton-row')).not.toBeNull();
    expect(find('my-newsletters-refresh-status')).toBeNull();
    expect(text()).not.toMatch(/No newsletters yet|No results found/);
    await respond(feedOf([], true));
    expect(find('my-newsletters-empty-state')!.textContent).toContain('Issues you receive from this foundation will appear here.');
  });
  it('heads the page with the foundation and links back to the foundation cards', async () => {
    expect(find('my-newsletters-title')?.textContent).toContain('Newsletters');
    await respond(feedOf([row()], true));
    expect(find('my-newsletters-title')?.textContent).toContain('Foundation');
    expect(find('my-newsletters-back')?.getAttribute('href')).toBe('/newsletters/my');
    expect(find('my-newsletters-breadcrumb')?.getAttribute('aria-label')).toBe('Breadcrumb');
    expect(find('my-newsletters-breadcrumb-current')?.textContent?.trim()).toBe('Foundation');
    expect(find('my-newsletters-breadcrumb-current')?.getAttribute('aria-current')).toBe('page');
  });
  it('scopes rows to the route foundation, matched by slug or uid, including foundation-owned issues', async () => {
    const response = feedOf(
      [
        row(),
        // Owned by the foundation itself: no foundation_uid, so project_uid is the key.
        row({ id: 'own', project_uid: 'foundation', foundation_uid: undefined, is_foundation: true, project_name: 'Foundation', subject: 'Own news' }),
        row({ id: 'elsewhere', project_uid: 'other-child', foundation_uid: 'other', foundation_slug: 'other-slug', subject: 'Elsewhere news' }),
      ],
      true,
      [card(), card({ uid: 'other', slug: 'other-slug', name: 'Other Foundation' })]
    );
    await respond(response);
    expect(fixture.componentInstance.myNewsletters().map((newsletter) => newsletter.id)).toEqual(['issue', 'own']);
    expect(find('my-newsletters-row-elsewhere')).toBeNull();

    routeParams.next(convertToParamMap({ foundationSlug: 'other' }));
    await settle();
    expect(find('my-newsletters-title')?.textContent).toContain('Other Foundation');
    expect(fixture.componentInstance.myNewsletters().map((newsletter) => newsletter.id)).toEqual(['elsewhere']);

    routeParams.next(convertToParamMap({ foundationSlug: 'unknown-slug' }));
    await settle();
    expect(fixture.componentInstance.myNewsletters()).toEqual([]);
    expect(find('my-newsletters-title')?.textContent).toContain('Newsletters');
    expect(find('my-newsletters-empty-state')).not.toBeNull();
  });
  it('shows Invite only when the user can invite to this foundation, and opens the invite dialog', async () => {
    await respond(feedOf([row()], true, [card({ can_invite: false })]));
    expect(find('my-newsletters-invite')).toBeNull();

    nextFeed();
    fixture.componentInstance.onRetry();
    await respond(feedOf([row()], true, [card({ can_invite: true })]));
    expect(find('my-newsletters-invite')).not.toBeNull();
    await click('my-newsletters-invite');
    expect(dialog.open).toHaveBeenCalledWith(
      NewsletterInviteDialogComponent,
      expect.objectContaining({ header: 'Invite a colleague', data: { foundation: expect.objectContaining({ uid: 'foundation', can_invite: true }) } })
    );
  });
  it('renders the invite landing for ?invite=, reloads only after a join and clears the param when dismissed', async () => {
    await respond(feedOf([row()], true));
    expect(find('newsletter-invite-landing')).toBeNull();

    const group = { uid: 'group', name: 'Foundation Newsletter' };
    const foundation = { uid: 'foundation', slug: 'foundation-slug', name: 'Foundation', logo_url: null };
    const status = new Subject<NewsletterGroupJoinStatus>();
    gateway.getNewsletterGroupJoinStatus.mockReturnValue(status);
    params.next(convertToParamMap({ invite: 'group' }));
    await settle();
    expect(find('newsletter-invite-landing')).not.toBeNull();
    expect(gateway.getNewsletterGroupJoinStatus).toHaveBeenCalledWith('group');

    // Already on the list: the page already shows that feed, so no reload.
    status.next({ state: 'already_member', group, foundation, membership_name: 'Foundation' });
    await settle();
    expect(gateway.getMyNewsletterFoundations).toHaveBeenCalledTimes(1);

    const eligible: NewsletterGroupJoinStatus = {
      state: 'eligible',
      group,
      foundation,
      membership_name: 'Foundation',
      email: 'pat@acme-motors.example',
      company_name: 'Acme Motors',
    };
    gateway.getNewsletterGroupJoinStatus.mockReturnValue(of(eligible));
    gateway.joinNewsletterGroupByInvite.mockReturnValue(
      of({ status: 'added', email: 'pat@acme-motors.example', committee_name: 'Foundation Newsletter', company_name: 'Acme Motors' })
    );
    params.next(convertToParamMap({ invite: 'group-1' }));
    await settle();
    nextFeed();
    await click('newsletter-invite-landing-confirm');
    expect(gateway.joinNewsletterGroupByInvite).toHaveBeenCalledWith('group-1');
    expect(gateway.getMyNewsletterFoundations).toHaveBeenCalledTimes(2);
    await respond(feedOf([row()], true));

    params.next(convertToParamMap({}));
    await settle();
    expect(find('newsletter-invite-landing')).toBeNull();
    params.next(convertToParamMap({ invite: 'group-2' }));
    await settle();
    expect(gateway.getNewsletterGroupJoinStatus).toHaveBeenLastCalledWith('group-2');
    await click('newsletter-invite-landing-dismiss');
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { invite: null }, queryParamsHandling: 'merge', replaceUrl: true }));
  });
  it.each([false, true])('keeps rendered rows, options and complete=%s throughout a pending retry', async (complete) => {
    await respond(feedOf([row()], complete));
    const previousRows = fixture.componentInstance.myNewsletters();
    nextFeed();
    if (complete) {
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
    expect(find('my-newsletters-foundation-filter')).toBeNull();
    const projects = await openOptions('my-newsletters-project-filter');
    expect(projects.map((option) => option.textContent?.trim())).toEqual(['All Projects', 'Child']);
    projects[0]!.click();
    await settle();
    expect(fixture.componentInstance.myNewsletters()).toEqual(previousRows);
    expect(fixture.componentInstance.complete()).toBe(complete);
    expect(find('my-newsletters-row-issue')).not.toBeNull();
    await respond(feedOf([row()], true));
    expect(find('my-newsletters-refresh-status')).toBeNull();
  });
  it('replaces retained rows on success, including a confirmed empty response', async () => {
    await respond(feedOf([row()], false));
    nextFeed();
    await click('my-newsletters-retry');
    expect(find('my-newsletters-row-issue')).not.toBeNull();
    await respond(feedOf([row({ id: 'replacement', subject: 'Replacement news', project_uid: 'new-child', project_name: 'New child' })], true));
    expect(find('my-newsletters-row-issue')).toBeNull();
    expect(find('my-newsletters-row-replacement')?.textContent).toContain('Replacement news');
    expect(fixture.componentInstance.myNewsletters().map((newsletter) => newsletter.id)).toEqual(['replacement']);
    expect(find('my-newsletters-refresh-status')).toBeNull();
    const projects = await openOptions('my-newsletters-project-filter');
    expect(projects.map((option) => option.textContent?.trim())).toEqual(['All Projects', 'New child']);
    projects[0]!.click();
    await settle();

    nextFeed();
    fixture.componentInstance.onRetry();
    await settle();
    expect(find('my-newsletters-row-replacement')).not.toBeNull();
    await respond(feedOf([], true));
    expect(find('my-newsletters-empty-state')?.textContent).toContain('No newsletters yet');
    expect(find('my-newsletters-row-replacement')).toBeNull();
    expect(find('my-newsletters-refresh-status')).toBeNull();
    expect(find('my-newsletters-project-filter')).toBeNull();
    expect(fixture.componentInstance.myNewsletters()).toEqual([]);
    expect(fixture.componentInstance.complete()).toBe(true);
  });
  it('preserves rendered search and project selections during and after an asynchronous retry', async () => {
    await respond(feedOf([row(), row({ id: 'sibling', project_uid: 'sibling', project_name: 'Sibling', subject: 'Sibling news' })], false));
    await chooseOption('my-newsletters-project-filter', 'Child');
    const input = find('my-newsletters-search-input')!.querySelector<HTMLInputElement>('input')!;
    input.value = 'Child';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 220));
    await settle();
    expect(find('my-newsletters-row-issue')).not.toBeNull();
    expect(find('my-newsletters-row-sibling')).toBeNull();

    nextFeed();
    await click('my-newsletters-retry');
    expect(find('my-newsletters-row-issue')).not.toBeNull();
    expect(find('my-newsletters-search-input')!.querySelector<HTMLInputElement>('input')!.value).toBe('Child');
    expect(find('my-newsletters-project-filter')?.querySelector('[role="combobox"]')?.textContent).toContain('Child');
    expect(fixture.componentInstance.searchForm.getRawValue()).toEqual({ search: 'Child', projectFilter: 'child' });
    await respond(feedOf([row({ id: 'updated', subject: 'Child updated' }), row({ id: 'sibling', project_uid: 'sibling', project_name: 'Sibling' })], true));
    expect(find('my-newsletters-row-issue')).toBeNull();
    expect(find('my-newsletters-row-updated')?.textContent).toContain('Child updated');
    expect(find('my-newsletters-search-input')!.querySelector<HTMLInputElement>('input')!.value).toBe('Child');
    expect(find('my-newsletters-project-filter')?.querySelector('[role="combobox"]')?.textContent).toContain('Child');
    expect(fixture.componentInstance.searchForm.getRawValue()).toEqual({ search: 'Child', projectFilter: 'child' });
  });
  it('clears retained rows on failed refresh', async () => {
    await respond(feedOf([row()], false));
    nextFeed();
    await click('my-newsletters-retry');
    expect(find('my-newsletters-row-issue')).not.toBeNull();
    feed.error(new Error('Refresh unavailable'));
    await settle();
    expect(find('my-newsletters-error')?.textContent).toContain('Could not load newsletters');
    expect(find('my-newsletters-row-issue')).toBeNull();
    expect(find('my-newsletters-refresh-status')).toBeNull();
    expect(find('my-newsletters-project-filter')).toBeNull();
    expect(fixture.componentInstance.myNewsletters()).toEqual([]);
    expect(fixture.componentInstance.complete()).toBeNull();
    expect(fixture.componentInstance.loading()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(text()).not.toContain('No newsletters yet');

    nextFeed();
    await click('my-newsletters-error');
    expect(find('my-newsletters-table')!.querySelector('.lfx-skeleton-row')).not.toBeNull();
    expect(find('my-newsletters-row-issue')).toBeNull();
    expect(find('my-newsletters-refresh-status')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    feed.error(new Error('Retry unavailable'));
    await settle();
    expect(find('my-newsletters-error')).not.toBeNull();
    expect(fixture.componentInstance.myNewsletters()).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
  });
  it('keeps zero-row incomplete responses unconfirmed and retryable', async () => {
    await respond(feedOf([], false));
    expect(find('my-newsletters-completeness-notice')!.textContent).toContain('Some newsletters could not be loaded');
    expect(text()).not.toMatch(/No newsletters yet|No results found/);
    nextFeed();
    await click('my-newsletters-retry');
    expect(find('my-newsletters-table')!.querySelector('.lfx-skeleton-row')).not.toBeNull();
    expect(find('my-newsletters-refresh-status')).toBeNull();
    expect(text()).not.toMatch(/No newsletters yet|No results found/);
    await respond(feedOf([row()], true));
    expect(find('my-newsletters-row-issue')).not.toBeNull();
    expect(find('my-newsletters-completeness-notice')).toBeNull();
  });
  it('retains healthy rows and the incomplete notice through filter misses', async () => {
    await respond(feedOf([row()], false));
    expect(find('my-newsletters-row-issue')).not.toBeNull();
    fixture.componentInstance.searchForm.controls.search.setValue('missing');
    await new Promise((resolve) => setTimeout(resolve, 220));
    await settle();
    expect(find('my-newsletters-no-results')!.textContent).toContain('Reset filters');
    gateway.getMyNewsletterFoundations.mockReturnValue(of(feedOf([row()], false)));
    await click('my-newsletters-retry');
    expect(fixture.componentInstance.searchForm.controls.search.value).toBe('missing');
    expect(find('my-newsletters-no-results')).not.toBeNull();
    await click('my-newsletters-no-results');
    expect(find('my-newsletters-row-issue')).not.toBeNull();
    expect(find('my-newsletters-completeness-notice')).not.toBeNull();
    expect(gateway.getMyNewsletterFoundations).toHaveBeenCalledTimes(2);
  });
  it('cancels superseded requests and ignores late results', async () => {
    const cancelled = vi.fn();
    gateway.getMyNewsletterFoundations.mockReturnValue(new Observable(() => cancelled));
    fixture.componentInstance.onRetry();
    fixture.componentInstance.onRetry();
    expect(cancelled).toHaveBeenCalledTimes(1);
    await respond(feedOf([row()], true));
    expect(fixture.componentInstance.loading()).toBe(true);
  });
  it('offers sorted, deduped child projects only, and filters rows by project', async () => {
    await respond(
      feedOf(
        [
          row(),
          row({ id: 'duplicate' }),
          row({ id: 'other', project_uid: 'other', project_name: 'Alpha' }),
          row({ id: 'own', project_uid: 'foundation', foundation_uid: 'foundation', is_foundation: true, project_name: 'Foundation' }),
          row({ id: 'unknown', project_uid: 'unknown', project_slug: undefined, is_foundation: undefined }),
        ],
        true
      )
    );
    const select = (id: string) => fixture.debugElement.query(By.css(`[data-testid="${id}"]`)).componentInstance as SelectComponent;
    expect(select('my-newsletters-project-filter').options()).toEqual([
      { label: 'All Projects', value: null },
      { label: 'Alpha', value: 'other' },
      { label: 'Child', value: 'child' },
    ]);
    expect(find('my-newsletters-open-unknown')!.tagName).toBe('SPAN');
    select('my-newsletters-project-filter').onChange.emit({ value: 'other' });
    await settle();
    expect(find('my-newsletters-row-other')).not.toBeNull();
    expect(find('my-newsletters-row-issue')).toBeNull();
    expect(find('my-newsletters-row-own')).toBeNull();
  });
  it('redirects a legacy ?issue=&project= drawer link to the reader permalink without waiting for the feed (#4979)', async () => {
    params.next(convertToParamMap({ issue: 'issue', project: 'child-slug', keep: 'yes' }));
    await settle();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/newsletters', 'child-slug', 'issue'], { replaceUrl: true });
  });
  it('ignores a legacy link missing either param', async () => {
    params.next(convertToParamMap({ issue: 'issue' }));
    await settle();
    params.next(convertToParamMap({ project: 'child-slug' }));
    await settle();
    expect(navigate).not.toHaveBeenCalled();
  });
  it('links each subject to its reader permalink and opens it on a row click, with no drawer (#4979)', async () => {
    await respond(feedOf([row()], true));
    expect(text()).toContain('Sent');
    expect(text()).not.toContain('Received');
    expect(document.body.querySelector('[data-testid="my-newsletters-preview-drawer"]')).toBeNull();

    const link = find('my-newsletters-open-issue')!;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/newsletters/child-slug/issue');

    // A click on the link is the link's own navigation; it must not bubble into a second row navigation.
    link.click();
    await settle();
    expect(navigateByUrl).toHaveBeenCalledTimes(1);
    expect(String(navigateByUrl.mock.calls[0][0])).toBe('/newsletters/child-slug/issue');

    navigateByUrl.mockClear();
    const cell = find('my-newsletters-row-issue')!.querySelectorAll('td')[1]!;
    cell.dispatchEvent(new MouseEvent('click', { metaKey: true, bubbles: true, cancelable: true }));
    expect(navigateByUrl).not.toHaveBeenCalled();
    cell.click();
    expect(navigateByUrl).toHaveBeenCalledWith('/newsletters/child-slug/issue');
  });
  it('shows a subject without a resolvable permalink as plain text that opens nothing', async () => {
    await respond(feedOf([row({ id: 'unknown', project_slug: undefined })], true));
    expect(find('my-newsletters-open-unknown')!.tagName).toBe('SPAN');
    find('my-newsletters-row-unknown')!.querySelectorAll('td')[1]!.click();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });
  it('shows share counts from the feed (#4958)', async () => {
    await respond(
      feedOf([row({ share_count: 3 }), row({ id: 'quiet', subject: 'Quiet news' }), row({ id: 'none', subject: 'Unshared', share_count: 0 })], true)
    );
    expect(find('my-newsletters-shares-issue')!.textContent!.trim()).toBe('3');
    expect(find('my-newsletters-shares-quiet')!.textContent!.trim()).toBe('—');
    expect(find('my-newsletters-shares-none')!.textContent!.trim()).toBe('—');
    feed.next(feedOf([row({ share_count: 10 })], true));
    await settle();
    expect(find('my-newsletters-shares-issue')!.textContent!.trim()).toBe('10');
  });
  it('shows views as email opens plus unique page views, and a dash when both are unknown', async () => {
    await respond(
      feedOf(
        [
          row({ total_opens: 40, page_view_count: 2 }),
          row({ id: 'web', subject: 'Web only', page_view_count: 0 }),
          row({ id: 'unknown', subject: 'Unknown views' }),
        ],
        true
      )
    );
    expect(find('my-newsletters-views-issue')!.textContent!.trim()).toBe('42');
    expect(find('my-newsletters-views-issue')!.getAttribute('aria-label')).toBe('Viewed 42 times');
    expect(find('my-newsletters-views-web')!.textContent!.trim()).toBe('0');
    expect(find('my-newsletters-views-unknown')!.textContent!.trim()).toBe('—');
  });
});
