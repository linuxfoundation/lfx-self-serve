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
import { MY_CLAS_M2_ENABLED_FLAG } from '@lfx-one/shared/constants';
import type {
  ClaGroupOption,
  ClaGroupSearchResponse,
  GithubAccountOptions,
  MyClaAgreement,
  MyClasResponse,
  PrepareSignResponse,
} from '@lfx-one/shared/interfaces';
import { ButtonComponent } from '@components/button/button.component';
import { MenuComponent } from '@components/menu/menu.component';
import { TagComponent } from '@components/tag/tag.component';
import { FeatureFlagService } from '@services/feature-flag.service';
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

  async function render(agreements: MyClaAgreement[], options: { m2Enabled?: boolean } = {}): Promise<void> {
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
        // Existing tests document M2 overlay behaviour; pin the flag on unless a case opts out.
        {
          provide: FeatureFlagService,
          useValue: { getBooleanFlag: vi.fn((key: string) => signal(key === MY_CLAS_M2_ENABLED_FLAG ? (options.m2Enabled ?? true) : false)) },
        },
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

  const eclaDownloadLabel = 'Download PDF<br><span class="mt-0.5 block text-xs font-normal">Covered by Corporate CLA (CCLA)</span>';

  function actionsTrigger(id: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="agreement-row-actions-${id}"]`);
  }

  function headers(): string[] {
    return Array.from(fixture.nativeElement.querySelectorAll('th') as NodeListOf<HTMLElement>).map((th) => th.textContent?.trim() ?? '');
  }

  it('renders Valid / Needs attention / Revoked / Invalidated with the matching severities', async () => {
    await render([
      agreement({ id: 's-valid', status: 'valid' }),
      agreement({ id: 's-attn', kind: 'ECLA', status: 'needs_attention', pdfAvailable: false, companyName: 'Acme' }),
      agreement({ id: 's-rev', kind: 'ECLA', status: 'revoked', pdfAvailable: false, companyName: 'Acme' }),
      agreement({ id: 's-inv', status: 'invalidated', pdfAvailable: false }),
    ]);

    expect(statusTag('s-valid').value()).toBe('Valid');
    expect(statusTag('s-valid').severity()).toBe('success');
    expect(statusTag('s-attn').value()).toBe('Needs attention');
    expect(statusTag('s-attn').severity()).toBe('warn');
    expect(statusTag('s-rev').value()).toBe('Revoked');
    expect(statusTag('s-rev').severity()).toBe('secondary');
    expect(statusTag('s-inv').value()).toBe('Invalidated');
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

  it('shows a disabled Download PDF item with a Covered by Corporate CLA line on an ECLA row', async () => {
    await render([agreement({ id: 's-ecla', kind: 'ECLA', pdfAvailable: false, companyName: 'Acme' })]);

    expect(menuItems('s-ecla').map((item) => item.label)).toEqual([eclaDownloadLabel, 'Request Removal']);
    expect(menuItems('s-ecla')[0]).toMatchObject({ disabled: true, escape: false });
  });

  it('offers Request approval, Request Removal, and Contact on a Needs-attention ECLA off the Approved List', async () => {
    await render([
      agreement({
        id: 's-attn',
        kind: 'ECLA',
        pdfAvailable: false,
        status: 'needs_attention',
        statusReason: 'not_on_approval_list',
        companyName: 'Acme',
      }),
    ]);

    expect(menuItems('s-attn').map((item) => item.label)).toEqual([eclaDownloadLabel, 'Request approval', 'Request Removal', 'Contact CLA Manager']);
  });

  it('keeps a stable menu model across change detection so the popup can open on the first click', async () => {
    await render([agreement({ id: 's-icla', kind: 'ICLA', pdfAvailable: true })]);

    const first = menuItems('s-icla');
    fixture.detectChanges();
    expect(menuItems('s-icla')).toBe(first);
  });

  it('does not render a placeholder Invalidate item', async () => {
    await render([
      agreement({ id: 's-icla', kind: 'ICLA', pdfAvailable: true }),
      agreement({ id: 's-ecla', kind: 'ECLA', pdfAvailable: false, status: 'needs_attention' }),
      agreement({ id: 's-inv', status: 'invalidated', pdfAvailable: false }),
    ]);

    const labels = ['s-icla', 's-ecla', 's-inv'].flatMap((id) => (rowMenu(id)?.model() ?? []).map((item) => item.label ?? ''));
    expect(labels.some((label) => /invalidate/i.test(label))).toBe(false);
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

  it('renders no actions trigger on a revoked row', async () => {
    await render([agreement({ id: 's-rev', kind: 'ECLA', status: 'revoked', pdfAvailable: false, companyName: 'Acme' })]);

    // A revoked row is read-only, and without this it would take the ECLA fallback and tell
    // someone whose employer failed sanctions screening that a Corporate CLA still covers them.
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-row-s-rev"]')).toBeTruthy();
    expect(actionsTrigger('s-rev')).toBeNull();
    expect(rowMenu('s-rev')).toBeNull();
  });

  it('keeps Request Removal on an invalidated ECLA — that row is not in the prototype', async () => {
    await render([agreement({ id: 's-inv-ecla', kind: 'ECLA', status: 'invalidated', pdfAvailable: false, companyName: 'Acme' })]);

    expect(menuItems('s-inv-ecla').map((item) => item.label)).toEqual([eclaDownloadLabel, 'Request Removal']);
    expect(menuItems('s-inv-ecla')[0].disabled).toBe(true);
  });

  function signedAs(id: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="agreement-signed-as-${id}"]`);
  }

  it('renders Signed as {identity} (GitHub) / (GitLab) / no suffix under the date', async () => {
    await render([
      agreement({ id: 's-gh', signedVia: 'github', signedAs: 'jellis' }),
      agreement({ id: 's-gl', signedVia: 'gitlab', signedAs: 'jellis' }),
      agreement({ id: 's-email', signedVia: 'gerrit', signedAs: 'jellis@acme-motors.example' }),
    ]);

    expect(signedAs('s-gh')?.textContent?.trim()).toBe('Signed as jellis (GitHub)');
    expect(signedAs('s-gl')?.textContent?.trim()).toBe('Signed as jellis (GitLab)');
    expect(signedAs('s-email')?.textContent?.trim()).toBe('Signed as jellis@acme-motors.example');
    expect(headers()).toEqual(['Project', 'Type', 'Status', 'Signed', 'Actions']);
  });

  it('still shows the identity line on Revoked and Invalidated rows', async () => {
    await render([
      agreement({ id: 's-rev', kind: 'ECLA', status: 'revoked', pdfAvailable: false, companyName: 'Acme', signedVia: 'github', signedAs: 'jellis' }),
      agreement({ id: 's-inv', kind: 'ICLA', status: 'invalidated', pdfAvailable: true, signedVia: 'github', signedAs: 'jellis' }),
    ]);

    expect(signedAs('s-rev')?.textContent?.trim()).toBe('Signed as jellis (GitHub)');
    expect(signedAs('s-inv')?.textContent?.trim()).toBe('Signed as jellis (GitHub)');
    expect(actionsTrigger('s-rev')).toBeNull();
    expect(actionsTrigger('s-inv')).toBeNull();
  });

  it('renders no actions trigger on an invalidated ICLA even when a document exists', async () => {
    await render([agreement({ id: 's-inv', kind: 'ICLA', status: 'invalidated', pdfAvailable: true })]);

    expect(fixture.nativeElement.querySelector('[data-testid="agreement-row-s-inv"]')).toBeTruthy();
    expect(actionsTrigger('s-inv')).toBeNull();
    expect(rowMenu('s-inv')).toBeNull();
  });

  it('omits the identity line when the producer sent no identity', async () => {
    await render([
      agreement({ id: 's-none' }),
      agreement({ id: 's-blank', signedVia: 'github', signedAs: '   ' }),
      agreement({ id: 's-via-only', signedVia: 'github' }),
      agreement({ id: 's-as-only', signedAs: 'jellis' }),
    ]);

    expect(signedAs('s-none')).toBeNull();
    expect(signedAs('s-blank')).toBeNull();
    expect(signedAs('s-via-only')).toBeNull();
    expect(signedAs('s-as-only')?.textContent?.trim()).toBe('Signed as jellis');
    expect(signedAs('s-as-only')?.tagName.toLowerCase()).not.toBe('a');
  });

  it('hides Sign CLA, Status, kebab, and Signed as when my-clas-m2-enabled is off', async () => {
    await render(
      [
        agreement({
          id: 's-m1',
          signedOn: '2022-01-01',
          signedVia: 'github',
          signedAs: 'jellis',
          pdfAvailable: true,
        }),
      ],
      { m2Enabled: false }
    );

    expect(headers()).toEqual(['Project', 'Type', 'Signed', 'Document']);
    expect(fixture.nativeElement.querySelector('[data-testid="sign-cla-action"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-status-s-m1"]')).toBeNull();
    expect(actionsTrigger('s-m1')).toBeNull();
    expect(rowMenu('s-m1')).toBeNull();
    expect(signedAs('s-m1')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-row-s-m1"]')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Project One');
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-row-s-m1"]')?.textContent).toMatch(/2021|2022/);
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-document-s-m1"]')?.textContent).toContain('Download PDF');
  });

  it('restores the M1 Document column when my-clas-m2-enabled is off', async () => {
    await render(
      [
        agreement({ id: 's-icla', kind: 'ICLA', pdfAvailable: true }),
        agreement({ id: 's-ecla', kind: 'ECLA', pdfAvailable: false, companyName: 'Acme' }),
        agreement({ id: 's-nopdf', kind: 'ICLA', pdfAvailable: false }),
      ],
      { m2Enabled: false }
    );

    expect(headers()).toEqual(['Project', 'Type', 'Signed', 'Document']);
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-document-s-icla"]')?.textContent).toContain('Download PDF');
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-document-s-ecla"]')?.textContent?.trim()).toBe('Covered by Corporate CLA (CCLA)');
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-document-s-nopdf"]')?.textContent?.trim()).toBe('PDF unavailable');
    expect(actionsTrigger('s-icla')).toBeNull();
  });
});

/**
 * Covers the Sign CLA hand-off entry point (#1251) and the GitHub account step that now sits
 * inside it (#1252).
 *
 * Each picker is a dynamic dialog with its own spec; what matters here is the orchestration —
 * that the action is offered only when it can succeed, that the number of linked accounts
 * decides whether a choice is even presented, that the address navigated to is the one the CLA
 * backend returned rather than one assembled here, and that a refusal ends the flow rather than
 * quietly picking another account. The template is rendered rather than overridden, because
 * whether the action is offered at all is a template condition.
 */
describe('ProfileClasComponent — Sign CLA hand-off and account selection (#1251, #1252)', () => {
  const CLA_GROUP: ClaGroupOption = { claGroupId: 'cg-1', projectName: 'Venus test', matchTypes: ['project'], organizations: [] };
  const SEARCH_RESULTS: ClaGroupSearchResponse = { searchTerm: 'venus', resultCount: 1, truncated: false, results: [CLA_GROUP] };
  const EMPTY_CLAS: MyClasResponse = { agreements: [], identity: { matchedUserIds: 1, unmatched: false, githubLinked: true } };
  const HOME = 'https://app.dev.lfx.dev/profile/clas';
  /** Composed by the CLA backend and returned on the prepare, never assembled in this app. */
  const SIGN_URL = 'https://easycla.dev.communitybridge.org/#/cla/project/cg-1/user/u-1?redirect=enc';
  /** The CLA backend's own 403 prose — the single string a refusal is explained with (FR-007). */
  const OWNERSHIP_REFUSAL = 'the provided identity does not belong to the authenticated user';

  const ONE_ACCOUNT: GithubAccountOptions = { accounts: [{ githubId: '12345', githubUsername: 'octocat' }] };
  const TWO_ACCOUNTS: GithubAccountOptions = {
    accounts: [
      { githubId: '12345', githubUsername: 'octocat' },
      { githubId: '67890', githubUsername: 'hubot' },
    ],
  };
  const PREPARED: PrepareSignResponse = { userId: 'u-1', signUrl: SIGN_URL, githubId: '12345', githubUsername: 'octocat', skippedIdentities: [] };

  let location: { href: string };
  let messageAdd: ReturnType<typeof vi.fn>;
  let getGithubAccounts: ReturnType<typeof vi.fn>;
  let prepareSign: ReturnType<typeof vi.fn>;
  let buildSignUrlFor: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  /** Records dialog opens in order, so "which dialog, and was it opened at all" is assertable. */
  let opened: unknown[];

  async function setup(
    options: {
      impersonating?: boolean;
      m2Enabled?: boolean;
      accounts?: () => Observable<GithubAccountOptions>;
      prepare?: () => Observable<PrepareSignResponse>;
      closesWith?: ClaGroupOption | null;
      accountClosesWith?: string | null;
    } = {}
  ): Promise<ComponentFixture<ProfileClasComponent>> {
    location = { href: HOME };
    messageAdd = vi.fn();
    opened = [];
    getGithubAccounts = vi.fn(options.accounts ?? (() => of(TWO_ACCOUNTS)));
    prepareSign = vi.fn(options.prepare ?? (() => of(PREPARED)));
    // Kept on the stub purely so a regression to client-side URL construction is assertable
    // rather than a bare TypeError. Production must never reach it (FR-004).
    buildSignUrlFor = vi.fn(() => SIGN_URL);

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
          provide: FeatureFlagService,
          useValue: {
            getBooleanFlag: vi.fn((key: string) => signal(key === MY_CLAS_M2_ENABLED_FLAG ? (options.m2Enabled ?? true) : false)),
          },
        },
        {
          provide: MyClasService,
          useValue: {
            getMyClas: vi.fn(() => of(EMPTY_CLAS)),
            getPdfUrl: vi.fn(),
            getClaGroupOptions: vi.fn(() => of(SEARCH_RESULTS)),
            getGithubAccounts,
            prepareSign,
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

  /** Rejects the prepare the way the BFF surfaces an upstream refusal: a status and a message. */
  function refusedWith(status: number, message: string): () => Observable<PrepareSignResponse> {
    return () => throwError(() => ({ status, error: { error: message, code: status === 403 ? 'FORBIDDEN' : 'UPSTREAM_ERROR' } }));
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

  it('withholds Sign CLA when my-clas-m2-enabled is off', async () => {
    const fixture = await setup({ m2Enabled: false });

    expect(query(fixture, 'sign-cla-action')).toBeNull();
    (fixture.componentInstance as any).openSignDialog();
    await fixture.whenStable();
    expect(opened).toEqual([]);
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
    expect(prepareSign).not.toHaveBeenCalled();
    expect(location.href).toBe(HOME);
  });

  // --- Cardinality (FR-002) -------------------------------------------------

  it('asks which account to sign as when several are linked', async () => {
    const fixture = await setup({ accounts: () => of(TWO_ACCOUNTS) });

    await sign(fixture);

    expect(opened).toContain(GithubAccountSelectComponent);
    expect(open.mock.calls.at(-1)?.[1]).toMatchObject({ data: { accounts: TWO_ACCOUNTS.accounts } });
    // The account number and the confirmed group, and nothing else. The handle and the return
    // address are the server's to supply, so sending either from here could only contradict it.
    expect(prepareSign).toHaveBeenCalledWith({ githubId: '12345', claGroupId: 'cg-1' });
  });

  it('submits the account chosen, not the first one listed', async () => {
    const fixture = await setup({ accounts: () => of(TWO_ACCOUNTS), accountClosesWith: '67890' });

    await sign(fixture);

    expect(prepareSign).toHaveBeenCalledWith({ githubId: '67890', claGroupId: 'cg-1' });
  });

  it('does not submit an account that is not in the served list', async () => {
    const fixture = await setup({ accounts: () => of(TWO_ACCOUNTS), accountClosesWith: '99999' });

    await sign(fixture);

    // The served list is what this layer matched the pick against; an account from anywhere
    // else names something the contributor was never shown.
    expect(prepareSign).not.toHaveBeenCalled();
    expect(location.href).toBe(HOME);
  });

  it('skips the choice but still prepares when exactly one account is linked', async () => {
    const fixture = await setup({ accounts: () => of(ONE_ACCOUNT) });

    await sign(fixture);

    // "No picker" must not become "no prepare" — dropping the call here would leave the
    // single-account contributor with no signing session and no verified identity.
    expect(opened).not.toContain(GithubAccountSelectComponent);
    expect(prepareSign).toHaveBeenCalledWith({ githubId: '12345', claGroupId: 'cg-1' });
    expect(location.href).toBe(SIGN_URL);
  });

  it('routes to account linking rather than showing an empty picker when none are linked', async () => {
    const fixture = await setup({ accounts: () => of({ accounts: [] }) });

    await sign(fixture);

    expect(opened).not.toContain(GithubAccountSelectComponent);
    expect(prepareSign).not.toHaveBeenCalled();
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

    expect(prepareSign).not.toHaveBeenCalled();
    expect(location.href).toBe(HOME);
  });

  // --- Where the hand-off address comes from (FR-004, FR-006) ---------------

  it('waits for the prepared session before leaving the page', async () => {
    const pending = new Subject<PrepareSignResponse>();
    const fixture = await setup({ prepare: () => pending.asObservable() });

    await sign(fixture);

    expect(location.href).toBe(HOME);

    pending.next(PREPARED);
    await fixture.whenStable();

    expect(location.href).toBe(SIGN_URL);
  });

  it('navigates to the address the CLA backend returned, never one assembled here', async () => {
    const fixture = await setup();

    await sign(fixture);

    // Assembling the Console path from a console base, the group id and the user id would ignore
    // the signing session the prepare just opened, and any later change upstream to that URL.
    expect(buildSignUrlFor).not.toHaveBeenCalled();
    // Same tab, not a new one: the Console returns the contributor here afterwards.
    expect(location.href).toBe(SIGN_URL);
  });

  it('stops the hand-off when the verified account is not the chosen one', async () => {
    // The picker closes with 12345; the prepare answers with a different account. Upstream is
    // content — both accounts pass an ownership check when both belong to the contributor — so
    // nothing below this layer can notice. Only comparing what came back against what went in
    // catches a signature about to be attributed to an account nobody chose.
    const fixture = await setup({
      accountClosesWith: '12345',
      prepare: () => of({ ...PREPARED, githubId: '67890', githubUsername: 'hubot' }),
    });

    await sign(fixture);

    expect(location.href).toBe(HOME);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Could not start signing' }));
  });

  it('proceeds when the verified account matches, so the check is not merely blocking everything', async () => {
    const fixture = await setup({ accountClosesWith: '67890', prepare: () => of({ ...PREPARED, githubId: '67890', githubUsername: 'hubot' }) });

    await sign(fixture);

    expect(location.href).toBe(SIGN_URL);
  });

  it('does not hand off a success that skipped the chosen account', async () => {
    // A 200 that skipped the pick still opened a session — for whatever identity it did verify.
    // The server refuses this too; the second guard is here because this is the only layer that
    // saw the picker.
    const fixture = await setup({
      accountClosesWith: '12345',
      prepare: () => of({ ...PREPARED, githubId: '67890', githubUsername: 'hubot', skippedIdentities: ['github-id:12345'] }),
    });

    await sign(fixture);

    expect(location.href).toBe(HOME);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Could not start signing' }));
  });

  it('reports a mismatch as a mismatch, not as a failure to open the page', async () => {
    const fixture = await setup({ accountClosesWith: '12345', prepare: () => of({ ...PREPARED, githubId: '67890' }) });

    await sign(fixture);

    // Nothing upstream went wrong, so "we could not open the CLA signing page" would be a lie
    // and "try again" is the honest instruction.
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining('stopped before signing') }));
  });

  it('ignores a second hand-off while one is already in flight', async () => {
    const pending = new Subject<GithubAccountOptions>();
    const fixture = await setup({ accounts: () => pending.asObservable() });

    (fixture.componentInstance as any).openSignDialog();
    (fixture.componentInstance as any).openSignDialog();

    expect(getGithubAccounts).toHaveBeenCalledTimes(1);
  });

  // --- Refusals (FR-007) ----------------------------------------------------

  it('refuses without retrying with a different account', async () => {
    const fixture = await setup({ prepare: refusedWith(403, OWNERSHIP_REFUSAL) });

    await sign(fixture);

    // Substituting an account the contributor did not choose is the exact failure this
    // feature removes, so a second prepare must not happen.
    expect(prepareSign).toHaveBeenCalledTimes(1);
    expect(location.href).toBe(HOME);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });

  it("explains an ownership refusal in the CLA backend's own words", async () => {
    const fixture = await setup({ prepare: refusedWith(403, OWNERSHIP_REFUSAL) });

    await sign(fixture);

    // The prepare endpoint ships no machine-readable reason, so per-reason copy could only be
    // guessed from this prose. One honest string beats a family of invented ones.
    expect(location.href).toBe(HOME);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Could not start signing', detail: OWNERSHIP_REFUSAL }));
  });

  it('shows one message for a refusal, not a reason-coded family', async () => {
    const fixture = await setup({ prepare: refusedWith(403, OWNERSHIP_REFUSAL) });

    await sign(fixture);

    expect(messageAdd).toHaveBeenCalledTimes(1);
  });

  it.each([
    [404, 'cla group not found'],
    [400, 'returnUrl must be an absolute https URL'],
    [502, 'Upstream prepared no usable signing session'],
  ])('does not dress a %i up as an ownership refusal', async (status, message) => {
    const fixture = await setup({ prepare: refusedWith(status, message) });

    await sign(fixture);

    // A missing group and a rejected return address are failures to prepare, not statements
    // about who the contributor is — telling them their identity was rejected would send them
    // to re-link an account that is fine.
    expect(location.href).toBe(HOME);
    const detail = messageAdd.mock.calls[0]?.[0]?.detail as string;
    expect(detail).not.toBe(OWNERSHIP_REFUSAL);
    expect(detail).toContain('We could not open the CLA signing page');
  });

  it('does not route a refusal into account linking', async () => {
    // Account linking is reached only from an empty account list, which is a fact about this
    // session rather than an upstream answer. Routing a refusal there would send someone who
    // does have a linked account to fix something that is not broken.
    const fixture = await setup({ prepare: refusedWith(403, OWNERSHIP_REFUSAL) });

    await sign(fixture);

    expect(navigate).not.toHaveBeenCalled();
  });

  it('stays on the page when the prepare fails outright', async () => {
    const fixture = await setup({ prepare: () => throwError(() => new Error('network down')) });

    await sign(fixture);

    // Navigating on a failed prepare would land the contributor on the Console's "invalid user
    // ID" screen, which reads as a broken product rather than a failed call.
    expect(location.href).toBe(HOME);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });
});
