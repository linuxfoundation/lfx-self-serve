// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { mktgCommentFixture } from '@shared/testing/mktg-comments-test-service';
import { describe, expect, it } from 'vitest';
import { MktgCommentThreadComponent } from './mktg-comment-thread.component';

describe('MktgCommentThreadComponent', () => {
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
  it('distinguishes absent attribution and shows sent/resolved context without interpreting resolution markup', () => {
    const fixture = TestBed.createComponent(MktgCommentThreadComponent);
    fixture.componentRef.setInput('comment', mktgCommentFixture({ author: { name: null }, status: 'resolved', resolution: '<script>plain result</script>' }));
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('name unavailable');
    expect(element.textContent).toContain('mf.positioning');
    expect(element.textContent).toContain('Resolved by the agent');
    expect(element.querySelector('script')).toBeNull();
  });
});
