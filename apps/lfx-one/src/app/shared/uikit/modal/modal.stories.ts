// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive, inject, input, TemplateRef } from '@angular/core';
import { UiModalConfig } from '@lfx-one/shared/interfaces';
import { type Meta, moduleMetadata, type StoryObj } from '@storybook/angular';

import { UiBadgeComponent } from '../badge/badge.component';
import { UiButtonComponent } from '../button/button.component';
import { UiModalComponent } from './modal.component';
import { UiModalService } from './modal.service';

/** Story helper (the template gets `dialogRef` in its context for the buttons to close with): opens the template it is bound to through `UiModalService` when the host is clicked. */
@Directive({ selector: '[lfxStoryOpensModal]', host: { '(click)': 'open()' } })
class StoryOpensModalDirective {
  public readonly lfxStoryOpensModal = input.required<TemplateRef<unknown>>();
  public readonly lfxStoryOpensModalConfig = input<UiModalConfig>({});

  private readonly modal = inject(UiModalService);

  protected open(): void {
    this.modal.open(this.lfxStoryOpensModal(), this.lfxStoryOpensModalConfig());
  }
}

// The text field is a plain input because the uikit input has not landed yet.
const meta: Meta<UiModalComponent> = {
  title: 'Uikit/Modal',
  component: UiModalComponent,
  decorators: [moduleMetadata({ imports: [StoryOpensModalDirective, UiModalComponent, UiButtonComponent, UiBadgeComponent] })],
  parameters: { layout: 'padded' },
  render: () => ({
    template: `
      <lfx-ui-button variant="primary" size="large" [lfxStoryOpensModal]="dialog">Open modal</lfx-ui-button>
      <ng-template #dialog let-ref="dialogRef">
        <lfx-ui-modal heading="Create Committee" subtitle="Committees get their own meetings, mailing list and voting.">
          <label class="flex flex-col gap-[6px] label-14 text-ui-neutral-900">
            Name
            <input class="edge h-ui-medium rounded-ui-sm bg-ui-background-100 px-[12px] label-14 focus-visible:shadow-focus focus-visible:outline-none" value="Technical Oversight Committee" />
          </label>
          <div modalInset class="label-14">Create a mailing list for this committee</div>
          <ng-container modalActions>
            <lfx-ui-button variant="secondary" (click)="ref.close()">Cancel</lfx-ui-button>
            <lfx-ui-button variant="primary" (click)="ref.close()">Create Committee</lfx-ui-button>
          </ng-container>
        </lfx-ui-modal>
      </ng-template>`,
  }),
};
export default meta;
type Story = StoryObj<UiModalComponent>;

/** Title, subtitle, body, inset band and actions. Escape and a click on the backdrop close it; focus returns to the button. */
export const Default: Story = {};

/** A destructive confirmation: `alertdialog`, the 420px size, and focus starts on Cancel through `autoFocus`. */
export const DestructiveConfirm: Story = {
  render: () => ({
    template: `
      <lfx-ui-button variant="danger" size="large" [lfxStoryOpensModal]="dialog" [lfxStoryOpensModalConfig]="{ role: 'alertdialog', describedBy: true, autoFocus: '[data-autofocus] button' }">Delete Project</lfx-ui-button>
      <ng-template #dialog let-ref="dialogRef">
        <lfx-ui-modal size="sm" heading="Delete Project" subtitle="This deletes Q3 Roadmap and its 24 issues for everyone. It can't be undone.">
          <ng-container modalActions>
            <lfx-ui-button data-autofocus variant="secondary" (click)="ref.close()">Cancel</lfx-ui-button>
            <lfx-ui-button variant="danger" (click)="ref.close()">Delete Project</lfx-ui-button>
          </ng-container>
        </lfx-ui-modal>
      </ng-template>`,
  }),
};

/** One full-width action. */
export const SingleAction: Story = {
  render: () => ({
    template: `
      <lfx-ui-button variant="primary" size="large" [lfxStoryOpensModal]="dialog">Open modal</lfx-ui-button>
      <ng-template #dialog let-ref="dialogRef">
        <lfx-ui-modal size="sm" heading="Invite Sent" subtitle="We emailed 3 people. They can join as soon as they accept." [singleAction]="true">
          <ng-container modalActions><lfx-ui-button variant="primary" (click)="ref.close()">Done</lfx-ui-button></ng-container>
        </lfx-ui-modal>
      </ng-template>`,
  }),
};

/** A long body scrolls inside the modal; with `sticky` the title stays put above it. The actions always stay in view. */
export const StickyLongBody: Story = {
  render: () => ({
    template: `
      <lfx-ui-button variant="primary" size="large" [lfxStoryOpensModal]="dialog">Open modal</lfx-ui-button>
      <ng-template #dialog let-ref="dialogRef">
        <lfx-ui-modal [sticky]="true" heading="Terms of Use" subtitle="Scroll to read the whole text.">
          @for (n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; track n) {
            <p class="copy-14">Section {{ n }}. Contributors keep the copyright to their work and license it to the project under the terms the project chose when it was created.</p>
          }
          <ng-container modalActions>
            <lfx-ui-button variant="secondary" (click)="ref.close()">Decline</lfx-ui-button>
            <lfx-ui-button variant="primary" (click)="ref.close()">Accept</lfx-ui-button>
          </ng-container>
        </lfx-ui-modal>
      </ng-template>`,
  }),
};

/**
 * A reading dialog: 720px wide and 800px tall (both fit the window), header fixed with a status badge, a copy action and close,
 * a full-bleed block under the title, and a body that fades at its clipped edges.
 */
export const DialogLayout: Story = {
  render: () => ({
    template: `
      <lfx-ui-button variant="primary" size="large" [lfxStoryOpensModal]="dialog">Open modal</lfx-ui-button>
      <ng-template #dialog let-ref="dialogRef">
        <lfx-ui-modal heading="AI Summary" [width]="720" [height]="800" sticky closable scrollFade>
          <lfx-ui-badge modalTitleSuffix tone="success" variant="line" size="sm"><i slot="icon" class="fa-light fa-check"></i>Approved</lfx-ui-badge>
          <ng-container modalHeaderActions>
            <lfx-ui-button variant="tertiary" [iconOnly]="true" icon="fa-light fa-copy" ariaLabel="Copy summary" />
            <span aria-hidden="true" class="mx-[4px] h-[20px] w-px bg-ui-neutral-200"></span>
          </ng-container>
          <div modalHeaderExtra class="flex flex-col gap-[4px] px-[24px] py-[16px] shadow-[inset_0_1px_0_0,inset_0_-1px_0_0] shadow-ui-neutral-200">
            <span class="label-14 text-ui-neutral-900">Technical Steering Committee</span>
            <span class="copy-12 text-ui-neutral-500">Tue, Nov 4 · 9:00 AM – 10:00 AM · Weekly</span>
          </div>
          @for (n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]; track n) {
            <p class="copy-14">Topic {{ n }}. The group reviewed the release plan and agreed to cut the branch once the open blockers are closed.</p>
          }
          <ng-container modalActions>
            <lfx-ui-button variant="secondary" icon="fa-light fa-pen" (click)="ref.close()">Edit</lfx-ui-button>
          </ng-container>
        </lfx-ui-modal>
      </ng-template>`,
  }),
};

/** Escape and the backdrop are turned off, so only the buttons close it. */
export const RequiresAnAnswer: Story = {
  render: () => ({
    template: `
      <lfx-ui-button variant="primary" size="large" [lfxStoryOpensModal]="dialog" [lfxStoryOpensModalConfig]="{ closeOnEscape: false, closeOnBackdropClick: false }">Open modal</lfx-ui-button>
      <ng-template #dialog let-ref="dialogRef">
        <lfx-ui-modal size="sm" heading="Session Expired" subtitle="Sign in again to keep your changes.">
          <ng-container modalActions><lfx-ui-button variant="primary" (click)="ref.close()">Sign In</lfx-ui-button></ng-container>
        </lfx-ui-modal>
      </ng-template>`,
  }),
};

/** The layout on its own, on the scrim colour, as in the library preview. It is plain layout: the dialog role and focus trap come from `UiModalService`. */
export const Layout: Story = {
  render: () => ({
    template: `
      <div class="flex justify-center rounded-ui-md bg-ui-overlay p-[24px]">
        <lfx-ui-modal heading="Create Committee" subtitle="Committees get their own meetings, mailing list and voting.">
          <p class="copy-14">Body content goes here.</p>
          <div modalInset class="label-14">Inset band</div>
          <ng-container modalActions>
            <lfx-ui-button variant="secondary">Cancel</lfx-ui-button>
            <lfx-ui-button variant="primary">Create Committee</lfx-ui-button>
          </ng-container>
        </lfx-ui-modal>
      </div>`,
  }),
};
