// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Injecting Router pulls in @angular/common's partially-compiled PlatformLocation, which needs
// the JIT compiler under vitest. Same reason as clas.route.spec.ts.
import '@angular/compiler';

import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router, RouterLink } from '@angular/router';
import type { ClaGroupOption, GithubAccountOptions, MyClaAgreement, MyClasResponse, SigningIdentityResponse } from '@lfx-one/shared/interfaces';
import { ButtonComponent } from '@components/button/button.component';
import { MenuComponent } from '@components/menu/menu.component';
import { TagComponent } from '@components/tag/tag.component';
import { MyClasService } from '@services/my-clas.service';
import { UserService } from '@services/user.service';
import { MenuItem, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaGroupSelectComponent } from './cla-group-select.component';
import { GithubAccountSelectComponent } from './github-account-select.component';
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
    // Scoped to the `lfx-button` host rather than `By.directive(RouterLink)`: the wrapped `<p-button>`
    // also matches `[routerLink]`, so an unscoped query is ambiguous about which of the two instances
    // it means, even though preorder traversal happens to resolve the host one today. Querying the
    // host directly says which instance we mean and survives a change in nesting.
    const ctaButton = emptyState.query(By.directive(ButtonComponent));
    if (!ctaButton) throw new Error('empty state rendered no lfx-button CTA');
    const urlTree = ctaButton.injector.get(RouterLink).urlTree;
    if (!urlTree) throw new Error('empty state CTA resolved no urlTree');
    expect(TestBed.inject(Router).serializeUrl(urlTree)).toBe('/docs/account/my-clas');
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
 * Covers the Sign CLA hand-off entry point (#1251) and the GitHub account step that now sits
 * inside it (#1252).
 *
 * Each picker is a dynamic dialog with its own spec; what matters here is the orchestration —
 * that the action is offered only when it can succeed, that the number of linked accounts
 * decides whether a choice is even presented, that the association is recorded before a URL is
 * built from it, and that a refusal ends the flow rather than quietly picking another account.
 * The template is rendered rather than overridden, because whether the action is offered at all
 * is a template condition.
 */
describe('ProfileClasComponent — Sign CLA hand-off and account selection (#1251, #1252)', () => {
  const CLA_GROUP: ClaGroupOption = { claGroupId: 'cg-1', projectName: 'Venus test' };
  const EMPTY_CLAS: MyClasResponse = { agreements: [], identity: { matchedUserIds: 1, unmatched: false, githubLinked: true } };
  const HOME = 'https://app.dev.lfx.dev/profile/clas';
  const CONSOLE_URL = 'https://easycla.dev.communitybridge.org/#/cla/project/cg-1/user/u-1?redirect=enc';

  const ONE_ACCOUNT: GithubAccountOptions = { accounts: [{ githubId: '12345', githubUsername: 'octocat' }] };
  const TWO_ACCOUNTS: GithubAccountOptions = {
    accounts: [
      { githubId: '12345', githubUsername: 'octocat' },
      { githubId: '67890', githubUsername: 'hubot' },
    ],
  };
  const BOUND: SigningIdentityResponse = { claUserId: 'u-1', githubId: '12345', githubUsername: 'octocat', redirectUrl: HOME };

  let location: { href: string };
  let messageAdd: ReturnType<typeof vi.fn>;
  let getGithubAccounts: ReturnType<typeof vi.fn>;
  let bindSigningIdentity: ReturnType<typeof vi.fn>;
  let buildSignUrlFor: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  /** Records dialog opens in order, so "which dialog, and was it opened at all" is assertable. */
  let opened: unknown[];

  async function setup(
    options: {
      impersonating?: boolean;
      accounts?: () => Observable<GithubAccountOptions>;
      bind?: () => Observable<SigningIdentityResponse>;
      closesWith?: ClaGroupOption | null;
      accountClosesWith?: string | null;
    } = {}
  ): Promise<ComponentFixture<ProfileClasComponent>> {
    location = { href: HOME };
    messageAdd = vi.fn();
    opened = [];
    getGithubAccounts = vi.fn(options.accounts ?? (() => of(TWO_ACCOUNTS)));
    bindSigningIdentity = vi.fn(options.bind ?? (() => of(BOUND)));
    buildSignUrlFor = vi.fn(() => CONSOLE_URL);

    open = vi.fn((component: unknown) => {
      opened.push(component);
      if (component === GithubAccountSelectComponent) {
        return { onClose: of('accountClosesWith' in options ? options.accountClosesWith : '12345') };
      }
      return { onClose: of('closesWith' in options ? options.closesWith : CLA_GROUP) };
    });

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
          useValue: {
            getMyClas: vi.fn(() => of(EMPTY_CLAS)),
            getPdfUrl: vi.fn(),
            getClaGroupOptions: vi.fn(() => of([CLA_GROUP])),
            getGithubAccounts,
            bindSigningIdentity,
            buildSignUrlFor,
          },
        },
      ],
    });
    TestBed.overrideProvider(MessageService, { useValue: { add: messageAdd, addAll: vi.fn(), clear: vi.fn(), messageObserver: of(), clearObserver: of() } });
    TestBed.overrideProvider(DialogService, { useValue: { open } });

    const fixture = TestBed.createComponent(ProfileClasComponent);
    navigate = vi.fn(() => Promise.resolve(true));
    TestBed.inject(Router).navigate = navigate as never;
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  function query(fixture: ComponentFixture<ProfileClasComponent>, testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  /** Runs the whole flow from the entry point, as a click would. */
  async function sign(fixture: ComponentFixture<ProfileClasComponent>): Promise<void> {
    (fixture.componentInstance as any).openSignDialog();
    await fixture.whenStable();
  }

  /** Rejects the binding with the reason code shape the BFF forwards from upstream. */
  function refusedWith(reason: string): () => Observable<SigningIdentityResponse> {
    return () => throwError(() => ({ status: 403, error: { upstreamCode: reason } }));
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('offers the Sign CLA action in a normal session', async () => {
    const fixture = await setup();

    expect(query(fixture, 'sign-cla-action')).not.toBeNull();
  });

  it('withholds the action while impersonating, since the server refuses the write', async () => {
    const fixture = await setup({ impersonating: true });

    expect(query(fixture, 'sign-cla-action')).toBeNull();
  });

  it('opens the picker through DialogService rather than a template dialog', async () => {
    const fixture = await setup();

    query(fixture, 'sign-cla-action')?.querySelector('button')?.click();
    await fixture.whenStable();

    // The frontend checklist forbids <p-dialog> in feature templates; a regression to one would
    // still open a dialog, so assert the mechanism rather than the visible result.
    expect(open).toHaveBeenCalled();
    expect(opened[0]).toBe(ClaGroupSelectComponent);
    expect(fixture.nativeElement.querySelector('p-dialog')).toBeNull();
  });

  it('does nothing when the contributor backs out of the project picker', async () => {
    const fixture = await setup({ closesWith: null });

    await sign(fixture);

    expect(getGithubAccounts).not.toHaveBeenCalled();
    expect(bindSigningIdentity).not.toHaveBeenCalled();
    expect(location.href).toBe(HOME);
  });

  // --- Cardinality (FR-002) -------------------------------------------------

  it('asks which account to sign as when several are linked', async () => {
    const fixture = await setup({ accounts: () => of(TWO_ACCOUNTS) });

    await sign(fixture);

    expect(opened).toContain(GithubAccountSelectComponent);
    expect(open.mock.calls.at(-1)?.[1]).toMatchObject({ data: { accounts: TWO_ACCOUNTS.accounts } });
    // The account number only. The handle is read from the session by the server, so sending
    // one from here could only ever contradict it.
    expect(bindSigningIdentity).toHaveBeenCalledWith('12345');
  });

  it('submits the account chosen, not the first one listed', async () => {
    const fixture = await setup({ accounts: () => of(TWO_ACCOUNTS), accountClosesWith: '67890' });

    await sign(fixture);

    expect(bindSigningIdentity).toHaveBeenCalledWith('67890');
  });

  it('does not submit an account that is not in the served list', async () => {
    const fixture = await setup({ accounts: () => of(TWO_ACCOUNTS), accountClosesWith: '99999' });

    await sign(fixture);

    // The served list is what establishes the account is the contributor's, since upstream
    // records what it is sent. An account from anywhere else must never be submitted.
    expect(bindSigningIdentity).not.toHaveBeenCalled();
    expect(location.href).toBe(HOME);
  });

  it('skips the choice but still records it when exactly one account is linked', async () => {
    const fixture = await setup({ accounts: () => of(ONE_ACCOUNT) });

    await sign(fixture);

    // "No picker" must not become "no binding" — dropping the write here would leave the
    // single-account contributor on the old, order-dependent resolution.
    expect(opened).not.toContain(GithubAccountSelectComponent);
    expect(bindSigningIdentity).toHaveBeenCalledWith('12345');
    expect(location.href).toBe(CONSOLE_URL);
  });

  it('routes to account linking rather than showing an empty picker when none are linked', async () => {
    const fixture = await setup({ accounts: () => of({ accounts: [] }) });

    await sign(fixture);

    expect(opened).not.toContain(GithubAccountSelectComponent);
    expect(bindSigningIdentity).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/profile/identities']);
    expect(location.href).toBe(HOME);
  });

  it('treats an account-list failure as a failure, not as zero accounts', async () => {
    const fixture = await setup({ accounts: () => throwError(() => new Error('identity lookup failed')) });

    await sign(fixture);

    // Routing this into account linking would tell a contributor who has a linked account to
    // go connect one — sending them to fix something that is not broken.
    expect(navigate).not.toHaveBeenCalled();
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
    expect(location.href).toBe(HOME);
  });

  it('does nothing when the contributor backs out of the account picker', async () => {
    const fixture = await setup({ accountClosesWith: null });

    await sign(fixture);

    expect(bindSigningIdentity).not.toHaveBeenCalled();
    expect(location.href).toBe(HOME);
  });

  // --- Ordering and identifier provenance (FR-003, FR-007, FR-012) ----------

  it('records the association before assembling the hand-off URL', async () => {
    const pending = new Subject<SigningIdentityResponse>();
    const fixture = await setup({ bind: () => pending.asObservable() });

    await sign(fixture);

    // A URL built from an identifier obtained beforehand could carry a record the binding then
    // refuses, so nothing may be assembled while the write is still outstanding.
    expect(buildSignUrlFor).not.toHaveBeenCalled();
    expect(location.href).toBe(HOME);

    pending.next(BOUND);
    await fixture.whenStable();

    expect(location.href).toBe(CONSOLE_URL);
  });

  it('builds the URL from the binding answer, never from a locally held identifier', async () => {
    const fixture = await setup();

    await sign(fixture);

    // The identifier's only source is what the binding settled on.
    expect(buildSignUrlFor).toHaveBeenCalledWith('cg-1', BOUND);
    // Same tab, not a new one: the Console returns the contributor here afterwards.
    expect(location.href).toBe(CONSOLE_URL);
  });

  it('stops the hand-off when the recorded account is not the chosen one', async () => {
    // The picker closes with 12345; the binding answers with a different account. Upstream is
    // content — it confirmed the record holds the account it was sent — so nothing below this
    // layer can notice. Only comparing what came back against what went in catches a
    // signature about to be attributed to an account nobody chose.
    const fixture = await setup({
      accountClosesWith: '12345',
      bind: () => of({ ...BOUND, githubId: '67890', githubUsername: 'hubot' }),
    });

    await sign(fixture);

    expect(buildSignUrlFor).not.toHaveBeenCalled();
    expect(location.href).toBe(HOME);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Could not start signing' }));
  });

  it('proceeds when the recorded account matches, so the check is not merely blocking everything', async () => {
    const fixture = await setup({ accountClosesWith: '67890', bind: () => of({ ...BOUND, githubId: '67890', githubUsername: 'hubot' }) });

    await sign(fixture);

    expect(location.href).toBe(CONSOLE_URL);
  });

  it('ignores a second hand-off while one is already in flight', async () => {
    const pending = new Subject<GithubAccountOptions>();
    const fixture = await setup({ accounts: () => pending.asObservable() });

    (fixture.componentInstance as any).openSignDialog();
    (fixture.componentInstance as any).openSignDialog();

    expect(getGithubAccounts).toHaveBeenCalledTimes(1);
  });

  // --- Refusals (FR-013, FR-014) -------------------------------------------

  it('refuses without retrying with a different account', async () => {
    const fixture = await setup({ bind: refusedWith('record_conflict') });

    await sign(fixture);

    // Substituting an account the contributor did not choose is the exact failure this
    // feature removes, so a second binding attempt must not happen.
    expect(bindSigningIdentity).toHaveBeenCalledTimes(1);
    expect(location.href).toBe(HOME);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });

  // Account linking is reached only from an empty account list, which is a fact about this
  // session rather than an upstream answer. Routing a refusal there would send someone who does
  // have a linked account to fix something that is not broken.
  it.each(['identity_unavailable', 'record_conflict', 'record_unclaimed', 'lf_record_already_bound', 'recorded_mismatch'] as const)(
    'does not route the %s refusal into account linking',
    async (reason) => {
      const fixture = await setup({ bind: refusedWith(reason) });

      await sign(fixture);

      expect(navigate).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['identity_unavailable', 'sign in again'],
    ['identity_mismatch', 'sign in again'],
    ['record_conflict', 'already associated'],
    ['duplicate_github_id', 'already associated'],
    // An unclaimed record needs a human to say whose it is, which is the same instruction as a
    // contested one from the contributor's side, so it deliberately shares that message.
    ['record_unclaimed', 'already associated'],
    // Points the other way to the three above — the contributor's own record holds the other
    // account — so it must not collapse into their message, nor into the generic retry copy for
    // a refusal that retrying cannot clear.
    ['lf_record_already_bound', 'second account is not supported'],
    ['recorded_mismatch', 'stopped before signing'],
  ])('explains the %s refusal in its own terms', async (reason, expected) => {
    const fixture = await setup({ bind: refusedWith(reason) });

    await sign(fixture);

    expect(location.href).toBe(HOME);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining(expected) }));
  });

  it('stays on the page when the binding fails without a reason code', async () => {
    const fixture = await setup({ bind: () => throwError(() => new Error('network down')) });

    await sign(fixture);

    // Navigating on a failed binding would land the contributor on the Console's "invalid user
    // ID" screen, which reads as a broken product rather than a failed write.
    expect(location.href).toBe(HOME);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });
});
