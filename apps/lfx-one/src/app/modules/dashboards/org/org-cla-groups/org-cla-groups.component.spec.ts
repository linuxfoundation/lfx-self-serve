// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { OrgClaGroupsComponent } from './org-cla-groups.component';

describe('OrgClaGroupsComponent', () => {
  let fixture: ComponentFixture<OrgClaGroupsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrgClaGroupsComponent],
      providers: [provideRouter([]), provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgClaGroupsComponent);
    fixture.detectChanges();
  });

  it('renders the empty-state scaffold', () => {
    const root = fixture.nativeElement.querySelector('[data-testid="org-cla-groups"]');
    const empty = fixture.nativeElement.querySelector('[data-testid="org-cla-groups-empty-state"]');

    expect(root).toBeTruthy();
    expect(empty).toBeTruthy();
    expect(root.textContent).toContain('CLA Groups');
    expect(empty.textContent).toContain('No CLA Groups yet');
  });
});
