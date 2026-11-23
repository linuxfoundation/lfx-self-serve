// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MeetingHomeRowProject } from '@lfx-one/shared/interfaces';
import { UiDrawerContext } from '@shared/uikit/drawer/drawer.context';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsProjectLinkComponent } from './meeting-details-project-link.component';

const PROJECT: MeetingHomeRowProject = {
  name: 'Synthetic Project',
  logo: '',
  url: '/project/overview?project=synthetic-project',
  label: 'Jump to project: Synthetic Project',
};

describe('MeetingDetailsProjectLinkComponent', () => {
  let fixture: ComponentFixture<MeetingDetailsProjectLinkComponent>;
  let requestClose: ReturnType<typeof vi.fn<() => void>>;
  let navigateByUrl: ReturnType<typeof vi.fn>;

  const render = async (project: MeetingHomeRowProject): Promise<HTMLElement> => {
    fixture = TestBed.createComponent(MeetingDetailsProjectLinkComponent);
    fixture.componentRef.setInput('project', project);
    await fixture.whenStable();
    return fixture.nativeElement.querySelector('[data-testid="meeting-details-project"]');
  };

  beforeEach(() => {
    requestClose = vi.fn<() => void>();
    navigateByUrl = vi.fn().mockResolvedValue(true);
    const drawer = new UiDrawerContext();
    drawer.requestClose = requestClose;
    TestBed.configureTestingModule({
      providers: [
        { provide: UiDrawerContext, useValue: drawer },
        { provide: Router, useValue: { navigateByUrl } },
      ],
    });
  });

  it('closes the drawer and navigates in-app on a plain click', async () => {
    const link = await render(PROJECT);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(event);

    expect(link.tagName).toBe('A');
    expect(link.getAttribute('aria-label')).toBe('Jump to project: Synthetic Project');
    expect(event.defaultPrevented).toBe(true);
    expect(requestClose).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith(PROJECT.url);
  });

  it('leaves a modified click to the browser', async () => {
    const link = await render(PROJECT);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true });
    link.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(requestClose).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('shows the name without a link when the project has no page', async () => {
    const label = await render({ ...PROJECT, url: null });

    expect(label.tagName).toBe('SPAN');
    expect(label.textContent?.trim()).toBe('Synthetic Project');
  });
});
