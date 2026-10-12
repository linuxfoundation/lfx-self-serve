// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Location } from '@angular/common';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { GROUPS_CARD_GRID_PAGE_SIZE } from '@lfx-one/shared/constants';
import { MyCommittee } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MyGroupsCardGridComponent } from './my-groups-card-grid.component';

@Component({ selector: 'lfx-group-test-destination', template: '' })
class GroupDestinationComponent {}

function group(overrides: Partial<MyCommittee> = {}): MyCommittee {
  return {
    uid: 'group-1',
    name: 'Synthetic working group',
    category: 'Working Group',
    enable_voting: false,
    public: true,
    sso_group_enabled: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    total_members: 3,
    project_uid: 'synthetic-project',
    my_role: 'Member',
    ...overrides,
  };
}

describe('MyGroupsCardGridComponent', () => {
  let fixture: ComponentFixture<MyGroupsCardGridComponent>;
  let router: Router;
  const writeText = vi.fn().mockResolvedValue(undefined);
  const addMessage = vi.fn();

  function element<T extends HTMLElement = HTMLElement>(testId: string): T {
    const result = fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
    if (!result) throw new Error(`Missing ${testId}`);
    return result;
  }

  async function render(committees: MyCommittee[]): Promise<void> {
    fixture.componentRef.setInput('committees', committees);
    await fixture.whenStable();
  }

  beforeEach(async () => {
    writeText.mockClear();
    addMessage.mockClear();
    vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { writeText } } }));
    await TestBed.configureTestingModule({
      imports: [MyGroupsCardGridComponent],
      providers: [
        { provide: MessageService, useValue: { add: addMessage } },
        provideRouter([
          { path: '', component: GroupDestinationComponent },
          { path: 'foundation/groups/:uid', component: GroupDestinationComponent },
          { path: 'project/groups/:uid', component: GroupDestinationComponent },
          { path: 'groups/:uid', component: GroupDestinationComponent },
        ]),
      ],
    }).compileComponents();
    router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    fixture = TestBed.createComponent(MyGroupsCardGridComponent);
    await render([group()]);
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([
    { tier: true, prefix: '/foundation/groups' },
    { tier: false, prefix: '/project/groups' },
    { tier: undefined, prefix: '/groups' },
  ])('navigates the title using $prefix with project query and return state', async ({ tier, prefix }) => {
    await render([group({ is_foundation: tier, project_slug: 'synthetic-owner' })]);
    element<HTMLAnchorElement>('groups-card-grid-title-group-1').click();
    await fixture.whenStable();
    expect(router.url).toBe(`${prefix}/group-1?project=synthetic-owner`);
    expect(TestBed.inject(Location).getState()).toMatchObject({ backLabel: 'My Groups', fromMeLens: true });
  });

  it('omits the project query when the owner slug is unavailable', async () => {
    element<HTMLAnchorElement>('groups-card-grid-title-group-1').click();
    await fixture.whenStable();
    expect(router.url).toBe('/groups/group-1');
  });

  it('copies the public URL and activates channels without opening group detail', async () => {
    await render([group({ sso_group_name: 'synthetic-sso', mailing_list: 'group@example.test', chat_channel: 'https://example.test/chat' })]);
    element<HTMLButtonElement>('public-group-copy-link-group-1').click();
    await fixture.whenStable();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/groups/synthetic-sso`);
    expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
    const channels = element('groups-card-grid-channels-group-1').querySelectorAll('a');
    expect(Array.from(channels, (link) => link.getAttribute('href'))).toEqual(['mailto:group@example.test', 'https://example.test/chat']);
    expect(channels[1].target).toBe('_blank');
    expect(channels[1].rel).toContain('noopener');
    for (const link of channels) {
      // Suppress jsdom's external navigation, not the component's click handlers.
      link.addEventListener('click', (event) => event.preventDefault(), { once: true });
      link.click();
    }
    await fixture.whenStable();
    expect(router.url).toBe('/');
  });

  it.each(['#general', 'team-chat', 'javascript:alert(1)', 'data:text/html,chat', 'vbscript:msgbox(1)', 'file:///chat', 'ftp://example.com/chat'])(
    'shows chat channel %s as informational text without a destination',
    async (chatChannel) => {
      await render([group({ chat_channel: chatChannel })]);
      const channels = element('groups-card-grid-channels-group-1');
      expect(channels.textContent).toContain(chatChannel);
      expect(channels.querySelector('a, button, [tabindex]')).toBeNull();
      expect(channels.textContent).not.toContain('No channels');
    }
  );

  it.each([
    { channel: 'https://slack.com/synthetic', destination: 'https://slack.com/synthetic' },
    { channel: 'http://example.com/chat', destination: 'http://example.com/chat' },
    { channel: 'example.com/chat', destination: 'https://example.com/chat' },
    { channel: 'HTTPS://example.com/chat', destination: 'HTTPS://example.com/chat' },
  ])('opens normalized chat destination $destination without opening group detail', async ({ channel, destination }) => {
    await render([group({ chat_channel: channel })]);
    const link = element('groups-card-grid-channels-group-1').querySelector<HTMLAnchorElement>('a');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe(destination);
    expect(link!.target).toBe('_blank');
    expect(link!.rel).toContain('noopener');
    link!.addEventListener('click', (event) => event.preventDefault(), { once: true });
    link!.click();
    await fixture.whenStable();
    expect(router.url).toBe('/');
  });

  it('reports clipboard failure without navigating and falls back to the UID', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    element<HTMLButtonElement>('public-group-copy-link-group-1').click();
    await fixture.whenStable();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/groups/group-1`);
    expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Copy failed' }));
    expect(router.url).toBe('/');
  });

  it('keeps mailing-list associations noninteractive and absent channels explicit', async () => {
    await render([group({ has_mailing_list: true }), group({ uid: 'group-2', public: false })]);
    const association = element('groups-card-grid-channels-group-1');
    expect(association.textContent).toContain('Mailing list associated');
    expect(association.querySelector('a, button, [tabindex]')).toBeNull();
    expect(element('groups-card-grid-channels-group-2').textContent).toContain('No channels');
    expect(fixture.nativeElement.querySelector('[data-testid="public-group-copy-link-group-2"]')).toBeNull();
  });

  it.each([undefined, null, 'true', 1])('does not infer voting capability from runtime value %s or missing owner context', async (value) => {
    const committee = group({ parent_project_uid: 'opaque-foundation-id' });
    Reflect.set(committee, 'enable_voting', value);
    await render([committee]);
    expect(element('groups-card-grid-voting-group-1').textContent).toContain('Unavailable');
    expect(element('groups-card-grid-item-group-1').textContent).not.toContain('opaque-foundation-id');
    expect(element('groups-card-grid-item-group-1').textContent).not.toMatch(/foundation/i);
  });

  it('distinguishes enabled and disabled capability and prefers the owning project name', async () => {
    await render([
      group({ enable_voting: true, project_name: 'Synthetic owner', foundation_name: 'Fallback foundation' }),
      group({ uid: 'group-2', enable_voting: false, foundation_name: 'Known fallback' }),
    ]);
    expect(element('groups-card-grid-voting-group-1').textContent).toContain('Enabled');
    expect(element('groups-card-grid-voting-group-2').textContent).toContain('Disabled');
    expect(element('groups-card-grid-item-group-1').textContent).toContain('Synthetic owner');
    expect(element('groups-card-grid-item-group-1').textContent).not.toContain('Fallback foundation');
    expect(element('groups-card-grid-item-group-2').textContent).toContain('Known fallback');
  });

  it('keeps reveal announcements available through the final page and empty-filter transitions', async () => {
    const committees = Array.from({ length: GROUPS_CARD_GRID_PAGE_SIZE + 1 }, (_, index) => group({ uid: `group-${index}` }));
    await render(committees);
    const status = fixture.nativeElement.querySelector('[role="status"]') as HTMLElement;
    expect(status.textContent).toMatch(new RegExp(`Showing\\s+${GROUPS_CARD_GRID_PAGE_SIZE}\\s+of\\s+${committees.length}`));
    element('groups-card-grid-show-more').querySelector('button')!.click();
    await fixture.whenStable();
    expect(status.isConnected).toBe(true);
    expect(status.textContent).toMatch(new RegExp(`Showing\\s+${committees.length}\\s+of\\s+${committees.length}`));
    await render([]);
    expect(status.isConnected).toBe(true);
    expect(status.textContent?.trim()).toBe('');
    await render(committees);
    expect(status.textContent).toMatch(new RegExp(`Showing\\s+${committees.length}\\s+of\\s+${committees.length}`));
  });

  it('preserves revealed pages when filters narrow and then widen the inventory', async () => {
    const committees = Array.from({ length: GROUPS_CARD_GRID_PAGE_SIZE + 1 }, (_, index) => group({ uid: `group-${index}` }));
    await render(committees);
    expect(fixture.nativeElement.querySelector('[data-testid="groups-card-grid-item-group-' + GROUPS_CARD_GRID_PAGE_SIZE + '"]')).toBeNull();
    element('groups-card-grid-show-more').querySelector('button')!.click();
    await fixture.whenStable();
    await render(committees.slice(0, 1));
    await render(committees);
    expect(element(`groups-card-grid-item-group-${GROUPS_CARD_GRID_PAGE_SIZE}`)).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="groups-card-grid-show-more"]')).toBeNull();
  });
});
