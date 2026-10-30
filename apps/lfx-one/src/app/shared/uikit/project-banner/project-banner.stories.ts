// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { UiButtonComponent } from '../button/button.component';
import { UiProjectBannerComponent } from './project-banner.component';

const action = (label: string): string => `<lfx-ui-button banner-action variant="secondary" size="small" class="shrink-0">${label}</lfx-ui-button>`;

const meta: Meta<UiProjectBannerComponent> = {
  title: 'Uikit/ProjectBanner',
  component: UiProjectBannerComponent,
  decorators: [moduleMetadata({ imports: [UiButtonComponent] })],
  args: { variant: 'default', icon: '', announce: false },
  render: (args) => ({
    props: args,
    template: `<lfx-ui-project-banner ${argsToTemplate(args)}>Attack Challenge Mode is on for this project.${action('Disable')}</lfx-ui-project-banner>`,
  }),
};
export default meta;
type Story = StoryObj<UiProjectBannerComponent>;

export const Default: Story = { args: { icon: 'fa-light fa-shield-halved' } };
export const Success: Story = {
  args: { variant: 'success' },
  render: (args) => ({
    props: args,
    template: `<lfx-ui-project-banner ${argsToTemplate(args)}>Traffic is being served from the last good deployment.${action('View Deployment')}</lfx-ui-project-banner>`,
  }),
};
export const Warning: Story = {
  args: { variant: 'warning', icon: 'fa-light fa-rotate-left' },
  render: (args) => ({
    props: args,
    template: `<lfx-ui-project-banner ${argsToTemplate(args)}>This project was rolled back. New deployments are paused.${action('Undo Rollback')}</lfx-ui-project-banner>`,
  }),
};
export const ErrorState: Story = {
  name: 'Error',
  args: { variant: 'error', icon: 'fa-light fa-credit-card', announce: true },
  render: (args) => ({
    props: args,
    template: `<lfx-ui-project-banner ${argsToTemplate(args)}>Your last payment failed. The project will pause in 3 days.${action('Update Payment')}</lfx-ui-project-banner>`,
  }),
};
export const Gray: Story = {
  args: { variant: 'gray', icon: 'fa-light fa-calendar' },
  render: (args) => ({
    props: args,
    template: `<lfx-ui-project-banner ${argsToTemplate(args)}>Scheduled maintenance on Nov 2, 2026, 02:00-03:00 UTC.${action('Details')}</lfx-ui-project-banner>`,
  }),
};
export const WithoutAction: Story = {
  render: (args) => ({
    props: args,
    template: `<lfx-ui-project-banner ${argsToTemplate(args)}>Attack Challenge Mode is on for this project.</lfx-ui-project-banner>`,
  }),
};
