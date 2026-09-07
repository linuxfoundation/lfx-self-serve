// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { GITLAB_UNSUPPORTED_HEADER, GITLAB_UNSUPPORTED_MESSAGE } from '@lfx-one/shared/constants';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GitlabUnsupportedComponent } from './gitlab-unsupported.component';

/**
 * Covers the GitLab block opened by DialogService (#2002).
 *
 * What this protects is that the dead end stays a dead end. The block exists because Self Serve
 * holds no verifiable GitLab identity, so the failure mode to guard is not a wrong value but a
 * way forward appearing where there is none — a continue action, or a close that reports
 * something the parent could mistake for a choice.
 *
 * The header is asserted here rather than left to the parent because it is copy: review asked
 * this dialog to name its source, and a generic title would satisfy the parent's test for "a
 * dialog opened" while quietly losing that.
 */
describe('GitlabUnsupportedComponent', () => {
  let fixture: ComponentFixture<GitlabUnsupportedComponent>;
  let close: ReturnType<typeof vi.fn>;

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  beforeEach(async () => {
    close = vi.fn();

    TestBed.configureTestingModule({
      imports: [GitlabUnsupportedComponent],
      providers: [provideRouter([]), provideNoopAnimations(), { provide: DynamicDialogRef, useValue: { close } }],
    });

    fixture = TestBed.createComponent(GitlabUnsupportedComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('states why signing cannot continue, rather than failing silently', () => {
    expect(query('gitlab-unsupported-message')?.textContent?.trim()).toBe(GITLAB_UNSUPPORTED_MESSAGE);
    expect(GITLAB_UNSUPPORTED_MESSAGE).toContain('GitLab');
  });

  it('names GitLab in the header the dialog is opened under', () => {
    // Asked for in review. Held as a constant so the parent and this assertion cannot drift.
    expect(GITLAB_UNSUPPORTED_HEADER).toBe('GitLab CLA signing');
  });

  it('offers Close and nothing that continues to signing, not even disabled', () => {
    // A disabled control would imply a condition the contributor could satisfy, and there is
    // none — Self Serve cannot obtain a GitLab identity at all.
    expect(query('gitlab-unsupported-close')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Continue');
  });

  it('closes with null, so the parent reads it as no outcome rather than a choice', async () => {
    query('gitlab-unsupported-close')?.querySelector('button')?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith(null);
  });
});
