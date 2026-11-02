// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { OverlayContainer } from '@angular/cdk/overlay';
import { ScrollDispatcher } from '@angular/cdk/scrolling';
import { Component, inject, Injector, PLATFORM_ID, TemplateRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiDrawerConfig } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UiButtonComponent } from '../button/button.component';
import { UiDrawerComponent } from './drawer.component';
import { UiDrawerService } from './drawer.service';

const HOST_TEMPLATE = `
  <button id="opener" (click)="open(tpl)">Open</button>
  <ng-template #tpl let-ref="dialogRef">
    <lfx-ui-drawer heading="Weekly Sync" [subtitle]="subtitle">
      <span drawerLeading id="tile">T</span>
      <ng-container drawerActions><button id="edit" type="button">Edit meeting</button></ng-container>
      <input id="name" />
      <button id="save" type="button" (click)="ref.close('saved')">Save</button>
      <ng-container drawerFooter><button id="done" type="button">Done</button></ng-container>
    </lfx-ui-drawer>
  </ng-template>
`;

@Component({ selector: 'lfx-ui-test-host', template: '' })
class TestHostComponent {
  public config: UiDrawerConfig = {};
  public subtitle = 'Technical Steering Committee';

  private readonly drawer = inject(UiDrawerService);

  public open(template: TemplateRef<unknown>): void {
    this.drawer.open(template, this.config);
  }
}

@Component({
  selector: 'lfx-ui-test-content',
  imports: [UiDrawerComponent],
  template: '<lfx-ui-drawer heading="Hello">{{ data }}</lfx-ui-drawer>',
})
class TestContentComponent {
  public readonly data = inject(DIALOG_DATA);
  public readonly ref = inject(DialogRef);
}

@Component({ selector: 'lfx-ui-test-closing-content', imports: [UiDrawerComponent], template: '<lfx-ui-drawer heading="Closing" />' })
class TestClosingContentComponent {
  public constructor() {
    inject(DialogRef).close('invalid');
  }
}

// True when the CDK scroll dispatcher tracks the element, so overlays anchored inside it follow its scrolling.
const registered = (el: Element): boolean => [...TestBed.inject(ScrollDispatcher).scrollContainers.keys()].some((s) => s.getElementRef().nativeElement === el);

describe('UiDrawerComponent and UiDrawerService', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let container: HTMLElement;
  let opener: HTMLButtonElement;

  const dialog = () => container.querySelector('.cdk-dialog-container') as HTMLElement | null;
  const drawer = () => container.querySelector('[data-testid="ui-drawer"]') as HTMLElement | null;
  const byId = (id: string) => container.querySelector(`#${id}`) as HTMLElement;
  const testId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement;
  // No real time passes: the close sequence only waits on render and promise turns.
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await fixture.whenStable();
      await Promise.resolve();
    }
  };
  const open = async (configure: (host: TestHostComponent) => void = () => undefined) => {
    configure(fixture.componentInstance);
    opener.focus();
    opener.click();
    await settle();
  };
  const pressEscape = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
  const clickBackdrop = () => (container.querySelector('.cdk-overlay-backdrop') as HTMLElement).click();

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [TestHostComponent] });
    // Set here because an inline template this long trips component-max-inline-declarations.
    TestBed.overrideComponent(TestHostComponent, { set: { imports: [UiDrawerComponent, UiButtonComponent], template: HOST_TEMPLATE } });
    fixture = TestBed.createComponent(TestHostComponent);
    document.body.appendChild(fixture.nativeElement);
    container = TestBed.inject(OverlayContainer).getContainerElement();
    opener = fixture.nativeElement.querySelector('#opener');
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fixture.destroy();
    TestBed.inject(OverlayContainer).ngOnDestroy();
  });

  it('opens a named dialog with the title, subtitle, header action, body, footer and a close button', async () => {
    await open();

    expect(dialog()?.getAttribute('role')).toBe('dialog');
    // aria-modal stays off, as in the modal, so overlay panes opened from inside (Select, Menu) remain exposed.
    expect(dialog()?.getAttribute('aria-modal')).not.toBe('true');
    expect(testId('ui-drawer-title').textContent).toBe('Weekly Sync');
    expect(dialog()?.getAttribute('aria-labelledby')).toBe(testId('ui-drawer-title').id);
    expect(testId('ui-drawer-subtitle').textContent).toBe('Technical Steering Committee');
    expect(testId('ui-drawer-leading').querySelector('#tile')).not.toBeNull();
    // The leading tile comes before the title in the header.
    expect(testId('ui-drawer-leading').compareDocumentPosition(testId('ui-drawer-title')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(testId('ui-drawer-header').querySelector('#edit')).not.toBeNull();
    expect(testId('ui-drawer-body').querySelector('#name')).not.toBeNull();
    expect(testId('ui-drawer-footer').querySelector('#done')).not.toBeNull();
    expect(testId('ui-drawer-close').querySelector('button')?.getAttribute('aria-label')).toBe('Close');
    // Registered with the CDK so a Select or Menu opened from the body follows its scrolling.
    expect(registered(testId('ui-drawer-body'))).toBe(true);
  });

  it('dims the page with the ui-overlay backdrop', async () => {
    await open();
    expect(container.querySelector('.cdk-overlay-backdrop')?.className).toContain('bg-ui-overlay');
  });

  it('anchors to the right at 600px, full height, with the large radius on the inner edge only', async () => {
    await open();

    expect(drawer()?.style.width).toBe('600px');
    expect(drawer()?.className).toContain('rounded-l-ui-lg');
    expect(drawer()?.className).not.toContain('rounded-r-ui-lg');
    expect(drawer()?.className).toContain('shadow-modal');
    expect(drawer()?.className).toContain('is-right');
    expect((container.querySelector('.cdk-global-overlay-wrapper') as HTMLElement).style.justifyContent).toBe('flex-end');
    expect((container.querySelector('.cdk-overlay-pane') as HTMLElement).style.height).toBe('100%');
  });

  it('anchors to the left with a given width', async () => {
    await open((host) => (host.config = { side: 'left', width: 480 }));

    expect(drawer()?.style.width).toBe('480px');
    expect(drawer()?.className).toContain('rounded-r-ui-lg');
    expect(drawer()?.className).not.toContain('rounded-l-ui-lg');
    expect(drawer()?.className).toContain('is-left');
    expect((container.querySelector('.cdk-global-overlay-wrapper') as HTMLElement).style.justifyContent).toBe('flex-start');
  });

  it('fills the window at 640px and narrower, and never exceeds it', async () => {
    await open();
    expect(drawer()?.className).toContain('max-[640px]:!w-screen');
    expect(drawer()?.className).toContain('max-[640px]:rounded-none');
    expect(drawer()?.className).toContain('max-w-[100vw]');
    // The footer clears the home indicator on a phone-width sheet.
    expect(testId('ui-drawer-footer').className).toContain('max-[640px]:pb-[calc(16px+env(safe-area-inset-bottom))]');
  });

  it('is always a dialog, even when a modal config with another role is passed', async () => {
    await open((host) => (host.config = { role: 'alertdialog' } as UiDrawerConfig));
    expect(dialog()?.getAttribute('role')).toBe('dialog');
  });

  it('is described by its subtitle when the config asks for it', async () => {
    await open((host) => (host.config = { describedBy: true }));
    expect(dialog()?.getAttribute('aria-describedby')).toBe(testId('ui-drawer-subtitle').id);
  });

  it('moves focus to the autoFocus target and traps it', async () => {
    await open((host) => (host.config = { autoFocus: '#name' }));

    expect(document.activeElement).toBe(byId('name'));
    expect(container.querySelectorAll('.cdk-focus-trap-anchor').length).toBe(2);
  });

  it('closes on Escape and gives focus back to the opener', async () => {
    await open();
    pressEscape();
    await settle();

    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('closes on a backdrop click and on the close button', async () => {
    await open();
    clickBackdrop();
    await settle();
    expect(dialog()).toBeNull();

    await open();
    testId('ui-drawer-close').querySelector('button')?.click();
    await settle();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('ignores an Escape that something else already handled, and one with a modifier key', async () => {
    await open();
    const handled = new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true });
    handled.preventDefault();
    document.body.dispatchEvent(handled);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, shiftKey: true, bubbles: true, cancelable: true }));
    await settle();

    expect(dialog()).not.toBeNull();
  });

  it('ignores an Escape that cancels an IME composition', async () => {
    await open();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, isComposing: true, bubbles: true, cancelable: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 229, bubbles: true, cancelable: true }));
    await settle();

    expect(dialog()).not.toBeNull();
  });

  it('honours closeOnEscape and closeOnBackdropClick', async () => {
    await open((host) => (host.config = { closeOnEscape: false }));
    pressEscape();
    await settle();
    expect(dialog()).not.toBeNull();
    clickBackdrop();
    await settle();
    expect(dialog()).toBeNull();

    await open((host) => (host.config = { closeOnBackdropClick: false }));
    clickBackdrop();
    await settle();
    expect(dialog()).not.toBeNull();
    pressEscape();
    await settle();
    expect(dialog()).toBeNull();
  });

  describe('canClose', () => {
    it('keeps the drawer open when the guard says no, for Escape, the backdrop and the close button', async () => {
      const canClose = vi.fn(() => false);
      await open((host) => (host.config = { canClose }));

      pressEscape();
      await settle();
      clickBackdrop();
      await settle();
      testId('ui-drawer-close').querySelector('button')?.click();
      await settle();

      expect(canClose).toHaveBeenCalledTimes(3);
      expect(dialog()).not.toBeNull();
      expect(drawer()?.className).not.toContain('is-leaving');
    });

    it('closes when the guard says yes', async () => {
      await open((host) => (host.config = { canClose: () => true }));
      pressEscape();
      await settle();
      expect(dialog()).toBeNull();
    });

    it('waits for a promise, and asks once while the answer is pending', async () => {
      let answer: (allowed: boolean) => void = () => undefined;
      const canClose = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
      await open((host) => (host.config = { canClose }));

      pressEscape();
      pressEscape();
      await settle();
      expect(canClose).toHaveBeenCalledTimes(1);
      expect(dialog()).not.toBeNull();

      answer(true);
      await settle();
      expect(dialog()).toBeNull();
    });

    it('asks again after a no', async () => {
      let allowed = false;
      const canClose = vi.fn(() => allowed);
      await open((host) => (host.config = { canClose }));

      pressEscape();
      await settle();
      allowed = true;
      pressEscape();
      await settle();

      expect(canClose).toHaveBeenCalledTimes(2);
      expect(dialog()).toBeNull();
    });

    it('keeps the drawer open and logs when the guard throws, then asks again', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const canClose = vi.fn((): boolean => {
        throw new Error('boom');
      });
      await open((host) => (host.config = { canClose }));

      pressEscape();
      await settle();
      expect(dialog()).not.toBeNull();
      expect(error).toHaveBeenCalledWith('lfx-ui-drawer canClose failed; keeping it open', expect.any(Error));

      pressEscape();
      await settle();
      expect(canClose).toHaveBeenCalledTimes(2);
      expect(dialog()).not.toBeNull();
    });

    it('keeps the drawer open and logs when the guard rejects', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const canClose = vi.fn(() => Promise.reject(new Error('no answer')));
      await open((host) => (host.config = { canClose }));

      pressEscape();
      await settle();

      expect(dialog()).not.toBeNull();
      expect(error).toHaveBeenCalledWith('lfx-ui-drawer canClose failed; keeping it open', expect.any(Error));
    });

    it('does not ask when the content closes the drawer itself', async () => {
      const canClose = vi.fn(() => false);
      await open((host) => (host.config = { canClose }));

      byId('save').click();
      await settle();

      expect(canClose).not.toHaveBeenCalled();
      expect(dialog()).toBeNull();
    });
  });

  describe('exit', () => {
    // jsdom has no animations; stand in for the CSS one the drawer plays while it slides out.
    const playExit = () => {
      let finish: () => void = () => undefined;
      const finished = new Promise<void>((resolve) => (finish = resolve));
      Object.defineProperty(Element.prototype, 'getAnimations', { value: () => [{ finished }], configurable: true });
      return finish;
    };

    afterEach(() => {
      delete (Element.prototype as unknown as Record<string, unknown>)['getAnimations'];
    });

    it('slides out before it is removed, fading the scrim with it', async () => {
      const finish = playExit();
      await open();
      // The CDK adds this class a frame after attaching; add it here so the removal is visible.
      container.querySelector('.cdk-overlay-backdrop')?.classList.add('cdk-overlay-backdrop-showing');

      pressEscape();
      await settle();

      expect(drawer()?.className).toContain('is-leaving');
      expect(container.querySelector('.cdk-overlay-backdrop')?.classList).not.toContain('cdk-overlay-backdrop-showing');
      expect(dialog()).not.toBeNull();

      finish();
      await settle();
      expect(dialog()).toBeNull();
    });

    it('ignores Escape, the backdrop and the close button while it slides out', async () => {
      const finish = playExit();
      const canClose = vi.fn(() => true);
      await open((host) => (host.config = { canClose }));

      pressEscape();
      await settle();
      expect(drawer()?.className).toContain('is-leaving');

      pressEscape();
      clickBackdrop();
      testId('ui-drawer-close').querySelector('button')?.click();
      await settle();
      expect(canClose).toHaveBeenCalledTimes(1);

      finish();
      await settle();
      expect(dialog()).toBeNull();
    });

    it('waits only on its own exit animation, not on looping ones in the body', async () => {
      let finish: () => void = () => undefined;
      const exit = new Promise<void>((resolve) => (finish = resolve));
      const looping = new Promise<void>(() => undefined);
      // A Skeleton or Spinner in the body loops forever; only a `subtree` query would see it.
      Object.defineProperty(Element.prototype, 'getAnimations', {
        value(this: Element, options?: { subtree?: boolean }) {
          return [...(this.localName === 'lfx-ui-drawer' ? [{ finished: exit }] : []), ...(options?.subtree ? [{ finished: looping }] : [])];
        },
        configurable: true,
      });
      await open();

      pressEscape();
      await settle();
      expect(dialog()).not.toBeNull();

      finish();
      await settle();
      expect(dialog()).toBeNull();
    });

    it('closes after a fallback delay when the exit animation never finishes', async () => {
      Object.defineProperty(Element.prototype, 'getAnimations', { value: () => [{ finished: new Promise<void>(() => undefined) }], configurable: true });
      await open();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        pressEscape();
        await vi.advanceTimersByTimeAsync(0);
        expect(dialog()).not.toBeNull();

        // jsdom computes no animation duration, so only the 150ms margin remains.
        await vi.advanceTimersByTimeAsync(150);
      } finally {
        vi.useRealTimers();
      }
      await settle();
      expect(dialog()).toBeNull();
    });

    it('closes and releases the page when the overlay is disposed from outside, as on browser Back', async () => {
      const ref = TestBed.inject(UiDrawerService).open<string, string, TestContentComponent>(TestContentComponent, { data: 'payload' });
      let closed = false;
      ref.closed.subscribe(() => (closed = true));
      await settle();
      expect(fixture.nativeElement.getAttribute('aria-hidden')).toBe('true');

      ref.overlayRef.dispose();
      await settle();

      expect(closed).toBe(true);
      expect(fixture.nativeElement.getAttribute('aria-hidden')).toBeNull();

      await open();
      expect(dialog()).not.toBeNull();
      pressEscape();
      await settle();
      expect(dialog()).toBeNull();
    });

    it('closes at once, without throwing, when the content closes itself while it is being created', async () => {
      // `closed` has already emitted by the time `open` returns, so the check is that nothing throws and nothing stays on screen.
      expect(() => TestBed.inject(UiDrawerService).open(TestClosingContentComponent)).not.toThrow();
      await settle();

      expect(dialog()).toBeNull();
      expect(fixture.nativeElement.getAttribute('aria-hidden')).toBeNull();

      await open();
      expect(dialog()).not.toBeNull();
    });

    it('closes at once on the server, without reading computed styles', async () => {
      Object.defineProperty(Element.prototype, 'getAnimations', { value: () => [{ finished: new Promise<void>(() => undefined) }], configurable: true });
      const styles = vi.spyOn(window, 'getComputedStyle');
      const server = Injector.create({
        providers: [{ provide: PLATFORM_ID, useValue: 'server' }, { provide: UiDrawerService }],
        parent: TestBed.inject(Injector),
      }).get(UiDrawerService);
      const ref = server.open(TestContentComponent, { data: 'payload' });
      await settle();
      expect(dialog()).not.toBeNull();

      ref.close();

      expect(dialog()).toBeNull();
      expect(styles).not.toHaveBeenCalled();
    });

    it('returns the result of a programmatic close after the exit', async () => {
      const finish = playExit();
      await settle();
      const ref = TestBed.inject(UiDrawerService).open<string, string, TestContentComponent>(TestContentComponent, { data: 'payload' });
      let result: string | undefined;
      ref.closed.subscribe((r) => (result = r));
      await settle();
      expect(drawer()?.textContent).toContain('payload');

      ref.componentInstance?.ref.close('done');
      ref.componentInstance?.ref.close('again');
      await settle();
      expect(dialog()).not.toBeNull();
      expect(result).toBeUndefined();

      finish();
      await settle();
      expect(result).toBe('done');
      expect(dialog()).toBeNull();
    });
  });

  it('locks page scroll while open and releases it on close', async () => {
    // The CDK only blocks scrolling when the page can scroll, and jsdom has no layout, so fake a tall page.
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 5000, configurable: true });
    try {
      await open();
      expect(document.documentElement.classList).toContain('cdk-global-scrollblock');

      pressEscape();
      await settle();
      expect(document.documentElement.classList).not.toContain('cdk-global-scrollblock');
    } finally {
      delete (document.documentElement as unknown as Record<string, unknown>)['scrollHeight'];
    }
  });

  it('hides the footer when nothing is projected into it, and renders without a service as an inert layout', async () => {
    const bare = TestBed.createComponent(UiDrawerComponent);
    bare.componentRef.setInput('heading', 'Bare');
    await bare.whenStable();
    const el = bare.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="ui-drawer-footer"]')?.matches(':empty')).toBe(true);
    expect(el.querySelector('[data-testid="ui-drawer-leading"]')?.matches(':empty')).toBe(true);
    expect(el.style.width).toBe('600px');
    expect(el.getAttribute('role')).toBeNull();
    expect(() => (el.querySelector('[data-testid="ui-drawer-close"] button') as HTMLElement).click()).not.toThrow();
  });
});
