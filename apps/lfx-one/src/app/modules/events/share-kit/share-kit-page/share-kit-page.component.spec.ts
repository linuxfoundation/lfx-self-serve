// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { ShareKitContent, ShareKitGraphic } from '@lfx-one/shared/interfaces';
import { PlausibleService } from '@services/plausible.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PublicShareKitService } from '../services/public-share-kit.service';
import { ShareKitPageComponent } from './share-kit-page.component';

const kit: ShareKitContent = {
  eventSlug: 'example-summit-2027',
  foundationSlug: 'example-foundation',
  foundationName: 'Example Foundation',
  title: 'Example Summit',
  tagline: 'A conference for people building example software.',
  startDate: '2027-04-28',
  endDate: '2027-04-29',
  venue: 'Example Hall',
  city: 'Example City',
  eventUrl: 'https://events.example.org/summit/',
  registration: { url: 'https://events.example.org/summit/register/', priceLabel: '$399', earlyBirdUntil: '2027-02-28' },
  posts: [{ id: 'invite', title: 'Invite your network', text: { linkedin: 'LinkedIn text.', x: 'X text.', bluesky: 'Bluesky text.' } }],
  newsletterBlurb: { text: 'Blurb text.', url: 'https://events.example.org/summit/' },
  graphics: [{ label: 'Promo', url: '/share-kits/example-summit-2027/promo.png', alt: 'Example Summit promo', width: 800, height: 418 }],
  cfp: { url: 'https://events.example.org/summit/cfp/', closesOn: '2027-01-18', heading: 'Speak', body: 'Submit a talk.', invitation: 'Submit a talk.' },
};

// Protected handlers the template binds; reached through this view so the spec asserts what each fires.
interface PageHandlers {
  selectPlatform(value: string): void;
  onPostCopied(postId: string): void;
  onCopied(kind: string): void;
  onRegisterClick(placement: 'hero' | 'footer'): void;
  onCfpClick(link: 'cfp' | 'guide'): void;
  onGraphicDownload(graphic: ShareKitGraphic): void;
}

describe('ShareKitPageComponent', () => {
  let fixture: ComponentFixture<ShareKitPageComponent>;
  let trackEvent: ReturnType<typeof vi.fn>;
  let getShareKit: ReturnType<typeof vi.fn>;

  async function setup(response = of(kit)): Promise<PageHandlers> {
    trackEvent = vi.fn();
    getShareKit = vi.fn(() => response);
    await TestBed.configureTestingModule({
      imports: [ShareKitPageComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ eventSlug: 'example-summit-2027' })) } },
        { provide: PublicShareKitService, useValue: { getShareKit } },
        { provide: PlausibleService, useValue: { trackEvent } },
        { provide: UserService, useValue: { authenticated: signal(false) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ShareKitPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.componentInstance as unknown as PageHandlers;
  }

  const text = (testId: string): string => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ?? '';

  beforeEach(() => TestBed.resetTestingModule());

  it('renders the hero with dates, venue and a tracked register link', async () => {
    await setup();
    expect(text('share-kit-when-where')).toBe('April 28 and 29, 2027 · Example Hall, Example City');
    expect(text('share-kit-early-bird')).toBe('Early-bird pricing through February 28.');
    const register = fixture.nativeElement.querySelector('[data-testid="share-kit-register"] a') as HTMLAnchorElement;
    const params = new URL(register.href).searchParams;
    expect(params.get('utm_source')).toBe('lfx-share-kit');
    expect(params.get('utm_medium')).toBe('page');
    expect(params.get('utm_content')).toBe('register');
  });

  it('appends a link tagged with the platform and post to each post, and retags on a platform switch', async () => {
    const page = await setup();
    expect(text('share-kit-post-invite-text')).toContain('LinkedIn text.');
    expect(text('share-kit-post-invite-text')).toContain('utm_medium=linkedin&utm_campaign=example-summit-2027&utm_content=invite');

    page.selectPlatform('x');
    fixture.detectChanges();

    expect(text('share-kit-post-invite-text')).toContain('X text.');
    expect(text('share-kit-post-invite-text')).toContain('utm_medium=x');
    expect(text('share-kit-post-invite-count')).toBe(`${'X text.'.length + 2 + 23} / 280 characters`);
    expect(trackEvent).toHaveBeenCalledWith('share_kit_platform_tab', { event_slug: 'example-summit-2027', kind: 'x' });
  });

  it('tracks copies with the platform and post id', async () => {
    const page = await setup();
    page.selectPlatform('bluesky');
    page.onPostCopied('invite');
    page.onCopied('newsletter');
    expect(trackEvent).toHaveBeenCalledWith('share_kit_copy', {
      event_slug: 'example-summit-2027',
      foundation: 'example-foundation',
      kind: 'bluesky',
      post: 'invite',
    });
    expect(trackEvent).toHaveBeenCalledWith('share_kit_copy', { event_slug: 'example-summit-2027', foundation: 'example-foundation', kind: 'newsletter' });
  });

  it('tracks register clicks with sign-in state and placement', async () => {
    const page = await setup();
    page.onRegisterClick('hero');
    expect(trackEvent).toHaveBeenCalledWith('share_kit_register_click', {
      event_slug: 'example-summit-2027',
      foundation: 'example-foundation',
      signed_in: false,
      placement: 'hero',
    });
  });

  it('tracks graphic downloads and CFP clicks', async () => {
    const page = await setup();
    page.onGraphicDownload(kit.graphics[0]);
    page.onCfpClick('cfp');
    expect(trackEvent).toHaveBeenCalledWith('share_kit_graphic_download', {
      event_slug: 'example-summit-2027',
      foundation: 'example-foundation',
      label: 'Promo',
    });
    expect(trackEvent).toHaveBeenCalledWith('share_kit_cfp_click', { event_slug: 'example-summit-2027', foundation: 'example-foundation', link: 'cfp' });
  });

  it('shows the not-found state for an unknown event', async () => {
    await setup(throwError(() => new HttpErrorResponse({ status: 404 })));
    expect(text('share-kit-not-found')).toContain("We couldn't find a share kit for this event.");
  });

  it('shows the unavailable state when the content failed validation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await setup(throwError(() => new HttpErrorResponse({ status: 500 })));
    expect(text('share-kit-error')).toContain("This share kit isn't available right now.");
  });
});
