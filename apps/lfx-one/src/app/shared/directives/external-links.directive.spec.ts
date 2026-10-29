// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExternalLinksDirective } from './external-links.directive';

@Component({
  selector: 'lfx-test-host',
  imports: [ExternalLinksDirective],
  template: `<div lfxExternalLinks data-testid="host" [innerHTML]="html"></div>`,
})
class HostComponent {
  public html =
    '<p><a href="https://example.com/doc?a=1&amp;b=2"><b>doc</b></a> <a href="mailto:a@example.com">mail</a> <a href="http://127.0.0.1/admin">unsafe</a></p>';
}

describe('ExternalLinksDirective', () => {
  afterEach(() => vi.restoreAllMocks());

  function click(selector: string, init: MouseEventInit = {}, type = 'click'): { opened: ReturnType<typeof vi.fn>; event: MouseEvent } {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
    (fixture.nativeElement as HTMLElement).querySelector(selector)!.dispatchEvent(event);
    return { opened: opened as unknown as ReturnType<typeof vi.fn>, event };
  }

  it('opens an http(s) link in a new tab, including clicks on nested elements', () => {
    const { opened, event } = click('a[href^="https:"] b');
    expect(opened).toHaveBeenCalledWith('https://example.com/doc?a=1&b=2', '_blank', 'noopener,noreferrer');
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves non-http schemes to the browser', () => {
    const { opened, event } = click('a[href^="mailto:"]');
    expect(opened).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves modified clicks to the browser', () => {
    const { opened, event } = click('a[href^="https:"]', { ctrlKey: true });
    expect(opened).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it.each(['click', 'auxclick'])('blocks rejected web URLs on %s', (type) => {
    const { opened, event } = click('a[href^="http:"]', { button: type === 'click' ? 0 : 1 }, type);
    expect(opened).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }])('blocks rejected web URLs with modifiers %j', (init) => {
    const { opened, event } = click('a[href^="http:"]', init);
    expect(opened).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });
});
