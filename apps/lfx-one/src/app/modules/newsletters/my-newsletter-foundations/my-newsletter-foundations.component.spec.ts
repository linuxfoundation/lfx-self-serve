// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { MyNewsletterFoundation, MyNewsletterFoundationsResponse } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { PersonaService } from '@services/persona.service';
import { DialogService } from 'primeng/dynamicdialog';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NewsletterInviteDialogComponent } from '../components/newsletter-invite-dialog/newsletter-invite-dialog.component';
import { MyNewsletterFoundationsComponent } from './my-newsletter-foundations.component';

function foundation(overrides: Partial<MyNewsletterFoundation> = {}): MyNewsletterFoundation {
  return {
    uid: 'acme-uid',
    slug: 'acme-foundation',
    name: 'Acme Foundation',
    logo_url: null,
    received_count: 2,
    last_sent_at: '2026-08-13T10:00:00Z',
    newsletter_group: { uid: 'acme-group', name: 'Acme Foundation Newsletter' },
    can_invite: true,
    ...overrides,
  };
}

function response(overrides: Partial<MyNewsletterFoundationsResponse> = {}): MyNewsletterFoundationsResponse {
  return {
    foundations: [foundation(), foundation({ uid: 'vendor-uid', slug: 'vendor-foundation', name: 'Vendor Foundation', can_invite: false })],
    newsletters: [],
    complete: true,
    inviter: { eligible: true, company_name: 'Acme Motors' },
    ...overrides,
  };
}

describe('MyNewsletterFoundationsComponent', () => {
  let fixture: ComponentFixture<MyNewsletterFoundationsComponent>;
  let feed: Subject<MyNewsletterFoundationsResponse>;
  let personaLoaded: WritableSignal<boolean>;
  const newsletterService = { getMyNewsletterFoundations: vi.fn() };
  const dialogService = { open: vi.fn() };
  const find = (id: string): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`);
  const findAll = (id: string): HTMLElement[] => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll(`[data-testid="${id}"]`));
  const respond = async (value: MyNewsletterFoundationsResponse) => {
    feed.next(value);
    await fixture.whenStable();
  };
  const fail = async () => {
    feed.error(new Error('Unavailable'));
    await fixture.whenStable();
  };
  const nextFeed = () => {
    feed = new Subject();
    newsletterService.getMyNewsletterFoundations.mockReturnValue(feed);
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    personaLoaded = signal(true);
    nextFeed();
    await TestBed.configureTestingModule({
      imports: [MyNewsletterFoundationsComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: NewsletterService, useValue: newsletterService },
        { provide: PersonaService, useValue: { personaLoaded } },
      ],
    })
      .overrideComponent(MyNewsletterFoundationsComponent, { set: { providers: [{ provide: DialogService, useValue: dialogService }] } })
      .compileComponents();
    fixture = TestBed.createComponent(MyNewsletterFoundationsComponent);
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('waits for the persona before rendering the page', async () => {
    personaLoaded.set(false);
    await fixture.whenStable();

    expect(find('my-newsletters-persona-loading')).not.toBeNull();
    expect(find('my-newsletters-title')).toBeNull();
  });

  it('shows skeletons while loading, then one card per foundation', async () => {
    expect(find('my-newsletters-loading')).not.toBeNull();
    expect(find('my-newsletters-foundation-grid')).toBeNull();

    await respond(response());

    expect(find('my-newsletters-loading')).toBeNull();
    expect(findAll('newsletter-foundation-card-name').map((el) => el.textContent?.trim())).toEqual(['Acme Foundation', 'Vendor Foundation']);
    expect(find('my-newsletters-completeness-notice')).toBeNull();
  });

  it('mentions colleague invites only for an eligible inviter', async () => {
    await respond(response());
    expect(find('my-newsletters-description')?.textContent).toContain('As an employee of Acme Motors, you can invite colleagues');

    nextFeed();
    fixture.componentInstance.onRetry();
    await respond(response({ inviter: { eligible: false, company_name: null, denied_reason: 'no_company_email' } }));
    expect(find('my-newsletters-description')?.textContent).not.toContain('invite colleagues');
  });

  it('shows the empty state when the user receives no newsletters', async () => {
    await respond(response({ foundations: [] }));

    expect(find('my-newsletters-empty-state')?.textContent).toContain('No newsletters yet');
    expect(find('my-newsletters-foundation-grid')).toBeNull();
  });

  it('flags an incomplete feed and retries it', async () => {
    await respond(response({ complete: false }));
    expect(find('my-newsletters-completeness-notice')?.textContent).toContain('Some newsletters could not be loaded');

    nextFeed();
    find('my-newsletters-retry')!.click();
    await fixture.whenStable();
    expect(newsletterService.getMyNewsletterFoundations).toHaveBeenCalledTimes(2);

    await respond(response());
    expect(find('my-newsletters-completeness-notice')).toBeNull();
  });

  it('shows a retryable error and recovers', async () => {
    await fail();

    expect(find('my-newsletters-error')?.textContent).toContain('Could not load newsletters');
    expect(find('my-newsletters-foundation-grid')).toBeNull();

    nextFeed();
    find('my-newsletters-error')!.querySelector('button')!.click();
    await fixture.whenStable();
    expect(find('my-newsletters-loading')).not.toBeNull();

    await respond(response());
    expect(find('my-newsletters-error')).toBeNull();
    expect(find('my-newsletters-foundation-grid')).not.toBeNull();
  });

  it('opens the invite dialog for the chosen foundation', async () => {
    await respond(response());

    findAll('newsletter-foundation-card-invite')[0]!.querySelector('button')!.click();
    await fixture.whenStable();

    expect(dialogService.open).toHaveBeenCalledTimes(1);
    expect(dialogService.open).toHaveBeenCalledWith(
      NewsletterInviteDialogComponent,
      expect.objectContaining({ header: 'Invite a colleague', data: { foundation: expect.objectContaining({ uid: 'acme-uid' }) } })
    );
  });

  it('does not open the dialog from a foundation the user cannot invite to', async () => {
    await respond(response());

    findAll('newsletter-foundation-card-invite')[1]!.querySelector('button')!.click();
    await fixture.whenStable();

    expect(dialogService.open).not.toHaveBeenCalled();
  });
});
