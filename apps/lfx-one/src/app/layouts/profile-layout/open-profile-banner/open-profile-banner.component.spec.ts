// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenProfileBannerComponent } from './open-profile-banner.component';

// Renders the real template so a dropped (click) binding or a renamed launcher-contract testid
// fails here, not in a manual click-through (the bot-with-message behavior itself is support-side).
describe('OpenProfileBannerComponent', () => {
  let fixture: ComponentFixture<OpenProfileBannerComponent>;
  let linkClick: ReturnType<typeof vi.fn>;

  const link = (): HTMLButtonElement => {
    const el = fixture.nativeElement.querySelector('[data-testid="open-profile-banner-link"]');
    if (!el) throw new Error('banner link not rendered');
    return el as HTMLButtonElement;
  };

  beforeEach(async () => {
    linkClick = vi.fn();

    await TestBed.configureTestingModule({
      imports: [OpenProfileBannerComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(OpenProfileBannerComponent);
    fixture.componentInstance.linkClick.subscribe(linkClick);
    fixture.detectChanges();
  });

  it('renders the help copy with the launcher-contract testids', () => {
    expect(fixture.nativeElement.textContent).toContain('Need help with your Profile?');
    expect(link().textContent).toContain('Chat with us');
    expect(fixture.nativeElement.querySelector('[data-testid="open-profile-banner-slot"]')).not.toBeNull();
  });

  it('clicking the link emits linkClick', () => {
    link().click();

    expect(linkClick).toHaveBeenCalledTimes(1);
  });
});
