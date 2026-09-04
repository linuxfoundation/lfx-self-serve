// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { OrgEasyclaComponent } from './org-easycla.component';

describe('OrgEasyclaComponent', () => {
  let fixture: ComponentFixture<OrgEasyclaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaComponent],
      providers: [provideRouter([]), provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgEasyclaComponent);
    fixture.detectChanges();
  });

  it('renders the empty-state scaffold', () => {
    const root = fixture.nativeElement.querySelector('[data-testid="org-easycla"]');
    const empty = fixture.nativeElement.querySelector('[data-testid="org-easycla-empty-state"]');

    expect(root).toBeTruthy();
    expect(empty).toBeTruthy();
    expect(root.textContent).toContain('EasyCLA');
    expect(empty.textContent).toContain('No CLAs signed yet');
  });
});
