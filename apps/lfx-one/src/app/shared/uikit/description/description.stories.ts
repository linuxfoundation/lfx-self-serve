// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiDescriptionComponent } from './description.component';

const meta: Meta<UiDescriptionComponent> = {
  title: 'Uikit/Description',
  component: UiDescriptionComponent,
  args: { label: 'Foundation', value: 'CNCF', align: 'left', ellipsis: false, help: '' },
  render: (args) => ({ props: args, template: `<lfx-ui-description ${argsToTemplate(args)} />` }),
};
export default meta;
type Story = StoryObj<UiDescriptionComponent>;

export const Default: Story = {};
export const WithHelp: Story = { args: { label: 'Plan', value: 'Platinum member', help: 'Your current membership tier' } };
export const RightAligned: Story = { args: { label: 'Contributors', value: '1,284', align: 'right' } };
export const Ellipsis: Story = {
  args: { label: 'Repository', value: 'github.com/kubernetes/community-governance', ellipsis: true },
  render: (args) => ({ props: args, template: `<lfx-ui-description class="max-w-[200px]" ${argsToTemplate(args)} />` }),
};
export const AllVariants: Story = {
  render: () => ({
    template: `
      <div class="flex flex-wrap gap-10">
        <lfx-ui-description label="Foundation" value="CNCF" />
        <lfx-ui-description label="Plan" value="Platinum member" help="Your current membership tier" />
        <lfx-ui-description label="Region" value="Europe (Lisbon)" />
        <lfx-ui-description label="Contributors" value="1,284" align="right" />
        <lfx-ui-description class="max-w-[200px]" label="Repository" value="github.com/kubernetes/community-governance" [ellipsis]="true" />
      </div>`,
  }),
};
