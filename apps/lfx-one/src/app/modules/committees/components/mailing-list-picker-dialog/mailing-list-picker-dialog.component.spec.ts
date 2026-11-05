// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { GroupsIOMailingList } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { LensService } from '@services/lens.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MailingListPickerDialogComponent } from './mailing-list-picker-dialog.component';

describe('MailingListPickerDialogComponent indexed domains', () => {
  let fixture: ComponentFixture<MailingListPickerDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MailingListPickerDialogComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              mailingLists: [
                { uid: 'ml-1', group_name: 'main', domain: 'lists.example.org', title: 'Main', writer: true },
                { uid: 'ml-2', group_name: 'old', service: { domain: 'lists.example.org' } },
              ] as GroupsIOMailingList[],
              associatedUids: new Set<string>(),
              committeeUid: 'committee-1',
            },
          },
        },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: LensService, useValue: {} },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MailingListPickerDialogComponent);
    await fixture.whenStable();
  });

  it('shows and allows selection of lists with indexed domains even without parent services', async () => {
    expect(fixture.nativeElement.querySelector('[data-testid="settings-ml-picker-row-ml-1"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('main@lists.example.org');
    expect(fixture.nativeElement.querySelector('[data-testid="settings-ml-picker-row-ml-2"]')).toBeNull();

    fixture.componentInstance.toggleMailingList('ml-1');
    expect(fixture.componentInstance.selectedMailingListUids().has('ml-1')).toBe(true);
  });
});

describe('MailingListPickerDialogComponent write access', () => {
  let fixture: ComponentFixture<MailingListPickerDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MailingListPickerDialogComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              mailingLists: [
                { uid: 'ml-w', group_name: 'writable', domain: 'lists.example.org', writer: true },
                { uid: 'ml-r', group_name: 'readonly', domain: 'lists.example.org', writer: false },
                { uid: 'ml-linked', group_name: 'linked', domain: 'lists.example.org', writer: false },
              ] as GroupsIOMailingList[],
              associatedUids: new Set<string>(['ml-linked']),
              committeeUid: 'committee-1',
            },
          },
        },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: LensService, useValue: {} },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MailingListPickerDialogComponent);
    await fixture.whenStable();
  });

  it('still shows lists the user cannot write, marked as disabled', () => {
    const row = fixture.nativeElement.querySelector('[data-testid="settings-ml-picker-row-ml-r"]');
    expect(row).not.toBeNull();
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(fixture.nativeElement.querySelector('[data-testid="settings-ml-picker-row-ml-w"]').getAttribute('aria-disabled')).toBe('false');
  });

  it('does not select a list the user cannot write', () => {
    fixture.componentInstance.toggleMailingList('ml-r');
    expect(fixture.componentInstance.selectedMailingListUids().has('ml-r')).toBe(false);
  });

  it('keeps an already-linked list the user cannot write selected', () => {
    fixture.componentInstance.toggleMailingList('ml-linked');
    expect(fixture.componentInstance.selectedMailingListUids().has('ml-linked')).toBe(true);
  });

  it('selects a writable list', () => {
    fixture.componentInstance.toggleMailingList('ml-w');
    expect(fixture.componentInstance.selectedMailingListUids().has('ml-w')).toBe(true);
  });
});
