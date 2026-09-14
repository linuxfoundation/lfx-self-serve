// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenProfileBannerComponent } from './open-profile-banner.component';

/**
 * Renders the component's real template (unlike sidebar.component.spec.ts, which stubs it out) so a
 * dropped (click) binding or a `show` regression fails this spec, not just a manual click-through.
 * The button has no Intercom wiring of its own — support tooling targets it directly by its stable
 * data-testid, so this only needs to prove the click reaches linkClick.
 */
describe('OpenProfileBannerComponent', () => {
  let fixture: ComponentFixture<OpenProfileBannerComponent>;
  let linkClick: ReturnType<typeof vi.fn>;

  const link = (): HTMLButtonElement => {
    const el = fixture.nativeElement.querySelector('[data-testid="open-profile-banner-link"]');
    if (!el) throw new Error('banner link not rendered');
    return el as HTMLButtonElement;
  };

  const slot = (): HTMLElement => {
    const el = fixture.nativeElement.querySelector('[data-testid="open-profile-banner-slot"]');
    if (!el) throw new Error('banner slot not rendered');
    return el as HTMLElement;
  };

  beforeEach(async () => {
    linkClick = vi.fn();

    await TestBed.configureTestingModule({
      imports: [OpenProfileBannerComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(OpenProfileBannerComponent);
    fixture.componentInstance.linkClick.subscribe(linkClick);
  });

  it('stretches to the width of its flex-item host so it lines up with sibling sidebar slots', () => {
    // Guards the `host: { class: 'block w-full' }` binding: the parent sidebar column is a
    // `flex flex-col items-start` container, so without an explicit block+full-width host this
    // element (and its child slot's own w-full) would shrink to content width instead of
    // stretching like every other slot in that column.
    expect(fixture.nativeElement.classList.contains('block')).toBe(true);
    expect(fixture.nativeElement.classList.contains('w-full')).toBe(true);
  });

  it('hides the banner slot when show is false', async () => {
    fixture.componentRef.setInput('show', false);
    await fixture.whenStable();

    expect(slot().classList.contains('hidden')).toBe(true);
  });

  it('shows the banner slot when show is true', async () => {
    fixture.componentRef.setInput('show', true);
    await fixture.whenStable();

    expect(slot().classList.contains('hidden')).toBe(false);
  });

  it('clicking the link emits linkClick', async () => {
    fixture.componentRef.setInput('show', true);
    await fixture.whenStable();

    link().click();

    expect(linkClick).toHaveBeenCalledTimes(1);
  });
});
