// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { SearchService } from '@services/search.service';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserSearchComponent } from './user-search.component';

describe('UserSearchComponent', () => {
  let fixture: ComponentFixture<UserSearchComponent>;

  afterEach(() => {
    fixture?.destroy();
  });

  const render = async (disabled: boolean): Promise<void> => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [UserSearchComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: SearchService, useValue: { searchUsers: vi.fn().mockReturnValue(of([])) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserSearchComponent);
    fixture.componentRef.setInput('form', new FormGroup({ ownerUsername: new FormControl<string | null>('') }));
    fixture.componentRef.setInput('searchType', 'committee_member');
    fixture.componentRef.setInput('disabled', disabled);
    fixture.componentRef.setInput('dataTestId', 'user-search-test');
    await fixture.whenStable();
  };

  const query = (): HTMLInputElement | null => fixture.nativeElement.querySelector('[data-testid="user-search-test"] input');

  // GH-2583: `disabled` was previously declared but never wired to the underlying control — these
  // two tests exist solely to cover that fix, not to re-test the component's existing
  // search/select/clear behavior.
  it('disables the underlying input when disabled is true', async () => {
    await render(true);

    expect(query()?.disabled).toBe(true);
  });

  it('leaves the input enabled by default', async () => {
    await render(false);

    expect(query()?.disabled).toBe(false);
  });
});
