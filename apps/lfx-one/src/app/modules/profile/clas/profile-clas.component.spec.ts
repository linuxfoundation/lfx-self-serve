// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import type { ClaGroupOption, MyClaAgreement, MyClasResponse } from '@lfx-one/shared/interfaces';
import { MenuComponent } from '@components/menu/menu.component';
import { TagComponent } from '@components/tag/tag.component';
import { MyClasService } from '@services/my-clas.service';
import { UserService } from '@services/user.service';
import { MenuItem, MessageService } from 'primeng/api';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileClasComponent } from './profile-clas.component';

/** Comfortably past the component's 250 ms search debounce. */
const SEARCH_SETTLE_MS = 400;

describe('ProfileClasComponent', () => {
  const agreement = (overrides: Partial<MyClaAgreement> = {}): MyClaAgreement => ({
    id: 's1',
    kind: 'ICLA',
    claGroupName: 'Project One',
    signedOn: '2022-01-01',
    status: 'valid',
    pdfAvailable: true,
    ...overrides,
  });

  let fixture: ComponentFixture<ProfileClasComponent>;

  async function render(agreements: MyClaAgreement[]): Promise<void> {
    const response: MyClasResponse = {
      agreements,
      identity: { matchedUserIds: agreements.length > 0 ? 1 : 0, unmatched: agreements.length === 0, githubLinked: true },
    };

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ProfileClasComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: MyClasService, useValue: { getMyClas: () => of(response), getPdfUrl: vi.fn() } },
        // Stubbed rather than real: the Sign CLA action reads impersonating(), and the real
        // service would drag HttpClient into a TestBed that has no reason to make requests.
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileClasComponent);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function statusTag(id: string): TagComponent {
    const el = fixture.debugElement.query(By.css(`[data-testid="agreement-status-${id}"]`));
    if (!el) throw new Error(`no status tag rendered for ${id}`);
    return el.componentInstance as TagComponent;
  }

  function menuItems(id: string): MenuItem[] {
    const row = fixture.debugElement.query(By.css(`[data-testid="agreement-row-${id}"]`));
    if (!row) throw new Error(`no row rendered for ${id}`);
    const menu = row.query(By.directive(MenuComponent));
    if (!menu) throw new Error(`no row menu rendered for ${id}`);
    return (menu.componentInstance as MenuComponent).model() ?? [];
  }

  function headers(): string[] {
    return Array.from(fixture.nativeElement.querySelectorAll('th') as NodeListOf<HTMLElement>).map((th) => th.textContent?.trim() ?? '');
  }

  it('renders Valid / Needs attention / Invalidated with the matching severities', async () => {
    await render([
      agreement({ id: 's-valid', status: 'valid' }),
      agreement({ id: 's-attn', kind: 'ECLA', status: 'needs_attention', pdfAvailable: false, companyName: 'Acme' }),
      agreement({ id: 's-inv', status: 'invalidated', pdfAvailable: false }),
    ]);

    expect(statusTag('s-valid').value()).toBe('Valid');
    expect(statusTag('s-valid').severity()).toBe('success');
    expect(statusTag('s-attn').value()).toBe('Needs attention');
    expect(statusTag('s-attn').severity()).toBe('warn');
    expect(statusTag('s-inv').value()).toBe('Invalidated');
    expect(statusTag('s-inv').severity()).toBe('danger');
  });

  it('renders an invalidated row instead of the empty state', async () => {
    await render([agreement({ id: 's-inv', status: 'invalidated', pdfAvailable: false })]);

    expect(fixture.nativeElement.querySelector('[data-testid="my-clas-empty-state"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-row-s-inv"]')).toBeTruthy();
  });

  it('shows the mockup sentence only for a completed Approved List miss', async () => {
    await render([
      agreement({ id: 's-attn', kind: 'ECLA', status: 'needs_attention', statusReason: 'not_on_approval_list', pdfAvailable: false, companyName: 'Acme' }),
      agreement({ id: 's-valid', status: 'valid' }),
      agreement({ id: 's-inv', status: 'invalidated', pdfAvailable: false }),
      agreement({ id: 's-icla', kind: 'ICLA', status: 'valid', statusReason: 'not_on_approval_list' }),
    ]);

    const note = fixture.nativeElement.querySelector('[data-testid="agreement-status-note-s-attn"]') as HTMLElement | null;
    expect(note?.textContent?.trim()).toBe("No longer matches Acme's approval criteria.");
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-status-note-s-valid"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-status-note-s-inv"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-status-note-s-icla"]')).toBeNull();
  });

  it('omits the possessive when a list-miss row has no company name', async () => {
    await render([agreement({ id: 's-attn', kind: 'ECLA', status: 'needs_attention', statusReason: 'not_on_approval_list', pdfAvailable: false })]);

    const note = fixture.nativeElement.querySelector('[data-testid="agreement-status-note-s-attn"]') as HTMLElement | null;
    expect(note?.textContent?.trim()).toBe('No longer matches the approval criteria.');
  });

  it('renders unknown as plain-text em dash, not a tag and not the list-miss sentence', async () => {
    await render([
      agreement({ id: 's-unknown', kind: 'ECLA', status: 'unknown', statusReason: 'unknown', pdfAvailable: false, companyName: 'Acme' }),
      agreement({ id: 's-attn', kind: 'ECLA', status: 'needs_attention', statusReason: 'not_on_approval_list', pdfAvailable: false, companyName: 'Acme' }),
    ]);

    const unknown = fixture.nativeElement.querySelector('[data-testid="agreement-status-s-unknown"]') as HTMLElement | null;
    expect(unknown?.textContent?.trim()).toBe('—');
    expect(unknown?.tagName.toLowerCase()).not.toBe('lfx-tag');
    expect(fixture.debugElement.query(By.css('[data-testid="agreement-status-s-unknown"]'))?.componentInstance).not.toBeInstanceOf(TagComponent);
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-status-note-s-unknown"]')).toBeNull();

    expect(statusTag('s-attn').value()).toBe('Needs attention');
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-status-note-s-attn"]')?.textContent?.trim()).toBe(
      "No longer matches Acme's approval criteria."
    );
  });

  it('never renders Needs attention or an em dash on an ICLA', async () => {
    await render([
      agreement({ id: 's-icla', kind: 'ICLA', status: 'valid', pdfAvailable: true }),
      agreement({ id: 's-inv', kind: 'ICLA', status: 'invalidated', pdfAvailable: true }),
    ]);

    expect(statusTag('s-icla').value()).toBe('Valid');
    expect(statusTag('s-inv').value()).toBe('Invalidated');
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-status-s-icla"]')?.textContent).not.toContain('Needs attention');
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-status-s-icla"]')?.textContent?.trim()).not.toBe('—');
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-status-note-s-icla"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-status-note-s-inv"]')).toBeNull();
  });

  it('lists Project, Type, Status, Signed, then a screen-reader Actions header, with no Document column', async () => {
    await render([agreement()]);

    expect(headers()).toEqual(['Project', 'Type', 'Status', 'Signed', 'Actions']);
    expect(fixture.nativeElement.textContent).not.toContain('Document');
  });

  it('offers an enabled Download PDF item on an ICLA row with a document', async () => {
    await render([agreement({ id: 's-icla', kind: 'ICLA', pdfAvailable: true })]);

    const items = menuItems('s-icla');
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('Download PDF');
    expect(items[0].disabled).toBeFalsy();
  });

  it('shows a disabled Covered by Corporate CLA item on an ECLA row', async () => {
    await render([agreement({ id: 's-ecla', kind: 'ECLA', pdfAvailable: false, companyName: 'Acme' })]);

    expect(menuItems('s-ecla')).toEqual([expect.objectContaining({ label: 'Covered by Corporate CLA (CCLA)', disabled: true })]);
  });

  it('keeps a stable menu model across change detection so the popup can open on the first click', async () => {
    await render([agreement({ id: 's-icla', kind: 'ICLA', pdfAvailable: true })]);

    const first = menuItems('s-icla');
    fixture.detectChanges();
    expect(menuItems('s-icla')).toBe(first);
  });

  it('does not render placeholder Invalidate or Request approval items', async () => {
    await render([
      agreement({ id: 's-icla', kind: 'ICLA', pdfAvailable: true }),
      agreement({ id: 's-ecla', kind: 'ECLA', pdfAvailable: false, status: 'needs_attention' }),
      agreement({ id: 's-inv', status: 'invalidated', pdfAvailable: false }),
    ]);

    const labels = ['s-icla', 's-ecla', 's-inv'].flatMap((id) => menuItems(id).map((item) => item.label ?? ''));
    expect(labels.some((label) => /invalidate|request approval/i.test(label))).toBe(false);
  });
});

/**
 * Covers the Sign CLA hand-off entry point (#1251).
 *
 * The template is rendered rather than overridden, because two of the three behaviours here —
 * whether the action is offered at all, and whether the dialog opens — are template conditions.
 * Asserting them on the class alone would keep passing if the binding were dropped.
 */
describe('ProfileClasComponent — Sign CLA hand-off (#1251)', () => {
  const CLA_GROUP: ClaGroupOption = { claGroupId: 'cg-1', projectName: 'Venus test' };
  const EMPTY_CLAS: MyClasResponse = { agreements: [], identity: { matchedUserIds: 1, unmatched: false, githubLinked: true } };

  let location: { href: string };
  let messageAdd: ReturnType<typeof vi.fn>;
  let getSignUrl: ReturnType<typeof vi.fn>;
  let getClaGroupOptions: ReturnType<typeof vi.fn>;

  async function setup(options: { impersonating?: boolean; signUrl?: () => Observable<string> } = {}): Promise<ComponentFixture<ProfileClasComponent>> {
    location = { href: 'https://app.dev.lfx.dev/profile/clas' };
    messageAdd = vi.fn();
    getClaGroupOptions = vi.fn(() => of([CLA_GROUP]));
    getSignUrl = vi.fn(options.signUrl ?? (() => of('https://easycla.dev.communitybridge.org/#/cla/project/cg-1/user/u-1?redirect=enc')));

    TestBed.configureTestingModule({
      imports: [ProfileClasComponent],
      providers: [
        provideRouter([]),
        // PrimeNG's message/dialog use synthetic animations; the app provides them at bootstrap.
        provideNoopAnimations(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        // Only `location` is swapped. TestBed renders through DOCUMENT, so replacing it wholesale
        // breaks the fixture; jsdom also refuses a direct `document.location` assignment. Methods
        // are bound to the real document — called on the proxy they would fail on internal slots.
        {
          provide: DOCUMENT,
          useFactory: () =>
            new Proxy(globalThis.document, {
              get: (target, prop) => {
                if (prop === 'location') return location;
                const value = Reflect.get(target, prop);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            }),
        },
        { provide: UserService, useValue: { impersonating: signal(options.impersonating ?? false) } },
        {
          provide: MyClasService,
          useValue: { getMyClas: vi.fn(() => of(EMPTY_CLAS)), getPdfUrl: vi.fn(), getClaGroupOptions, getSignUrl },
        },
      ],
    });
    TestBed.overrideProvider(MessageService, { useValue: { add: messageAdd, addAll: vi.fn(), clear: vi.fn(), messageObserver: of(), clearObserver: of() } });

    const fixture = TestBed.createComponent(ProfileClasComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  function query(fixture: ComponentFixture<ProfileClasComponent>, testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  /** Types into the picker and waits out the debounce so the query actually reaches the server. */
  async function searchPicker(fixture: ComponentFixture<ProfileClasComponent>, queryText: string): Promise<void> {
    (fixture.componentInstance as any).onClaGroupSearch(queryText);
    await new Promise((resolve) => setTimeout(resolve, SEARCH_SETTLE_MS));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('offers the Sign CLA action in a normal session', async () => {
    const fixture = await setup();

    expect(query(fixture, 'sign-cla-action')).not.toBeNull();
  });

  it('withholds the action while impersonating, since the server refuses the hand-off', async () => {
    const fixture = await setup({ impersonating: true });

    expect(query(fixture, 'sign-cla-action')).toBeNull();
    // The dialog must not be reachable either — hiding only the button would leave the
    // hand-off one stray binding away from being offered.
    expect(query(fixture, 'cla-group-select-dialog')).toBeNull();
  });

  it('loads the selectable projects when the picker is searched', async () => {
    const fixture = await setup();

    await searchPicker(fixture, '');

    expect(getClaGroupOptions).toHaveBeenCalledWith('');
    expect((fixture.componentInstance as any).claGroupOptions()).toEqual([CLA_GROUP]);
  });

  it('sends the query upstream instead of filtering the fetched list', async () => {
    const fixture = await setup();

    await searchPicker(fixture, 'venus');

    // #1250 replaces the route's stub with the real four-source search. That swap only stays
    // invisible to this page if the query was never resolved in the browser.
    expect(getClaGroupOptions).toHaveBeenCalledWith('venus');
  });

  it('coalesces keystrokes into a single query', async () => {
    const fixture = await setup();

    (fixture.componentInstance as any).onClaGroupSearch('v');
    (fixture.componentInstance as any).onClaGroupSearch('ve');
    await searchPicker(fixture, 'ven');

    expect(getClaGroupOptions).toHaveBeenCalledTimes(1);
    expect(getClaGroupOptions).toHaveBeenCalledWith('ven');
  });

  it('navigates to the resolved Console URL in the same tab', async () => {
    const fixture = await setup();

    (fixture.componentInstance as any).onClaGroupConfirmed(CLA_GROUP);
    await fixture.whenStable();

    expect(getSignUrl).toHaveBeenCalledWith('cg-1');
    // Same tab, not a new one: the Console returns the contributor here afterwards.
    expect(location.href).toBe('https://easycla.dev.communitybridge.org/#/cla/project/cg-1/user/u-1?redirect=enc');
  });

  it('never composes the URL client-side from a guessed identifier', async () => {
    const fixture = await setup();

    (fixture.componentInstance as any).onClaGroupConfirmed(CLA_GROUP);
    await fixture.whenStable();

    // The only source of the contributor id is the server round trip.
    expect(getSignUrl).toHaveBeenCalledTimes(1);
  });

  it('stays on the page and reports failure when the hand-off cannot be resolved', async () => {
    const fixture = await setup({ signUrl: () => throwError(() => new Error('resolution failed')) });

    (fixture.componentInstance as any).onClaGroupConfirmed(CLA_GROUP);
    await fixture.whenStable();

    // A failed resolution must not navigate to a half-built URL — the Console would show
    // "invalid user ID", which reads as a broken product rather than a failed lookup.
    expect(location.href).toBe('https://app.dev.lfx.dev/profile/clas');
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });

  it('ignores a second selection while one hand-off is already resolving', async () => {
    const pending = new Subject<string>();
    const fixture = await setup({ signUrl: () => pending.asObservable() });

    (fixture.componentInstance as any).onClaGroupConfirmed(CLA_GROUP);
    (fixture.componentInstance as any).onClaGroupConfirmed(CLA_GROUP);

    expect(getSignUrl).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failure to load projects without closing the dialog', async () => {
    const fixture = await setup();
    getClaGroupOptions.mockReturnValue(throwError(() => new Error('boom')));

    (fixture.componentInstance as any).openSignDialog();
    await searchPicker(fixture, '');

    expect((fixture.componentInstance as any).optionsError()).toBe(true);
    expect((fixture.componentInstance as any).selectVisible()).toBe(true);
  });

  it('can search again after a failure', async () => {
    const fixture = await setup();
    getClaGroupOptions.mockReturnValueOnce(throwError(() => new Error('boom')));

    await searchPicker(fixture, '');
    // Retry re-issues the same empty query. A stream that dropped repeats would strand the
    // picker on its error state with no way back.
    await searchPicker(fixture, '');

    expect((fixture.componentInstance as any).optionsError()).toBe(false);
    expect((fixture.componentInstance as any).claGroupOptions()).toEqual([CLA_GROUP]);
  });

  it('reopens the picker clean after a failed search', async () => {
    const fixture = await setup();
    getClaGroupOptions.mockReturnValue(throwError(() => new Error('boom')));

    (fixture.componentInstance as any).openSignDialog();
    await searchPicker(fixture, '');
    expect((fixture.componentInstance as any).optionsError()).toBe(true);

    // Reopening must not greet the contributor with the previous attempt's error before any
    // new request has run.
    (fixture.componentInstance as any).openSignDialog();

    expect((fixture.componentInstance as any).optionsError()).toBe(false);
    expect((fixture.componentInstance as any).optionsLoading()).toBe(false);
  });
});
