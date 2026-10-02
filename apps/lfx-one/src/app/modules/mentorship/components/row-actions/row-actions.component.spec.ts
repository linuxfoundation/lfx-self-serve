// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it } from 'vitest';

import { RowActionsComponent } from './row-actions.component';

describe('RowActionsComponent', () => {
  let fixture: ComponentFixture<RowActionsComponent>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const trigger = (): HTMLButtonElement | null => element().querySelector<HTMLButtonElement>('button');

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RowActionsComponent],
      providers: [provideNoopAnimations()],
    });

    fixture = TestBed.createComponent(RowActionsComponent);
    fixture.componentRef.setInput('personName', 'Alex Rivera');
    fixture.componentRef.setInput('testId', 'mentorship-mentee-actions-mnt_1');
    fixture.componentRef.setInput('actions', [
      { value: 'withdraw', label: 'Withdraw', icon: 'fa-light fa-user-minus' },
      { value: 'graduate', label: 'Graduate', icon: 'fa-light fa-graduation-cap' },
    ]);
    fixture.detectChanges();
  });

  it('names the person in the trigger for a screen reader, and carries the row test id', () => {
    expect(trigger()?.getAttribute('aria-label')).toBe('Actions for Alex Rivera');
    // The test id binds to the wrapper host, which is what the tab specs query.
    expect(element().querySelector('[data-testid="mentorship-mentee-actions-mnt_1"]')).not.toBeNull();
  });

  it('builds one menu item per action, keeping the order it was given', () => {
    expect(fixture.componentInstance['menuItems']().map((item) => item.label)).toEqual(['Withdraw', 'Graduate']);
    expect(fixture.componentInstance['menuItems']().map((item) => item.icon)).toEqual(['fa-light fa-user-minus', 'fa-light fa-graduation-cap']);
  });

  it('emits the picked action so the tab can handle it', () => {
    const picked: string[] = [];
    fixture.componentInstance.actionSelect.subscribe((action) => picked.push(action.value));

    fixture.componentInstance['menuItems']()[1].command?.({});

    expect(picked).toEqual(['graduate']);
  });

  it('falls back to an em dash when a row has no action left', () => {
    fixture.componentRef.setInput('actions', []);
    fixture.detectChanges();

    expect(trigger()).toBeNull();
    expect(element().textContent?.trim()).toBe('-');
  });
});
