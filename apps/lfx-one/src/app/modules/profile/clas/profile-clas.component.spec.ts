// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router, RouterLink } from '@angular/router';
import type { ClaGroupOption, MyClaAgreement, MyClasResponse } from '@lfx-one/shared/interfaces';
import { MenuComponent } from '@components/menu/menu.component';
import { TagComponent } from '@components/tag/tag.component';
import { MyClasService } from '@services/my-clas.service';
import { UserService } from '@services/user.service';
import { MenuItem, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaGroupSelectComponent } from './cla-group-select.component';
import { ProfileClasComponent } from './profile-clas.component';

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

  /** Null when the row deliberately renders no menu at all (nothing to offer). */
  function rowMenu(id: string): MenuComponent | null {
    const row = fixture.debugElement.query(By.css(`[data-testid="agreement-row-${id}"]`));
    if (!row) throw new Error(`no row rendered for ${id}`);
    const menu = row.query(By.directive(MenuComponent));
    return menu ? (menu.componentInstance as MenuComponent) : null;
  }

  function menuItems(id: string): MenuItem[] {
    const menu = rowMenu(id);
    if (!menu) throw new Error(`no row menu rendered for ${id}`);
    return menu.model() ?? [];
  }

  function actionsTrigger(id: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="agreement-row-actions-${id}"]`);
  }

  function headers(): string[] {
    return Array.from(fixture.nativeElement.querySelectorAll('th') as NodeListOf<HTMLElement>).map((th) => th.textContent?.trim() ?? '');
  }

  it('renders Valid / Needs attention / Revoked with the matching severities', async () => {
    await render([
      agreement({ id: 's-valid', status: 'valid' }),
      agreement({ id: 's-attn', kind: 'ECLA', status: 'needs_attention', pdfAvailable: false, companyName: 'Acme' }),
      agreement({ id: 's-inv', status: 'invalidated', pdfAvailable: false }),
    ]);

    expect(statusTag('s-valid').value()).toBe('Valid');
    expect(statusTag('s-valid').severity()).toBe('success');
    expect(statusTag('s-attn').value()).toBe('Needs attention');
    expect(statusTag('s-attn').severity()).toBe('warn');
    // Wire token `invalidated`, reviewed copy "Revoked".
    expect(statusTag('s-inv').value()).toBe('Revoked');
    expect(statusTag('s-inv').severity()).toBe('danger');
  });

  it('renders an invalidated row instead of the empty state', async () => {
    await render([agreement({ id: 's-inv', status: 'invalidated', pdfAvailable: false })]);

    expect(fixture.nativeElement.querySelector('[data-testid="my-clas-empty-state"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-row-s-inv"]')).toBeTruthy();
  });

  it('empty state CTA routes to the CLAs docs article, not the pre-rename slug', async () => {
    await render([]);

    const emptyState = fixture.debugElement.query(By.css('[data-testid="my-clas-empty-state"]'));
    expect(emptyState).toBeTruthy();
    const link = emptyState.query(By.directive(RouterLink));
    if (!link) throw new Error('empty state rendered no RouterLink');
    const urlTree = link.injector.get(RouterLink).urlTree;
    expect(urlTree && TestBed.inject(Router).serializeUrl(urlTree)).toBe('/docs/account/my-clas');
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
    expect(statusTag('s-inv').value()).toBe('Revoked');
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

    const labels = ['s-icla', 's-ecla', 's-inv'].flatMap((id) => (rowMenu(id)?.model() ?? []).map((item) => item.label ?? ''));
    expect(labels.some((label) => /invalidate|request approval/i.test(label))).toBe(false);
  });

  it('renders no actions trigger on an ICLA row with no retrievable document', async () => {
    await render([
      agreement({ id: 's-no-pdf', kind: 'ICLA', pdfAvailable: false }),
      agreement({ id: 's-pdf', kind: 'ICLA', pdfAvailable: true }),
      agreement({ id: 's-ecla', kind: 'ECLA', pdfAvailable: false, companyName: 'Acme' }),
    ]);

    // The row still lists; only its ⋮ is withheld. An always-rendered trigger is clickable and
    // opens an empty overlay, which reads as a broken menu rather than "nothing to offer here".
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-row-s-no-pdf"]')).toBeTruthy();
    expect(actionsTrigger('s-no-pdf')).toBeNull();
    expect(rowMenu('s-no-pdf')).toBeNull();

    // Rows that do have an item keep the trigger — including the ECLA explanation item.
    expect(actionsTrigger('s-pdf')).not.toBeNull();
    expect(actionsTrigger('s-ecla')).not.toBeNull();
  });
});

/**
 * Covers the Sign CLA hand-off entry point (#1251).
 *
 * The picker itself is a dynamic dialog with its own spec; what matters here is that the action is
 * offered only when it can succeed, that opening it goes through DialogService, and that whatever
 * the dialog closes with drives the hand-off. The template is rendered rather than overridden,
 * because whether the action is offered at all is a template condition.
 */
describe('ProfileClasComponent — Sign CLA hand-off (#1251)', () => {
  const CLA_GROUP: ClaGroupOption = { claGroupId: 'cg-1', projectName: 'Venus test' };
  const EMPTY_CLAS: MyClasResponse = { agreements: [], identity: { matchedUserIds: 1, unmatched: false, githubLinked: true } };

  let location: { href: string };
  let messageAdd: ReturnType<typeof vi.fn>;
  let getSignUrl: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;

  async function setup(
    options: { impersonating?: boolean; signUrl?: () => Observable<string>; closesWith?: ClaGroupOption | null } = {}
  ): Promise<ComponentFixture<ProfileClasComponent>> {
    location = { href: 'https://app.dev.lfx.dev/profile/clas' };
    messageAdd = vi.fn();
    getSignUrl = vi.fn(options.signUrl ?? (() => of('https://easycla.dev.communitybridge.org/#/cla/project/cg-1/user/u-1?redirect=enc')));
    open = vi.fn(() => ({ onClose: of('closesWith' in options ? options.closesWith : CLA_GROUP) }));

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
          useValue: { getMyClas: vi.fn(() => of(EMPTY_CLAS)), getPdfUrl: vi.fn(), getClaGroupOptions: vi.fn(() => of([CLA_GROUP])), getSignUrl },
        },
      ],
    });
    TestBed.overrideProvider(MessageService, { useValue: { add: messageAdd, addAll: vi.fn(), clear: vi.fn(), messageObserver: of(), clearObserver: of() } });
    TestBed.overrideProvider(DialogService, { useValue: { open } });

    const fixture = TestBed.createComponent(ProfileClasComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  function query(fixture: ComponentFixture<ProfileClasComponent>, testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
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
  });

  it('opens the picker through DialogService rather than a template dialog', async () => {
    const fixture = await setup();

    query(fixture, 'sign-cla-action')?.querySelector('button')?.click();
    await fixture.whenStable();

    // The frontend checklist forbids <p-dialog> in feature templates; a regression to one would
    // still open a dialog, so assert the mechanism rather than the visible result.
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe(ClaGroupSelectComponent);
    expect(fixture.nativeElement.querySelector('p-dialog')).toBeNull();
  });

  it('navigates to the resolved Console URL in the same tab', async () => {
    const fixture = await setup();

    (fixture.componentInstance as any).openSignDialog();
    await fixture.whenStable();

    expect(getSignUrl).toHaveBeenCalledWith('cg-1');
    // Same tab, not a new one: the Console returns the contributor here afterwards.
    expect(location.href).toBe('https://easycla.dev.communitybridge.org/#/cla/project/cg-1/user/u-1?redirect=enc');
  });

  it('never composes the URL client-side from a guessed identifier', async () => {
    const fixture = await setup();

    (fixture.componentInstance as any).openSignDialog();
    await fixture.whenStable();

    // The only source of the contributor id is the server round trip.
    expect(getSignUrl).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the contributor backs out of the picker', async () => {
    const fixture = await setup({ closesWith: null });

    (fixture.componentInstance as any).openSignDialog();
    await fixture.whenStable();

    expect(getSignUrl).not.toHaveBeenCalled();
    expect(location.href).toBe('https://app.dev.lfx.dev/profile/clas');
  });

  it('stays on the page and reports failure when the hand-off cannot be resolved', async () => {
    const fixture = await setup({ signUrl: () => throwError(() => new Error('resolution failed')) });

    (fixture.componentInstance as any).openSignDialog();
    await fixture.whenStable();

    // A failed resolution must not navigate to a half-built URL — the Console would show
    // "invalid user ID", which reads as a broken product rather than a failed lookup.
    expect(location.href).toBe('https://app.dev.lfx.dev/profile/clas');
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });

  it('ignores a second hand-off while one is already resolving', async () => {
    const pending = new Subject<string>();
    const fixture = await setup({ signUrl: () => pending.asObservable() });

    (fixture.componentInstance as any).openSignDialog();
    (fixture.componentInstance as any).openSignDialog();

    expect(getSignUrl).toHaveBeenCalledTimes(1);
  });
});
