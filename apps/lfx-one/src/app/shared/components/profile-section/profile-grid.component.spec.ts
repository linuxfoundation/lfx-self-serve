// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ProfileGridComponent } from './profile-grid.component';

// The host template is set in the TestBed below: inline templates are capped at three lines.
const HOST_TEMPLATE = `
    <lfx-profile-grid [total]="items().length" [limit]="3" [(expanded)]="expanded">
      @for (item of shown(); track item) {
        <span data-testid="item">{{ item }}</span>
      }
    </lfx-profile-grid>
`;

@Component({
  selector: 'lfx-test-host',
  template: '',
})
class TestHostComponent {
  public readonly items = signal(['a', 'b', 'c', 'd', 'e']);
  public readonly expanded = signal(false);
  public readonly shown = computed(() => this.items().slice(0, this.expanded() ? this.items().length : 3));
}

describe('ProfileGridComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  const query = (testId: string) => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  const toggleButton = () => query('profile-grid-toggle')?.querySelector('button') as HTMLButtonElement;

  beforeEach(() => {
    fixture = TestBed.configureTestingModule({ imports: [TestHostComponent] })
      .overrideComponent(TestHostComponent, { set: { imports: [ProfileGridComponent], template: HOST_TEMPLATE } })
      .createComponent(TestHostComponent);
    fixture.detectChanges();
  });

  it('shows the first items with a fade and "View all (N)" while collapsed', () => {
    expect(fixture.nativeElement.querySelectorAll('[data-testid="item"]').length).toBe(3);
    expect(query('profile-grid-fade')).not.toBeNull();
    expect(toggleButton().textContent?.trim()).toBe('View all (5)');
    expect(toggleButton().getAttribute('aria-expanded')).toBe('false');
    expect(toggleButton().getAttribute('aria-controls')).toBe(query('profile-grid')?.id);
  });

  it('expands to every item and offers "Show less"', () => {
    toggleButton().click();
    fixture.detectChanges();

    expect(fixture.componentInstance.expanded()).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('[data-testid="item"]').length).toBe(5);
    expect(query('profile-grid-fade')).toBeNull();
    expect(toggleButton().textContent?.trim()).toBe('Show less');
    expect(toggleButton().getAttribute('aria-expanded')).toBe('true');
  });

  it('has no fade or button when everything fits', () => {
    fixture.componentInstance.items.set(['a', 'b']);
    fixture.detectChanges();

    expect(query('profile-grid-fade')).toBeNull();
    expect(query('profile-grid-toggle')).toBeNull();
  });
});
