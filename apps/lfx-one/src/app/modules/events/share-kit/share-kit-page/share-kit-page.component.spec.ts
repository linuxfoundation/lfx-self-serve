// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap } from '@angular/router';
import { ShareKitContent, ShareKitGraphic, ShareKitTheme } from '@lfx-one/shared/interfaces';
import { PlausibleService } from '@services/plausible.service';
import { UserService } from '@services/user.service';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
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
  let trackPage: ReturnType<typeof vi.fn>;
  let getShareKit: ReturnType<typeof vi.fn>;

  async function setup(
    response: Observable<ShareKitContent> = of(kit),
    paramMap: Observable<ParamMap> = of(convertToParamMap({ eventSlug: 'example-summit-2027' }))
  ): Promise<PageHandlers> {
    trackEvent = vi.fn();
    trackPage = vi.fn();
    getShareKit = vi.fn(() => response);
    await TestBed.configureTestingModule({
      imports: [ShareKitPageComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap } },
        { provide: PublicShareKitService, useValue: { getShareKit } },
        { provide: PlausibleService, useValue: { trackEvent, trackPage, ready: signal(true) } },
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

  it('keeps the LFX look and names the foundation and event in the header without a theme', async () => {
    await setup();
    expect(text('share-kit-foundation')).toBe('Example Foundation · Example Summit Share Kit');
    expect(fixture.nativeElement.querySelector('[data-testid="share-kit-logo"]')).toBeNull();
    expect((fixture.nativeElement.querySelector('[data-testid="share-kit-page"]') as HTMLElement).style.getPropertyValue('--sk-hero')).toBe('');
  });

  it('brands the page from the event theme', async () => {
    const theme: ShareKitTheme = {
      colors: {
        hero: '#3731C9',
        heroText: '#FFFFFF',
        soft: '#B6B0D0',
        accent: '#FF702D',
        button: '#FF702D',
        buttonText: '#0B0A1E',
        primary: '#3731C9',
        page: '#F6F6FB',
      },
      logo: { url: '/share-kits/example-summit-2027/logo.svg', alt: 'Example Summit', width: 544, height: 122 },
      headline: 'Where builders meet',
      headingFont: 'inter-tight',
    };
    await setup(of({ ...kit, theme }));
    const root = fixture.nativeElement.querySelector('[data-testid="share-kit-page"]') as HTMLElement;
    expect(root.style.getPropertyValue('--sk-hero')).toBe('#3731C9');
    expect(root.style.getPropertyValue('--ui-accent-500')).toBe('#3731C9');
    expect(fixture.nativeElement.querySelector('[data-testid="share-kit-logo"]')?.getAttribute('alt')).toBe('Example Summit');
    expect(text('share-kit-headline')).toBe('Where builders meet.');
    expect(text('share-kit-early-bird')).toBe('$399 early-bird through February 28.');
    expect(document.head.querySelector('link[data-share-kit-font="inter-tight"]')).not.toBeNull();
  });

  it('opens the next kit on the Share tab and counts one pageview per kit, even when both are missing', async () => {
    const params = new BehaviorSubject(convertToParamMap({ eventSlug: 'example-summit-2027' }));
    await setup(
      throwError(() => new HttpErrorResponse({ status: 404 })),
      params
    );
    const page = fixture.componentInstance as unknown as { tab: { (): string; set(value: string): void } };
    page.tab.set('cfp');
    params.next(convertToParamMap({ eventSlug: 'other-summit-2027' }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(page.tab()).toBe('share');
    expect(trackPage).toHaveBeenCalledTimes(2);
  });

  it('sends one pageview with the kit foundation once the kit loads', async () => {
    await setup();
    expect(trackPage).toHaveBeenCalledTimes(1);
    expect(trackPage).toHaveBeenCalledWith({ foundation: 'example-foundation', foundation_name: 'Example Foundation' });
  });

  it('points canonical and og:url at the kit and clears an inherited noindex', async () => {
    const robots = document.createElement('meta');
    robots.setAttribute('name', 'robots');
    robots.setAttribute('content', 'noindex');
    document.head.appendChild(robots);
    await setup();
    const canonical = document.head.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '';
    expect(canonical.endsWith('/events/example-summit-2027/share-kit')).toBe(true);
    expect(document.head.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(canonical);
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it('tags the CFP invitation link as cfp whatever platform the Share tab is on', async () => {
    const page = await setup();
    page.selectPlatform('x');
    (fixture.componentInstance as unknown as { tab: { set(value: string): void } }).tab.set('cfp');
    fixture.detectChanges();
    const invitation = text('share-kit-cfp-invitation-text');
    expect(invitation).toContain('utm_medium=cfp');
    expect(invitation).not.toContain('utm_medium=x');
  });

  it('marks a missing kit noindex and drops the canonical link', async () => {
    await setup(throwError(() => new HttpErrorResponse({ status: 404 })));
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
  });

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

  it('offers same-origin graphics as downloads and other hosts as a new tab', async () => {
    const external = { label: 'Banner', url: 'https://cdn.example.org/banner.png', alt: 'Banner', width: 1200, height: 628 };
    await setup(of({ ...kit, graphics: [kit.graphics[0], external] }));
    (fixture.componentInstance as unknown as { tab: { set(value: string): void } }).tab.set('graphics');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="share-kit-graphic-download-0"]').hasAttribute('download')).toBe(true);
    const open = fixture.nativeElement.querySelector('[data-testid="share-kit-graphic-open-1"]') as HTMLAnchorElement;
    expect(open.hasAttribute('download')).toBe(false);
    expect(open.getAttribute('target')).toBe('_blank');
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

  describe('member offer', () => {
    const memberBenefit = {
      membershipSlug: 'example-foundation',
      membershipName: 'Example',
      discountLabel: '20% off registration',
      joinUrl: 'https://example.org/join',
    };

    it('shows the code to an eligible member and tracks the copy without it', async () => {
      const page = await setup(of({ ...kit, memberBenefit, memberOffer: { status: 'eligible' as const, code: 'EXAMPLE20', companyName: 'Acme Motors' } }));
      expect(text('share-kit-member-code-text')).toBe('EXAMPLE20');
      expect(text('share-kit-member-eligible')).toContain('Acme Motors is a Example member.');
      page.onCopied('member_code');
      expect(trackEvent).toHaveBeenCalledWith('share_kit_copy', { event_slug: 'example-summit-2027', foundation: 'example-foundation', kind: 'member_code' });
      expect(JSON.stringify(trackEvent.mock.calls)).not.toContain('EXAMPLE20');
    });

    it('asks anonymous visitors to sign in, returning to the kit', async () => {
      await setup(of({ ...kit, memberBenefit, memberOffer: { status: 'sign_in' as const } }));
      const link = fixture.nativeElement.querySelector('[data-testid="share-kit-member-sign-in"] a') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('/login?returnTo=%2Fevents%2Fexample-summit-2027%2Fshare-kit');
      expect(fixture.nativeElement.querySelector('[data-testid="share-kit-member-code"]')).toBeNull();
    });

    it('points a non-member company to the join page', async () => {
      await setup(of({ ...kit, memberBenefit, memberOffer: { status: 'not_member' as const } }));
      expect(text('share-kit-member-not-member')).toContain("Your company isn't a Example member yet.");
    });

    it('withholds the code and explains when the membership check failed', async () => {
      await setup(of({ ...kit, memberBenefit, memberOffer: { status: 'unavailable' as const } }));
      expect(fixture.nativeElement.querySelector('[data-testid="share-kit-member-unavailable"]')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="share-kit-member-code"]')).toBeNull();
    });

    it('shows no offer when the kit has no member benefit', async () => {
      await setup();
      expect(fixture.nativeElement.querySelector('[data-testid="share-kit-member-offer"]')).toBeNull();
    });
  });
});
