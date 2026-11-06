// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
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
    TestBed.configureTestingModule({ imports: [ProfilePanelComponent], providers: [{ provide: MessageService, useValue: { add: vi.fn() } }] });
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
 * "Member since" field in the metadata grid, alongside job title/organization/etc. (#2837).
 * Hidden entirely when absent — no dash placeholder — matching every other optional field.
 */
describe('ProfilePanelComponent — member since (#2837)', () => {
  let fixture: ComponentFixture<ProfilePanelComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ProfilePanelComponent], providers: [{ provide: MessageService, useValue: { add: vi.fn() } }] });
    fixture = TestBed.createComponent(ProfilePanelComponent);
    fixture.detectChanges();
  });

  it('renders the member-since field when set', () => {
    fixture.componentRef.setInput('memberSince', 'Mar 2023');
    fixture.detectChanges();

    const el = fixture.nativeElement.querySelector('[data-testid="profile-panel-member-since"]');
    expect(el).not.toBeNull();
    expect(el.textContent).toContain('Member since');
    expect(el.textContent).toContain('Mar 2023');
  });

  it('hides the member-since field when empty', () => {
    fixture.componentRef.setInput('memberSince', '');
    fixture.detectChanges();

    const el = fixture.nativeElement.querySelector('[data-testid="profile-panel-member-since"]');
    expect(el).toBeNull();
  });
});

/** The LFID is labelled and copyable so users can tell it apart and paste it into forms (#5318). */
describe('ProfilePanelComponent — LFID (#5318)', () => {
  let fixture: ComponentFixture<ProfilePanelComponent>;
  let comp: ProfilePanelComponent;
  const copy = vi.fn();
  const add = vi.fn();

  beforeEach(() => {
    copy.mockReset();
    add.mockReset();
    TestBed.configureTestingModule({
      imports: [ProfilePanelComponent],
      providers: [
        { provide: Clipboard, useValue: { copy } },
        { provide: MessageService, useValue: { add } },
      ],
    });
    fixture = TestBed.createComponent(ProfilePanelComponent);
    comp = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('labels the username as the LFID', () => {
    fixture.componentRef.setInput('username', 'alovelace');
    fixture.detectChanges();

    const el = fixture.nativeElement.querySelector('[data-testid="profile-panel-lfid"]');
    expect(el.textContent).toContain('LFID: alovelace');
    expect(fixture.nativeElement.querySelector('[data-testid="profile-panel-lfid-copy"]')).not.toBeNull();
  });

  it('hides the LFID row when there is no username', () => {
    expect(fixture.nativeElement.querySelector('[data-testid="profile-panel-lfid"]')).toBeNull();
  });

  it('copies only the username and confirms with a success toast', () => {
    fixture.componentRef.setInput('username', 'alovelace');
    copy.mockReturnValue(true);

    comp.copyLfid();

    expect(copy).toHaveBeenCalledWith('alovelace');
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
  });

  it('shows an error toast when the copy fails', () => {
    fixture.componentRef.setInput('username', 'alovelace');
    copy.mockReturnValue(false);

    comp.copyLfid();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });
});
