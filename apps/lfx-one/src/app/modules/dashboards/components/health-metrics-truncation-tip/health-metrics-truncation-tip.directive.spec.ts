// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OverlayContainer } from '@angular/cdk/overlay';
import { Component, PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsTruncationTipDirective } from './health-metrics-truncation-tip.directive';

// Real inline styles feed getComputedStyle; jsdom has no layout, so each test sets the widths it needs.
const HOST_TEMPLATE = `
  <div lfxHealthMetricsTruncationTip id="column">
    <span id="cut" style="display:block;text-overflow:ellipsis;overflow:hidden;white-space:nowrap">
      <b id="inner">Acme   Motors</b> Foundation
    </span>
    <span id="clipped" style="display:block;white-space:nowrap;overflow-x:hidden">Clipped without an ellipsis</span>
    <span id="wraps" style="display:block">Wraps onto a second line</span>
    <button id="label" type="button" style="text-overflow:ellipsis;overflow:hidden;white-space:nowrap">A long button label</button>
    <span id="row" style="display:block;text-overflow:ellipsis;overflow:hidden;white-space:nowrap">
      <a id="link" href="#">Link inside cut-off text</a>
    </span>
  </div>
`;

@Component({ selector: 'lfx-truncation-tip-test-host', template: '' })
class TestHostComponent {}

describe('HealthMetricsTruncationTipDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let container: HTMLElement;

  const tooltip = () => container.querySelector('[data-testid="ui-tooltip"]') as HTMLElement | null;
  const el = (id: string) => fixture.nativeElement.querySelector(`#${id}`) as HTMLElement;
  // Virtual time. Only the timers are faked, so the zoneless scheduler is not starved.
  const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
  // Renders the panel's text; changes are flushed with detectChanges, as in the uikit tooltip spec.
  const flush = async () => {
    fixture.detectChanges();
    await advance(0);
  };
  const widths = (id: string, scrollWidth: number, clientWidth: number) => {
    Object.defineProperty(el(id), 'scrollWidth', { configurable: true, value: scrollWidth });
    Object.defineProperty(el(id), 'clientWidth', { configurable: true, value: clientWidth });
  };
  const pointer = (target: Element, type: 'pointerover' | 'pointerout', relatedTarget: Element | null = null, pointerType = 'mouse') =>
    target.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { pointerType, relatedTarget }));
  const pressEscape = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  const setup = async (providers: unknown[] = []) => {
    TestBed.configureTestingModule({ imports: [TestHostComponent], providers: providers as never[] });
    TestBed.overrideComponent(TestHostComponent, { set: { imports: [HealthMetricsTruncationTipDirective], template: HOST_TEMPLATE } });
    fixture = TestBed.createComponent(TestHostComponent);
    container = TestBed.inject(OverlayContainer).getContainerElement();
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  };

  afterEach(() => {
    fixture?.destroy();
    TestBed.inject(OverlayContainer).ngOnDestroy();
    vi.useRealTimers();
  });

  it('shows the full, whitespace-collapsed text of cut-off text after the delay', async () => {
    await setup();
    widths('cut', 200, 100);
    pointer(el('inner'), 'pointerover');
    await advance(299);
    expect(tooltip()).toBeNull();

    await advance(1);
    await flush();
    expect(tooltip()?.textContent?.trim()).toBe('Acme Motors Foundation');
    // Visual only: the text is already in the DOM for screen readers.
    expect(tooltip()?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows text clipped by nowrap and hidden overflow without an ellipsis', async () => {
    await setup();
    widths('clipped', 200, 100);
    pointer(el('clipped'), 'pointerover');
    await advance(300);
    await flush();
    expect(tooltip()?.textContent?.trim()).toBe('Clipped without an ellipsis');
  });

  it('shows nothing for text that fits, within the rounding tolerance', async () => {
    await setup();
    widths('cut', 101, 100);
    pointer(el('inner'), 'pointerover');
    await advance(500);
    expect(tooltip()).toBeNull();
  });

  it('shows nothing for overflowing text that is neither ellipsized nor clipped', async () => {
    await setup();
    widths('wraps', 200, 100);
    pointer(el('wraps'), 'pointerover');
    await advance(500);
    expect(tooltip()).toBeNull();
  });

  it('hides once the pointer leaves the text, and stays open while it moves between its children', async () => {
    await setup();
    widths('cut', 200, 100);
    pointer(el('inner'), 'pointerover');
    await advance(300);

    pointer(el('inner'), 'pointerout', el('cut'));
    await advance(200);
    expect(tooltip()).not.toBeNull();

    pointer(el('cut'), 'pointerout', el('column'));
    await advance(100);
    expect(tooltip()).toBeNull();
  });

  it('ignores touch pointers', async () => {
    await setup();
    widths('cut', 200, 100);
    pointer(el('inner'), 'pointerover', null, 'touch');
    await advance(500);
    expect(tooltip()).toBeNull();
  });

  it('shows on focus of a cut-off focusable element and hides on blur', async () => {
    await setup();
    widths('label', 200, 100);
    el('label').focus();
    await advance(300);
    await flush();
    expect(tooltip()?.textContent?.trim()).toBe('A long button label');

    el('label').blur();
    expect(tooltip()).toBeNull();
  });

  // Hover and focus are separate triggers: the tooltip stays until both have gone (WCAG 1.4.13).
  it('stays open when the pointer leaves a target that still has focus, and hides on blur', async () => {
    await setup();
    widths('label', 200, 100);
    pointer(el('label'), 'pointerover');
    el('label').focus();
    await advance(300);
    await flush();

    pointer(el('label'), 'pointerout', el('column'));
    await advance(200);
    expect(tooltip()?.textContent?.trim()).toBe('A long button label');

    el('label').blur();
    expect(tooltip()).toBeNull();
  });

  it('does not show on focus when only an ancestor of the focused element is cut off', async () => {
    await setup();
    widths('row', 200, 100);
    el('link').focus();
    await advance(500);
    expect(tooltip()).toBeNull();
  });

  it('keeps a focused target’s tip while the pointer crosses other cut-off text', async () => {
    await setup();
    widths('label', 200, 100);
    widths('cut', 200, 100);
    el('label').focus();
    await advance(300);
    await flush();

    pointer(el('inner'), 'pointerover');
    await advance(300);
    await flush();

    expect(tooltip()?.textContent?.trim()).toBe('A long button label');
  });

  // The CDK only watches the viewport and registered scrollers, so a native scroller in the page is caught here.
  it('closes when anything inside the page scrolls', async () => {
    await setup();
    widths('cut', 200, 100);
    pointer(el('inner'), 'pointerover');
    await advance(300);
    await flush();
    expect(tooltip()).not.toBeNull();

    el('column').dispatchEvent(new Event('scroll'));

    expect(tooltip()).toBeNull();
  });

  // Focusing cut-off text can scroll its container to bring it into view; the tip must survive that.
  it('keeps a focused target’s tip through a scroll, pending or open', async () => {
    await setup();
    widths('label', 200, 100);
    el('label').focus();
    el('column').dispatchEvent(new Event('scroll'));
    await advance(300);
    await flush();
    expect(tooltip()?.textContent?.trim()).toBe('A long button label');

    el('column').dispatchEvent(new Event('scroll'));
    expect(tooltip()).not.toBeNull();
  });

  it('closes on Escape, cancels a pending show, and stays closed until the pointer leaves', async () => {
    await setup();
    widths('cut', 200, 100);
    pointer(el('inner'), 'pointerover');
    await advance(300);
    pressEscape();
    expect(tooltip()).toBeNull();

    pointer(el('cut'), 'pointerover');
    await advance(500);
    expect(tooltip()).toBeNull();

    pointer(el('cut'), 'pointerout', el('column'));
    pointer(el('inner'), 'pointerover');
    await advance(100);
    pressEscape();
    await advance(500);
    expect(tooltip()).toBeNull();
  });

  it('disposes the open tooltip when the host is destroyed', async () => {
    await setup();
    widths('cut', 200, 100);
    pointer(el('inner'), 'pointerover');
    await advance(300);
    expect(tooltip()).not.toBeNull();

    fixture.destroy();
    expect(tooltip()).toBeNull();
  });

  it('does nothing on the server', async () => {
    await setup([{ provide: PLATFORM_ID, useValue: 'server' }]);
    widths('cut', 200, 100);
    pointer(el('inner'), 'pointerover');
    await advance(500);
    expect(tooltip()).toBeNull();
  });
});
