// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive, inject, input, signal, TemplateRef } from '@angular/core';
import { UiDrawerConfig } from '@lfx-one/shared/interfaces';
import { type Meta, moduleMetadata, type StoryObj } from '@storybook/angular';

import { UiAvatarComponent } from '../avatar/avatar.component';
import { UiBadgeComponent } from '../badge/badge.component';
import { UiButtonComponent } from '../button/button.component';
import { UiMenuItemComponent } from '../menu/menu-item.component';
import { UiMenuComponent } from '../menu/menu.component';
import { UiNoteComponent } from '../note/note.component';
import { UiOptionComponent } from '../select/option.component';
import { UiSelectComponent } from '../select/select.component';
import { UiDrawerComponent } from './drawer.component';
import { UiDrawerService } from './drawer.service';

/** Story helper (the template gets `dialogRef` in its context for the buttons to close with): opens the template it is bound to through `UiDrawerService` when the host is clicked. */
@Directive({ selector: '[lfxStoryOpensDrawer]', host: { '(click)': 'open()' } })
class StoryOpensDrawerDirective {
  public readonly lfxStoryOpensDrawer = input.required<TemplateRef<unknown>>();
  public readonly lfxStoryOpensDrawerConfig = input<UiDrawerConfig>({});

  private readonly drawer = inject(UiDrawerService);

  protected open(): void {
    this.drawer.open(this.lfxStoryOpensDrawer(), this.lfxStoryOpensDrawerConfig());
  }
}

// Paragraphs to make a body taller than the window, so it scrolls under the header.
const FILLER = `
  @for (n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]; track n) {
    <p>Item {{ n }}. The committee reviews the open proposals in order, records the decision and assigns an owner to every follow-up before the next meeting.</p>
  }`;

const meta: Meta<UiDrawerComponent> = {
  title: 'Uikit/Drawer',
  component: UiDrawerComponent,
  decorators: [
    moduleMetadata({
      imports: [
        StoryOpensDrawerDirective,
        UiDrawerComponent,
        UiButtonComponent,
        UiAvatarComponent,
        UiBadgeComponent,
        UiNoteComponent,
        UiSelectComponent,
        UiOptionComponent,
        UiMenuComponent,
        UiMenuItemComponent,
      ],
    }),
  ],
  parameters: { layout: 'padded' },
  render: () => ({
    template: `
      <lfx-ui-button variant="primary" [lfxStoryOpensDrawer]="drawer">Open drawer</lfx-ui-button>
      <ng-template #drawer let-ref="dialogRef">
        <lfx-ui-drawer heading="Project Settings" subtitle="Cloud Native Computing Foundation">
          <p>Everything here is a plain projected body. It scrolls on its own while the header stays in place.</p>
          ${FILLER}
          <ng-container drawerFooter>
            <lfx-ui-button variant="secondary" (click)="ref.close()">Cancel</lfx-ui-button>
            <lfx-ui-button variant="primary" (click)="ref.close()">Save</lfx-ui-button>
          </ng-container>
        </lfx-ui-drawer>
      </ng-template>`,
  }),
};
export default meta;
type Story = StoryObj<UiDrawerComponent>;

/** A 600px sheet on the right: title, subtitle, close button, a body that scrolls and an optional footer. Escape, the scrim and the close button dismiss it; focus returns to the button. At 640px and narrower it fills the window. */
export const Default: Story = {};

/** The meeting details layout: a header row with a project tile before the title and actions beside the close button, and a two-column body that stacks when the drawer is narrow. The body is long, so it scrolls under the header. */
export const MeetingDetails: Story = {
  render: () => ({
    template: `
      <lfx-ui-button variant="primary" [lfxStoryOpensDrawer]="drawer" [lfxStoryOpensDrawerConfig]="{ width: 960 }">Open meeting</lfx-ui-button>
      <ng-template #drawer>
        <lfx-ui-drawer heading="Technical Steering Committee" subtitle="The Linux Foundation">
          <lfx-ui-avatar drawerLeading shape="rounded" [size]="40" name="Technical Steering Committee" [decorative]="true" />
          <ng-container drawerActions>
            <lfx-ui-button variant="secondary" size="small" icon="fa-light fa-pen">Edit meeting</lfx-ui-button>
            <lfx-ui-button variant="secondary" size="small" [iconOnly]="true" icon="fa-light fa-link" ariaLabel="Copy link" lfxUiTooltip="Copy link" />
            <lfx-ui-button variant="secondary-accent" size="small" icon="fa-light fa-wand-magic-sparkles">Magic link</lfx-ui-button>
          </ng-container>
          <div class="@container">
            <div class="grid grid-cols-1 gap-[24px] @[720px]:grid-cols-[1fr_280px]">
              <div class="flex min-w-0 flex-col gap-[16px]">
                <h3 class="heading-32 text-ui-neutral-900">TSC Weekly Sync</h3>
                <div class="flex flex-wrap gap-[8px]">
                  <lfx-ui-badge variant="outline">Public</lfx-ui-badge>
                  <lfx-ui-badge variant="outline">Recurring</lfx-ui-badge>
                  <lfx-ui-badge variant="outline">Governance</lfx-ui-badge>
                  <lfx-ui-badge variant="outline">Recording</lfx-ui-badge>
                </div>
                <div class="flex items-center gap-[12px]">
                  <lfx-ui-button variant="secondary" size="small" icon="fa-light fa-chevron-left">Previous</lfx-ui-button>
                  <span class="label-14 text-ui-neutral-900">29 of 52</span>
                  <lfx-ui-button variant="secondary" size="small" trailingIcon="fa-light fa-chevron-right">Next</lfx-ui-button>
                </div>
                <h4 class="heading-16 text-ui-neutral-900">Agenda</h4>
                ${FILLER}
              </div>
              <div class="flex h-fit flex-col gap-[12px] rounded-ui-md p-[16px] shadow-small">
                <p class="label-14 text-ui-neutral-900">Thursday, November 5, 2026</p>
                <p class="copy-14 text-ui-neutral-600">3:00 PM to 4:00 PM, Europe/Lisbon</p>
                <p class="copy-14 text-ui-neutral-600">Starts in 4 days.</p>
                <lfx-ui-button variant="primary" [fullWidth]="true">Join meeting</lfx-ui-button>
                <p class="label-14 text-ui-neutral-900">Will you attend?</p>
                <lfx-ui-button variant="secondary" [fullWidth]="true">Yes, I'll attend</lfx-ui-button>
                <lfx-ui-button variant="secondary" [fullWidth]="true">Maybe</lfx-ui-button>
                <lfx-ui-button variant="secondary" [fullWidth]="true">Can't attend</lfx-ui-button>
              </div>
            </div>
          </div>
        </lfx-ui-drawer>
      </ng-template>`,
  }),
};

/** `canClose` runs before Escape, the scrim or the close button dismiss the drawer. Type in the box and try to leave: it stays open until you save or discard. The buttons call `ref.close()`, which does not ask. */
export const CanCloseGuard: Story = {
  render: () => {
    const state = { dirty: signal(false), blocked: signal(false) };
    return {
      props: {
        state,
        guard: () => {
          state.blocked.set(state.dirty());
          return !state.dirty();
        },
      },
      template: `
        <lfx-ui-button variant="primary" [lfxStoryOpensDrawer]="drawer" [lfxStoryOpensDrawerConfig]="{ canClose: guard }" (click)="state.dirty.set(false); state.blocked.set(false)">Edit agenda</lfx-ui-button>
        <ng-template #drawer let-ref="dialogRef">
          <lfx-ui-drawer heading="Edit Agenda" subtitle="Weekly Sync">
            @if (state.blocked()) {
              <lfx-ui-note variant="warning" label="You have unsaved changes">Save or discard them to close.</lfx-ui-note>
            }
            <textarea
              class="edge min-h-[160px] w-full rounded-ui-sm bg-ui-background-100 p-[12px] copy-14 focus-visible:shadow-focus focus-visible:outline-none"
              aria-label="Agenda"
              (input)="state.dirty.set(true)"></textarea>
            <ng-container drawerFooter>
              <lfx-ui-button variant="secondary" (click)="ref.close()">Discard</lfx-ui-button>
              <lfx-ui-button variant="primary" (click)="state.dirty.set(false); ref.close('saved')">Save</lfx-ui-button>
            </ng-container>
          </lfx-ui-drawer>
        </ng-template>`,
    };
  },
};

/** `side: 'left'` anchors it to the left edge and moves the radius to its right edge. Width is in px; here 420. */
export const LeftSide: Story = {
  render: () => ({
    template: `
      <lfx-ui-button variant="primary" [lfxStoryOpensDrawer]="drawer" [lfxStoryOpensDrawerConfig]="{ side: 'left', width: 420 }">Open from the left</lfx-ui-button>
      <ng-template #drawer let-ref="dialogRef">
        <lfx-ui-drawer heading="Filters" subtitle="Narrow the meeting list">
          <p>Filter controls go here.</p>
          ${FILLER}
          <ng-container drawerFooter>
            <lfx-ui-button variant="tertiary" (click)="ref.close()">Reset filters</lfx-ui-button>
            <lfx-ui-button variant="primary" (click)="ref.close()">Done</lfx-ui-button>
          </ng-container>
        </lfx-ui-drawer>
      </ng-template>`,
  }),
};

/** A Select and a menu opened inside the drawer render above it, Escape closes only the open panel, and the panel follows when the body scrolls. */
export const OverlaysInside: Story = {
  render: () => ({
    template: `
      <lfx-ui-button variant="primary" [lfxStoryOpensDrawer]="drawer">Open drawer</lfx-ui-button>
      <ng-template #drawer let-ref="dialogRef">
        <lfx-ui-drawer heading="Meeting Settings" subtitle="Weekly Sync">
          <lfx-ui-select label="Visibility" placeholder="Pick who can see it">
            <lfx-ui-option value="public" label="Public" />
            <lfx-ui-option value="private" label="Private" />
            <lfx-ui-option value="committee" label="Committee only" />
          </lfx-ui-select>
          <div>
            <lfx-ui-button variant="secondary" trailingIcon="fa-light fa-chevron-down" [menu]="actions">More actions</lfx-ui-button>
          </div>
          ${FILLER}
          <ng-container drawerFooter>
            <lfx-ui-button variant="secondary" (click)="ref.close()">Cancel</lfx-ui-button>
            <lfx-ui-button variant="primary" (click)="ref.close()">Save</lfx-ui-button>
          </ng-container>
        </lfx-ui-drawer>
        <ng-template #actions>
          <lfx-ui-menu ariaLabel="More actions">
            <lfx-ui-menu-item icon="fa-light fa-copy">Duplicate</lfx-ui-menu-item>
            <lfx-ui-menu-item icon="fa-light fa-calendar">Reschedule</lfx-ui-menu-item>
            <lfx-ui-menu-item variant="danger" icon="fa-light fa-trash-can">Cancel Meeting</lfx-ui-menu-item>
          </lfx-ui-menu>
        </ng-template>
      </ng-template>`,
  }),
};

/** The layout on its own, on the scrim colour, as it renders inside the drawer. It is plain layout: the dialog role, focus trap and close handling come from `UiDrawerService`, so its close button does nothing here. */
export const Layout: Story = {
  render: () => ({
    template: `
      <div class="flex h-[420px] justify-end overflow-hidden bg-ui-overlay">
        <lfx-ui-drawer heading="Project Settings" subtitle="Cloud Native Computing Foundation" class="!w-[420px]">
          <p>Body content goes here.</p>
          <ng-container drawerFooter>
            <lfx-ui-button variant="secondary">Cancel</lfx-ui-button>
            <lfx-ui-button variant="primary">Save</lfx-ui-button>
          </ng-container>
        </lfx-ui-drawer>
      </div>`,
  }),
};
