// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { UiButtonComponent } from '../button/button.component';
import { UiEmptyStateComponent } from './empty-state.component';

const meta: Meta<UiEmptyStateComponent> = {
  title: 'Uikit/EmptyState',
  component: UiEmptyStateComponent,
  decorators: [moduleMetadata({ imports: [UiButtonComponent] })],
  // Compodoc cannot read the shared union alias, so the select is declared here.
  argTypes: { headingLevel: { control: 'select', options: [1, 2, 3, 4, 5, 6] } },
  args: { heading: 'No meetings scheduled', description: 'Meetings for this committee will appear here.', icon: 'fa-light fa-calendar', headingLevel: 3 },
  render: (args) => ({ props: args, template: `<lfx-ui-empty-state ${argsToTemplate(args)} />` }),
};
export default meta;
type Story = StoryObj<UiEmptyStateComponent>;

/** Blank slate: first run, nothing to do yet. Icon, title and one sentence. */
export const BlankSlate: Story = {};

/** Informational: one primary action and a "Learn more" link. */
export const Informational: Story = {
  args: {
    heading: 'No metrics yet',
    description: 'Connect a GitHub organization to start tracking contributors, pull requests and releases.',
    icon: 'fa-light fa-chart-bar',
  },
  render: (args) => ({
    props: args,
    template: `
      <lfx-ui-empty-state ${argsToTemplate(args)}>
        <lfx-ui-button empty-state-action>Connect GitHub</lfx-ui-button>
        <a empty-state-action href="#" class="text-ui-accent-700 underline-offset-[3px] hover:underline focus-visible:shadow-focus focus-visible:outline-none">
          Learn more <i class="fa-light fa-arrow-up-right-from-square" aria-hidden="true"></i>
        </a>
      </lfx-ui-empty-state>`,
  }),
};

/** Educational: the action starts a short in-context onboarding. */
export const Educational: Story = {
  args: {
    heading: 'Run your first survey',
    description: 'A short walkthrough shows how to build a survey and send it to your members.',
    icon: 'fa-light fa-clipboard-list',
  },
  render: (args) => ({
    props: args,
    template: `
      <lfx-ui-empty-state ${argsToTemplate(args)}>
        <lfx-ui-button empty-state-action icon="fa-light fa-play">Start Walkthrough</lfx-ui-button>
        <lfx-ui-button empty-state-action variant="secondary">Skip</lfx-ui-button>
      </lfx-ui-empty-state>`,
  }),
};

/** Guide: starter content below the actions. The cards are plain markup here; no card component exists in the uikit yet. */
export const Guide: Story = {
  args: { heading: 'Start from a template', description: 'Pick a starting point, or begin with a blank committee.', icon: 'fa-light fa-sparkles' },
  render: (args) => ({
    props: args,
    template: `
      <lfx-ui-empty-state ${argsToTemplate(args)}>
        <lfx-ui-button empty-state-action variant="secondary">Start Blank</lfx-ui-button>
        <!-- Exact px, not rem; 14px root: library guide grid, 640px wide, 12px gaps, 12px above. -->
        <div class="mt-[12px] grid w-full max-w-[640px] grid-cols-3 gap-[12px] text-left">
          <div class="edge rounded-ui-sm p-[16px] label-14 text-ui-neutral-900">Governance board</div>
          <div class="edge rounded-ui-sm p-[16px] label-14 text-ui-neutral-900">Technical steering</div>
          <div class="edge rounded-ui-sm p-[16px] label-14 text-ui-neutral-900">Working group</div>
        </div>
      </lfx-ui-empty-state>`,
  }),
};

/** Your own artwork replaces the icon tile through the `empty-state-media` slot. */
export const WithIllustration: Story = {
  args: { icon: '' },
  render: (args) => ({
    props: args,
    template: `
      <lfx-ui-empty-state ${argsToTemplate(args)}>
        <svg empty-state-media width="96" height="64" viewBox="0 0 96 64" fill="none" aria-hidden="true"><rect x="2" y="2" width="92" height="60" rx="12" class="stroke-ui-neutral-400" stroke-width="2" /><path d="M20 44l18-16 14 12 10-8 14 12" class="stroke-ui-accent-500" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </lfx-ui-empty-state>`,
  }),
};
