// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FocusMonitor } from '@angular/cdk/a11y';
import { OverlayContainer } from '@angular/cdk/overlay';
import { Component, PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UiHoverCardDirective } from './hover-card.directive';

// Set in the TestBed below: inline templates are capped at three lines.
const HOST_TEMPLATE = `
    <a id="trigger" href="#" aria-describedby="existing" [lfxUiHoverCard]="card" [lfxUiHoverCardWidth]="280" [lfxUiHoverCardDelay]="40">Kubernetes</a>
    <ng-template #card><p data-testid="card-body">Maintainer since 2019</p></ng-template>
`;

@Component({
  selector: 'lfx-ui-test-host',
  template: '',
})
class TestHostComponent {}

describe('UiHoverCardDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let trigger: HTMLAnchorElement;
  let container: HTMLElement;

  const card = () => container.querySelector('[data-testid="ui-hover-card-panel"]') as HTMLElement | null;
  // Virtual time. Only the timers are faked, so the zoneless scheduler is not starved; changes are flushed with detectChanges.
  const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
  const pointer = (target: Element | null, type: 'pointerenter' | 'pointerleave', pointerType = 'mouse') =>
    target?.dispatchEvent(Object.assign(new Event(type), { pointerType }));

  const setup = async (platform = 'browser') => {
    TestBed.configureTestingModule({ imports: [TestHostComponent], providers: [{ provide: PLATFORM_ID, useValue: platform }] });
    TestBed.overrideComponent(TestHostComponent, { set: { imports: [UiHoverCardDirective], template: HOST_TEMPLATE } });
    fixture = TestBed.createComponent(TestHostComponent);
    container = TestBed.inject(OverlayContainer).getContainerElement();
    trigger = fixture.nativeElement.querySelector('#trigger');
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  };

  afterEach(() => {
    fixture?.destroy();
    TestBed.inject(OverlayContainer).ngOnDestroy();
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('opens the card after the delay on hover, at its width, and describes the host by it', async () => {
    await setup();
    pointer(trigger, 'pointerenter');
    await advance(20);
    expect(card()).toBeNull();

    await advance(30);
    expect(card()?.querySelector('[data-testid="card-body"]')?.textContent).toBe('Maintainer since 2019');
    expect(card()?.style.width).toBe('280px');
    expect(trigger.getAttribute('aria-describedby')).toBe(`existing ${card()?.id}`);
  });

  it('stays open while the pointer crosses onto the card, and closes once it leaves both', async () => {
    await setup();
    pointer(trigger, 'pointerenter');
    await advance(50);

    pointer(trigger, 'pointerleave');
    pointer(card(), 'pointerenter');
    await advance(200);
    expect(card()).not.toBeNull();

    pointer(card(), 'pointerleave');
    await advance(200);
    expect(card()).toBeNull();
    expect(trigger.getAttribute('aria-describedby')).toBe('existing');
  });

  it('closes on Escape without letting the key reach an enclosing dialog', async () => {
    await setup();
    pointer(trigger, 'pointerenter');
    await advance(50);
    const outer = vi.fn();
    document.addEventListener('keydown', outer);

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(card()).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    document.removeEventListener('keydown', outer);
  });

  it('opens on keyboard focus and closes on blur', async () => {
    await setup();
    const focusMonitor = TestBed.inject(FocusMonitor);

    focusMonitor.focusVia(trigger, 'keyboard');
    await advance(50);
    expect(card()).not.toBeNull();

    trigger.blur();
    await advance(0);
    expect(card()).toBeNull();
  });

  it('ignores touch', async () => {
    await setup();
    pointer(trigger, 'pointerenter', 'touch');
    await advance(100);

    expect(card()).toBeNull();
  });

  it('does nothing on the server', async () => {
    await setup('server');
    pointer(trigger, 'pointerenter');
    await advance(100);

    expect(card()).toBeNull();
  });
});
