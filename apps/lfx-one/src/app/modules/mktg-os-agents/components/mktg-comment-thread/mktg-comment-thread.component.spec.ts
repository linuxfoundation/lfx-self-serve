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
