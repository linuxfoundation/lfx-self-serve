// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiPaginationComponent } from './pagination.component';

const meta: Meta<UiPaginationComponent> = {
  title: 'Uikit/Pagination',
  component: UiPaginationComponent,
  args: { page: 0, pageSize: 10, total: 42 },
  render: (args) => ({ props: args, template: `<lfx-ui-pagination ${argsToTemplate(args)} />` }),
};
export default meta;
type Story = StoryObj<UiPaginationComponent>;

export const Default: Story = {};
/** The five-page window stays centred on the current page. */
export const ManyPages: Story = { args: { total: 12500, page: 40 } };
export const LastPage: Story = { args: { page: 4 } };
/** Renders nothing: every row fits on one page. */
export const SinglePage: Story = { args: { total: 8 } };
