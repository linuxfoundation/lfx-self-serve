// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { UiAvatarGroupComponent } from './avatar-group.component';
import { UiAvatarComponent } from './avatar.component';

// Exact px, not rem: the app root font is 14px.
const meta: Meta<UiAvatarComponent> = {
  title: 'Uikit/Avatar',
  component: UiAvatarComponent,
  decorators: [moduleMetadata({ imports: [UiAvatarGroupComponent] })],
  args: {
    name: 'Maria Santos',
    src: '',
    initials: '',
    icon: '',
    badgeIcon: '',
    size: 32,
    tone: 'neutral',
    shape: 'circle',
    placeholder: false,
    decorative: false,
    stacked: false,
  },
  render: (args) => ({ props: args, template: `<lfx-ui-avatar ${argsToTemplate(args)} />` }),
};
export default meta;
type Story = StoryObj<UiAvatarComponent>;

// A data URI keeps the photo story offline.
const PHOTO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#cbd5e1"/><circle cx="32" cy="25" r="12" fill="#64748b"/><rect x="12" y="42" width="40" height="30" rx="16" fill="#64748b"/></svg>'
  );

export const Initials: Story = {};
export const Photo: Story = { args: { src: PHOTO } };
export const BrokenPhotoFallsBackToInitials: Story = { args: { src: 'https://invalid.example/missing.png' } };
export const Sizes: Story = {
  render: () => ({
    template: `<div class="flex items-end gap-[16px]">@for (s of [16, 24, 32, 48, 64]; track s) {<lfx-ui-avatar name="Nuno Esteves" [size]="s" />}</div>`,
  }),
};
export const Tints: Story = {
  render: () => ({
    template: `<div class="flex items-center gap-[16px]">
      <lfx-ui-avatar name="Maria Santos" tone="feature" />
      <lfx-ui-avatar name="Marco Klein" tone="success" />
      <lfx-ui-avatar name="Alex Moore" tone="warning" />
      <lfx-ui-avatar name="Sam Lee" tone="accent" />
      <lfx-ui-avatar name="Kim Park" tone="danger" />
    </div>`,
  }),
};
export const GitProvider: Story = { args: { name: 'octocat', badgeIcon: 'fa-brands fa-github', size: 48 } };
export const Entity: Story = { args: { name: 'CNCF', icon: 'fa-light fa-cube', shape: 'rounded' } };
export const Placeholder: Story = { args: { placeholder: true } };
export const Decorative: Story = { args: { decorative: true } };
export const Group: Story = {
  render: () => ({
    template: `<lfx-ui-avatar-group [limit]="3" [items]="[
      { name: 'Nuno Esteves', tone: 'accent' },
      { name: 'Maria Santos', tone: 'feature' },
      { name: 'Alex Moore', tone: 'warning' },
      { name: 'Sam Lee' },
      { name: 'Kim Park' },
      { name: 'Lee Cho' },
      { name: 'Ana Ruiz' }
    ]" />`,
  }),
};
export const GroupWithoutOverflow: Story = {
  render: () => ({ template: `<lfx-ui-avatar-group [size]="24" [items]="[{ name: 'Nuno Esteves' }, { name: 'Maria Santos', tone: 'feature' }]" />` }),
};
