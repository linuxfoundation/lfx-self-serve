// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  let base: HTMLBaseElement;

  beforeEach(() => {
    base = document.createElement('base');
    base.href = 'https://vote.example/votes/v-1';
    document.head.prepend(base);
  });

  afterEach(() => {
    base.remove();
    vi.restoreAllMocks();
  });

  function click(selector: string, init: MouseEventInit = {}, type = 'click', html?: string): { opened: ReturnType<typeof vi.fn>; event: MouseEvent } {
    const fixture = TestBed.createComponent(HostComponent);
    if (html !== undefined) fixture.componentInstance.html = html;
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

  it.each(['mailto:a@example.com', 'tel:+15555550100'])('leaves %s to the browser', (href) => {
    const { opened, event } = click('a', {}, 'click', `<a href="${href}">contact</a>`);
    expect(opened).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }])('leaves safe modified clicks to the browser: %j', (init) => {
    const { opened, event } = click('a[href^="https:"]', init);
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

  it.each(['', ' ', '\t\n'])('blocks empty destinations on ordinary, modified, and middle clicks: %j', (href) => {
    for (const init of [{}, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      const type = init.button === 1 ? 'auxclick' : 'click';
      const { opened, event } = click('a b', init, type, `<a href="${href}"><b>empty</b></a>`);
      expect(opened).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      vi.restoreAllMocks();
    }
  });

  it('leaves anchors without a destination untouched', () => {
    const { opened, event } = click('a', {}, 'click', '<a>no destination</a>');
    expect(opened).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it.each([
    { href: '//example.com/charter', expected: 'https://example.com/charter' },
    { href: '/docs/charter', expected: 'https://vote.example/docs/charter' },
    { href: 'charter', expected: 'https://vote.example/votes/charter' },
    { href: '#charter', expected: 'https://vote.example/votes/v-1#charter' },
    { href: 'https://example.com/guide?topic=data:types', expected: 'https://example.com/guide?topic=data:types' },
    { href: 'https://example.com/ftp:/manual', expected: 'https://example.com/ftp:/manual' },
    { href: 'https://172.32.0.1/charter', expected: 'https://172.32.0.1/charter' },
    { href: 'HTTPS://EXAMPLE.COM:443/charter', expected: 'https://example.com/charter' },
  ])('opens the resolved legitimate destination $href', ({ href, expected }) => {
    const { opened, event } = click('a b', {}, 'click', `<a href="${href}"><b>doc</b></a>`);
    expect(opened).toHaveBeenCalledExactlyOnceWith(expected, '_blank', 'noopener,noreferrer');
    expect(event.defaultPrevented).toBe(true);
  });

  it.each(['//127.0.0.1/admin', '//[::1]/admin', '//169.254.169.254/latest', '//10.0.0.1/doc', 'http://[invalid'])(
    'blocks rejected or malformed web destination %s',
    (href) => {
      const { opened, event } = click('a', {}, 'click', `<a href="${href}">doc</a>`);
      expect(opened).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
    }
  );

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }])(
    'blocks a protocol-relative private destination with modifiers %j',
    (init) => {
      const { opened, event } = click('a', init, 'click', '<a href="//127.0.0.1/admin">doc</a>');
      expect(opened).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
    }
  );

  it('blocks a protocol-relative private destination on middle click', () => {
    const { opened, event } = click('a', { button: 1 }, 'auxclick', '<a href="//127.0.0.1/admin">doc</a>');
    expect(opened).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves a safe middle click to the browser', () => {
    const { opened, event } = click('a[href^="https:"]', { button: 1 }, 'auxclick');
    expect(opened).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not call browser APIs during server execution', () => {
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'server' }] });
    const { opened, event } = click('a[href^="https:"]');
    expect(opened).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
