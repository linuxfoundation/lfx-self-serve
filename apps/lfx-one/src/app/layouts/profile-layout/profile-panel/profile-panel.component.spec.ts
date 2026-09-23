// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfilePanelComponent } from './profile-panel.component';

/**
 * Guards the impersonation regression these fixes target (#2399, #2400): both "Edit profile" and
 * "Public profile settings" must open their drawers even while impersonating — the drawers themselves
 * render read-only rather than the buttons blocking them from opening at all.
 */
describe('ProfilePanelComponent — impersonation (#2399, #2400)', () => {
  let fixture: ComponentFixture<ProfilePanelComponent>;
  let comp: ProfilePanelComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ProfilePanelComponent] });
    fixture = TestBed.createComponent(ProfilePanelComponent);
    comp = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('emits editRequested while impersonating', () => {
    fixture.componentRef.setInput('impersonating', true);
    const editRequested = vi.fn();
    comp.editRequested.subscribe(editRequested);

    comp.onEdit();

    expect(editRequested).toHaveBeenCalledTimes(1);
  });

  it('emits visibilityRequested while impersonating', () => {
    fixture.componentRef.setInput('impersonating', true);
    const visibilityRequested = vi.fn();
    comp.visibilityRequested.subscribe(visibilityRequested);

    comp.onVisibility();

    expect(visibilityRequested).toHaveBeenCalledTimes(1);
  });

  it('emits visibilityRequested when not impersonating', () => {
    fixture.componentRef.setInput('impersonating', false);
    const visibilityRequested = vi.fn();
    comp.visibilityRequested.subscribe(visibilityRequested);

    comp.onVisibility();

    expect(visibilityRequested).toHaveBeenCalledTimes(1);
  });
});

/**
 * "Member since" line under the @handle (#2837). Hidden entirely when absent — no dash
 * placeholder — matching every other optional row in this panel.
 */
describe('ProfilePanelComponent — member since (#2837)', () => {
  let fixture: ComponentFixture<ProfilePanelComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ProfilePanelComponent] });
    fixture = TestBed.createComponent(ProfilePanelComponent);
    fixture.detectChanges();
  });

  it('renders the member-since line when set', () => {
    fixture.componentRef.setInput('memberSince', 'Mar 2023');
    fixture.detectChanges();

    const el = fixture.nativeElement.querySelector('[data-testid="profile-panel-member-since"]');
    expect(el).not.toBeNull();
    expect(el.textContent).toContain('Member since Mar 2023');
  });

  it('hides the member-since line when empty', () => {
    fixture.componentRef.setInput('memberSince', '');
    fixture.detectChanges();

    const el = fixture.nativeElement.querySelector('[data-testid="profile-panel-member-since"]');
    expect(el).toBeNull();
  });
});
