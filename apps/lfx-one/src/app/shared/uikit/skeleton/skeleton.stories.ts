// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiSkeletonComponent } from './skeleton.component';

const meta: Meta<UiSkeletonComponent> = {
  title: 'Uikit/Skeleton',
  component: UiSkeletonComponent,
  args: { shape: 'line', width: '240px', height: '20px' },
  render: (args) => ({ props: args, template: `<lfx-ui-skeleton ${argsToTemplate(args)} />` }),
};
export default meta;
type Story = StoryObj<UiSkeletonComponent>;

export const Line: Story = {};
export const Pill: Story = { args: { shape: 'pill', width: '72px', height: '24px' } };
export const Circle: Story = { args: { shape: 'circle', width: '32px', height: '32px' } };
export const ListRow: Story = {
  render: () => ({
    template: `
      <div class="flex w-[480px] items-center justify-between gap-4" aria-busy="true">
        <div class="flex flex-1 items-center gap-3">
          <lfx-ui-skeleton shape="circle" width="32px" height="32px" />
          <div class="flex flex-1 flex-col gap-1.5">
            <lfx-ui-skeleton width="46%" height="14px" />
            <lfx-ui-skeleton width="70%" height="12px" />
          </div>
        </div>
        <lfx-ui-skeleton shape="pill" width="72px" height="24px" />
      </div>`,
  }),
};
export const Card: Story = {
  render: () => ({
    template: `
      <div class="flex w-[320px] flex-col gap-2.5 rounded-ui-md bg-ui-background-100 p-4 edge" aria-busy="true">
        <lfx-ui-skeleton width="40%" height="24px" />
        <lfx-ui-skeleton height="96px" />
        <lfx-ui-skeleton width="60%" />
      </div>`,
  }),
};
