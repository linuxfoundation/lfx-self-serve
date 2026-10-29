// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { mktgCommentFixture } from '@shared/testing/mktg-comments-test-service';
import { describe, expect, it } from 'vitest';
import { MktgCommentThreadComponent } from './mktg-comment-thread.component';

describe('MktgCommentThreadComponent', () => {
  it('previews only the first non-blank line and uses a native disclosure button with a stable controlled region', () => {
    const fixture = TestBed.createComponent(MktgCommentThreadComponent);
    fixture.componentRef.setInput('comment', mktgCommentFixture({ text: 'First line\r\nFull explanation\nMore detail' }));
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const button = element.querySelector('button');
    const details = element.querySelector<HTMLElement>('[data-testid="mktg-comment-details"]');
    expect(button?.getAttribute('type')).toBe('button');
    expect(button?.getAttribute('aria-label')).toBe('Details');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(button?.getAttribute('aria-controls')).toBe(details?.id);
    expect(button?.disabled).toBe(false);
    expect(button?.tabIndex).toBe(0);
    expect(details?.hidden).toBe(true);
    expect(element.querySelector('[data-testid="mktg-comment-preview"]')?.textContent).toContain('First line');
    expect(element.textContent).not.toContain('Full explanation');
    const change = [] as boolean[];
    fixture.componentInstance.expanded.subscribe((value) => change.push(value));
    button?.click();
    fixture.detectChanges();
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(details?.hidden).toBe(false);
    expect(details?.textContent).toContain('Full explanation');
    expect(element.querySelector('button')).toBe(button);
    button?.click();
    fixture.detectChanges();
    expect(details?.hidden).toBe(true);
    expect(details?.textContent).not.toContain('Full explanation');
    expect(change).toEqual([true, false]);
  });

  it.each(['\nFirst readable line\nHidden detail', '\r\n  \r\nFirst readable line\r\nHidden detail'])('skips leading blank lines in %j', (text) => {
    const fixture = TestBed.createComponent(MktgCommentThreadComponent);
    fixture.componentRef.setInput('comment', mktgCommentFixture({ text }));
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const summary = element.querySelector('[data-testid="mktg-comment-summary"]');
    const preview = element.querySelector('[data-testid="mktg-comment-preview"]');
    expect(preview?.textContent?.trim()).toBe('First readable line');
    expect(preview?.previousElementSibling).toBe(summary);
    expect(preview?.classList.contains('w-full')).toBe(true);
    expect(preview?.classList.contains('truncate')).toBe(true);
    expect(summary?.textContent).toContain('Project writer');
    expect(summary?.textContent).not.toContain('First readable line');
    expect(element.querySelector('[data-testid="mktg-comment-body"]')).toBeNull();
    expect(element.textContent).not.toContain('Hidden detail');
  });

  it('keeps details idrefs unique when the same comment appears in the field and the panel', () => {
    const fixtures = [TestBed.createComponent(MktgCommentThreadComponent), TestBed.createComponent(MktgCommentThreadComponent)];
    for (const fixture of fixtures) fixture.componentRef.setInput('comment', mktgCommentFixture());
    const ids = fixtures.map((fixture) => {
      fixture.detectChanges();
      const element = fixture.nativeElement as HTMLElement;
      const id = element.querySelector('[data-testid="mktg-comment-details"]')?.id;
      expect(id).toBeTruthy();
      expect(element.querySelector('button')?.getAttribute('aria-controls')).toBe(id);
      return id;
    });
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('shows role attribution, date, field and open status as plain text', () => {
    const fixture = TestBed.createComponent(MktgCommentThreadComponent);
    fixture.componentRef.setInput('comment', mktgCommentFixture({ text: '<img src=x onerror=alert(1)>' }));
    fixture.componentRef.setInput('fieldLabel', 'Positioning');
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Project writer');
    expect(element.textContent).toContain('21 Oct');
    expect(element.textContent).toContain('on Positioning');
    expect(element.textContent).toContain('Open');
    expect(element.textContent).toContain('<img');
    expect(element.querySelector('img')).toBeNull();
  });
  it.each([
    ['open', 'Open'],
    ['sent', 'Sent to the agent'],
    ['resolved', 'Resolved by the agent'],
  ] as const)('shows %s as a grey status label, not a blue action', (status, label) => {
    const fixture = TestBed.createComponent(MktgCommentThreadComponent);
    fixture.componentRef.setInput('comment', mktgCommentFixture({ status }));
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const badge = Array.from(element.querySelectorAll('p')).find((paragraph) => paragraph.textContent?.trim() === label);
    expect(badge?.className).toBe('inline-flex w-fit items-center rounded-full bg-gray-100 px-2 py-px text-xs font-medium text-gray-700');
    expect(badge?.closest('a, button')).toBeNull();
  });
  it('distinguishes absent attribution and reveals resolution as plain text only on expansion', () => {
    const fixture = TestBed.createComponent(MktgCommentThreadComponent);
    fixture.componentRef.setInput('comment', mktgCommentFixture({ author: { name: null }, status: 'resolved', resolution: '<script>plain result</script>' }));
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('name unavailable');
    expect(element.textContent).toContain('mf.positioning');
    expect(element.textContent).toContain('Resolved by the agent');
    expect(element.querySelector('[data-testid="mktg-comment-resolution"]')).toBeNull();
    element.querySelector('button')?.click();
    fixture.detectChanges();
    expect(element.querySelector('[data-testid="mktg-comment-resolution"]')?.textContent).toBe('<script>plain result</script>');
    expect(element.querySelector('script')).toBeNull();
  });
});
