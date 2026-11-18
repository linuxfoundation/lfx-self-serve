// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { BEHAVIORAL_CLASS_CONFIG } from '@lfx-one/shared/constants';
import { MyCommittee } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupCardComponent } from './group-card.component';

const group = (extra: Partial<MyCommittee> = {}): MyCommittee =>
  ({
    uid: 'g1',
    name: 'Docs WG',
    category: 'Technical Advisory Committee',
    behavioralClass: 'oversight-committee',
    classDisplay: BEHAVIORAL_CLASS_CONFIG['oversight-committee'],
    public: true,
    enable_voting: true,
    total_members: 12,
    my_role: 'Member',
    is_foundation: false,
    project_slug: 'synthetic-proj',
    project_name: 'Synthetic Project',
    ...extra,
  }) as MyCommittee;

describe('GroupCardComponent', () => {
  let navigate: ReturnType<typeof vi.spyOn>;
  let navigateByUrl: ReturnType<typeof vi.spyOn>;

  const render = async (value: MyCommittee): Promise<ComponentFixture<GroupCardComponent>> => {
    const fixture = TestBed.createComponent(GroupCardComponent);
    fixture.componentRef.setInput('group', value);
    await fixture.whenStable();
    return fixture;
  };
  const one = (fixture: ComponentFixture<GroupCardComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (element: Element | null): string => element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public observe = vi.fn();
        public disconnect = vi.fn();
      }
    );
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const router = TestBed.inject(Router);
    navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("shows the group's own type, falling back to its class label", async () => {
    expect(text(one(await render(group()), 'groups-home-card-type'))).toBe('Technical Advisory Committee');
    expect(text(one(await render(group({ category: '' })), 'groups-home-card-type'))).toBe('Oversight');
  });

  it('links the name to the group page on its tier, with the project', async () => {
    const fixture = await render(group());

    expect(one(fixture, 'groups-home-card-name')?.getAttribute('href')).toBe('/project/groups/g1?project=synthetic-proj');
  });

  it('shows members, voting and a private group as a focusable lock', async () => {
    const fixture = await render(group({ public: false, enable_voting: false }));

    expect(text(one(fixture, 'groups-home-card-members'))).toBe('12 members');
    expect(text(one(fixture, 'groups-home-card-voting'))).toBe('No voting');
    expect(one(fixture, 'groups-home-card-visibility')?.getAttribute('aria-label')).toBe('Private');
    expect(one(fixture, 'groups-home-card-visibility')?.getAttribute('tabindex')).toBe('0');
  });

  it('opens the project in the app, but leaves a modified click to the browser', async () => {
    const fixture = await render(group());
    const project = one(fixture, 'groups-home-card-project') as HTMLAnchorElement;

    project.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
    expect(navigateByUrl).not.toHaveBeenCalled();

    project.click();
    expect(navigateByUrl).toHaveBeenCalledWith('/project/overview?project=synthetic-proj');
  });

  it("opens a group's several mailing lists on the group page, keeping the back label", async () => {
    const fixture = await render(
      group({
        mailing_lists: [
          { uid: 'ml-1', group_name: 'dev' },
          { uid: 'ml-2', group_name: 'announce' },
        ],
      })
    );

    const list = one(fixture, 'groups-home-card-channel-mailing-list')?.querySelector('a');
    expect(list?.getAttribute('href')).toBe('/project/groups/g1?project=synthetic-proj');
    expect(list?.getAttribute('target')).toBe('_self');
    list?.click();
    expect(navigate).toHaveBeenCalledWith(['/', 'project', 'groups', 'g1'], {
      queryParams: { project: 'synthetic-proj' },
      state: { backLabel: 'Groups', fromMeLens: true },
    });
  });

  it('mails the address in the same tab and opens chat in a new tab', async () => {
    const fixture = await render(group({ mailing_list: 'dev@lists.example.org', chat_channel: 'https://acme.slack.com/archives/C1' }));
    const mail = one(fixture, 'groups-home-card-channel-mailing-list')?.querySelector('a');
    const slack = one(fixture, 'groups-home-card-channel-slack')?.querySelector('a');

    expect([mail?.getAttribute('href'), mail?.getAttribute('target')]).toEqual(['mailto:dev@lists.example.org', '_self']);
    expect([slack?.getAttribute('href'), slack?.getAttribute('target')]).toEqual(['https://acme.slack.com/archives/C1', '_blank']);
  });

  it('shows no channel buttons for a group without channels', async () => {
    const fixture = await render(group());

    expect(fixture.nativeElement.querySelector('[data-testid^="groups-home-card-channel-"]')).toBeNull();
  });
});
