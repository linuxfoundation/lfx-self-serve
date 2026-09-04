// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, NO_ERRORS_SCHEMA, OnInit, output, PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { NewsletterLayout } from '@lfx-one/shared/interfaces';
import { Confirmation, ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { afterEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { NewsletterContentStepComponent } from './newsletter-content-step.component';

// Stub for lfx-newsletter-block-composer that records the layout it was seeded
// with on mount. The real composer reads initialLayout once at mount, so a
// re-mount (e.g. a mobile round-trip) must receive the CURRENT layout — this
// stub captures exactly that so the resize re-seed regression is assertable.
@Component({ selector: 'lfx-newsletter-block-composer', template: '' })
class StubBlockComposerComponent implements OnInit {
  public static seededWith: NewsletterLayout | null = null;
  public readonly initialLayout = input<NewsletterLayout | null>(null);
  public readonly layoutChange = output<NewsletterLayout>();
  public ngOnInit(): void {
    StubBlockComposerComponent.seededWith = this.initialLayout();
  }
}

/**
 * Covers the mobile-gating behavior of the Content step, which is only stated in
 * prose on the component: the block composer is a desktop drag-and-drop surface,
 * so on small viewports the Blocks toggle is disabled, a blocks draft shows a
 * "use a desktop" notice instead of the composer, and switching to Basic from
 * that notice still routes through the confirm-discard so block content is not
 * lost silently. The matchMedia listener must also be removed on teardown.
 *
 * The heavy child editors (rich editor, block composer, generate drawer, input)
 * are stubbed via NO_ERRORS_SCHEMA — this spec exercises the host's toggle,
 * notice, and mode-switch logic, not the children, each of which has (or will
 * have) its own coverage.
 */
describe('NewsletterContentStepComponent — mobile gating', () => {
  let fixture: ComponentFixture<NewsletterContentStepComponent>;
  let confirmSpy: MockInstance<(confirmation: Confirmation) => ConfirmationService>;
  let mqListeners: ((e: MediaQueryListEvent) => void)[];

  const POPULATED_LAYOUT: NewsletterLayout = { wrapper_key: 'default', blocks: [{ block_type: 'hero', content: {} }] } as NewsletterLayout;

  // Stub window.matchMedia (jsdom has none). Returns the shared listener array so
  // a test can fire a synthetic resize and assert teardown removed the listener.
  function stubMatchMedia(matches: boolean): void {
    mqListeners = [];
    const mql = {
      matches,
      media: '(max-width: 767px)',
      onchange: null,
      addEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => mqListeners.push(cb),
      removeEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => {
        const i = mqListeners.indexOf(cb);
        if (i >= 0) mqListeners.splice(i, 1);
      },
      dispatchEvent: () => true,
    };
    vi.stubGlobal('matchMedia', () => mql);
  }

  function fireResize(matches: boolean): void {
    mqListeners.forEach((cb) => cb({ matches } as MediaQueryListEvent));
  }

  function makeForm(layout: NewsletterLayout | null): FormGroup {
    return new FormGroup({
      subject: new FormControl(''),
      bodyHtml: new FormControl(''),
      bodyLayout: new FormControl<NewsletterLayout | null>(layout),
    });
  }

  // Build the fixture after matchMedia is stubbed so ngOnInit reads the intended
  // viewport. blocksEnabled is on (the composer's pilot gate) for every case here.
  async function createWith(form: FormGroup): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [NewsletterContentStepComponent],
      providers: [provideNoopAnimations(), ConfirmationService, { provide: PLATFORM_ID, useValue: 'browser' }],
    })
      // Drop the heavy child editors so their own ngOnInit (manifest fetch, etc.)
      // does not run; the unknown lfx-* elements pass under NO_ERRORS_SCHEMA. The
      // real ConfirmDialog stays so the confirm-discard path is exercised.
      .overrideComponent(NewsletterContentStepComponent, {
        // Keep a real (stub) composer so its initialLayout seeding is assertable;
        // the other lfx-* child editors stay unknown and pass under NO_ERRORS_SCHEMA.
        set: { imports: [ReactiveFormsModule, ConfirmDialogModule, StubBlockComposerComponent], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    confirmSpy = vi.spyOn(TestBed.inject(ConfirmationService), 'confirm');
    fixture = TestBed.createComponent(NewsletterContentStepComponent);
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('blocksEnabled', true);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const q = (testid: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('disables the Blocks toggle and shows the desktop-only hint on mobile', async () => {
    stubMatchMedia(true);
    await createWith(makeForm(null));

    const blocksBtn = q('newsletter-content-editor-blocks') as HTMLButtonElement;
    expect(blocksBtn.disabled).toBe(true);
    expect(blocksBtn.getAttribute('aria-describedby')).toBe('newsletter-content-editor-desktop-hint');

    const hint = q('newsletter-content-editor-desktop-hint');
    expect(hint).not.toBeNull();
    expect(hint!.classList.contains('hidden')).toBe(false);

    // A new draft (null layout) stays on the basic editor; no composer/notice.
    expect(fixture.nativeElement.querySelector('lfx-rich-editor')).not.toBeNull();
    expect(q('newsletter-content-composer')).toBeNull();
    expect(q('newsletter-content-composer-mobile-notice')).toBeNull();
  });

  it('keeps the Blocks toggle enabled and the hint hidden on desktop', async () => {
    stubMatchMedia(false);
    await createWith(makeForm(null));

    const blocksBtn = q('newsletter-content-editor-blocks') as HTMLButtonElement;
    expect(blocksBtn.disabled).toBe(false);
    expect(blocksBtn.getAttribute('aria-describedby')).toBeNull();
    expect(q('newsletter-content-editor-desktop-hint')!.classList.contains('hidden')).toBe(true);
  });

  it('shows the desktop-only notice instead of the composer for a blocks draft on mobile', async () => {
    stubMatchMedia(true);
    await createWith(makeForm(POPULATED_LAYOUT));

    // A present layout selects the blocks mode; on mobile the notice replaces the
    // composer so the drag-and-drop surface never mounts on a phone.
    expect(q('newsletter-content-composer-mobile-notice')).not.toBeNull();
    expect(q('newsletter-content-composer')).toBeNull();
  });

  it('renders the composer (not the notice) for a blocks draft on desktop', async () => {
    stubMatchMedia(false);
    await createWith(makeForm(POPULATED_LAYOUT));

    expect(q('newsletter-content-composer')).not.toBeNull();
    expect(q('newsletter-content-composer-mobile-notice')).toBeNull();
  });

  it('swaps composer for notice when the viewport shrinks, keeping the layout intact', async () => {
    stubMatchMedia(false);
    const form = makeForm(POPULATED_LAYOUT);
    await createWith(form);
    expect(q('newsletter-content-composer')).not.toBeNull();

    fireResize(true);
    fixture.detectChanges();

    expect(q('newsletter-content-composer')).toBeNull();
    expect(q('newsletter-content-composer-mobile-notice')).not.toBeNull();
    // The block content is retained on the form, not discarded by the resize.
    expect(form.get('bodyLayout')!.value).toEqual(POPULATED_LAYOUT);
  });

  it('re-seeds the composer with the CURRENT layout after a desktop → mobile → desktop round-trip', async () => {
    stubMatchMedia(false);
    const form = makeForm(POPULATED_LAYOUT);
    StubBlockComposerComponent.seededWith = null;
    await createWith(form);
    // Mounted on desktop, seeded from the initial layout.
    expect(StubBlockComposerComponent.seededWith).toEqual(POPULATED_LAYOUT);

    // A desktop edit lands on the form (the composer would emit layoutChange).
    const edited: NewsletterLayout = {
      wrapper_key: 'default',
      blocks: [
        { block_type: 'hero', content: {} },
        { block_type: 'cta', content: {} },
      ],
    } as NewsletterLayout;
    form.get('bodyLayout')!.setValue(edited);

    // Round-trip the viewport: to mobile (composer unmounts)...
    fireResize(true);
    fixture.detectChanges();
    expect(q('newsletter-content-composer')).toBeNull();

    // ...and back to desktop, which re-mounts the composer.
    StubBlockComposerComponent.seededWith = null;
    fireResize(false);
    fixture.detectChanges();

    // The re-mounted composer must seed from the edited layout, not the stale
    // pre-round-trip tree; otherwise its next edit overwrites the live form.
    expect(StubBlockComposerComponent.seededWith).toEqual(edited);
  });

  it('confirms before discarding, then clears the body, when switching to Basic from the mobile notice', async () => {
    stubMatchMedia(true);
    const form = makeForm(POPULATED_LAYOUT);
    await createWith(form);

    (q('newsletter-content-composer-mobile-switch') as HTMLButtonElement).click();

    // A populated blocks draft must prompt before it is discarded.
    expect(confirmSpy).toHaveBeenCalledOnce();
    const config = confirmSpy.mock.calls[0][0];
    // Nothing cleared until the user accepts.
    expect(form.get('bodyLayout')!.value).toEqual(POPULATED_LAYOUT);

    config.accept!();
    fixture.detectChanges();

    expect(form.get('bodyLayout')!.value).toBeNull();
    expect(form.get('bodyHtml')!.value).toBe('');
  });

  it('removes the matchMedia change listener on destroy', async () => {
    stubMatchMedia(true);
    await createWith(makeForm(null));
    expect(mqListeners.length).toBe(1);

    fixture.destroy();
    expect(mqListeners.length).toBe(0);
  });
});
