// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LowerCasePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectChipComponent, SelectChipOption } from '@components/select-chip/select-chip.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { FullNamePipe } from '@pipes/full-name.pipe';
import { MAILING_LIST_MEMBER_LABEL } from '@lfx-one/shared/constants';
import { MailingListMemberDeliveryMode, MailingListMemberModStatus } from '@lfx-one/shared/enums';
import { GroupsIOMailingList, MailingListMember, UpdateMailingListMemberRequest } from '@lfx-one/shared/interfaces';
import { MailingListService } from '@services/mailing-list.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService } from 'primeng/dynamicdialog';
import { BehaviorSubject, catchError, combineLatest, debounceTime, distinctUntilChanged, finalize, of, startWith, switchMap, take } from 'rxjs';

import { ManageMemberModalComponent } from '../manage-member-modal/manage-member-modal.component';

@Component({
  selector: 'lfx-mailing-list-members',
  imports: [
    CardComponent,
    ButtonComponent,
    TableComponent,
    LowerCasePipe,
    FullNamePipe,
    SelectChipComponent,
    ConfirmDialogModule,
    ReactiveFormsModule,
    InputTextComponent,
    SelectComponent,
  ],
  templateUrl: './mailing-list-members.component.html',
  styleUrl: './mailing-list-members.component.scss',
  providers: [FullNamePipe],
})
export class MailingListMembersComponent {
  private readonly mailingListService = inject(MailingListService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fullNamePipe = inject(FullNamePipe);
  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  // Input
  public mailingList = input<GroupsIOMailingList | null>(null);

  // Constants
  protected readonly memberLabel = MAILING_LIST_MEMBER_LABEL;

  // State
  public members = signal<MailingListMember[]>([]);
  public loading = signal<boolean>(true);
  public error = signal<boolean>(false);

  // Computed
  public memberCount = computed(() => this.members().length);

  // Filter-related
  public filterForm: FormGroup;
  public searchTerm: Signal<string>;
  public deliveryModeFilter: Signal<MailingListMemberDeliveryMode | null>;
  public roleFilter: Signal<MailingListMemberModStatus | null>;
  public filteredMembers: Signal<MailingListMember[]>;
  public deliveryModeFilterOptions: Signal<{ label: string; value: MailingListMemberDeliveryMode | null }[]>;
  public roleFilterOptions: Signal<{ label: string; value: MailingListMemberModStatus | null }[]>;

  // Options for select chips
  protected readonly deliveryModeOptions: SelectChipOption<MailingListMemberDeliveryMode>[] = [
    { label: 'Individual', value: MailingListMemberDeliveryMode.NORMAL },
    { label: 'Digest', value: MailingListMemberDeliveryMode.DIGEST },
    { label: 'None', value: MailingListMemberDeliveryMode.NONE },
  ];

  protected readonly roleOptions: SelectChipOption<MailingListMemberModStatus>[] = [
    { label: 'Member', value: MailingListMemberModStatus.NONE },
    { label: 'Moderator', value: MailingListMemberModStatus.MODERATOR },
  ];

  public constructor() {
    // Initialize filter form
    this.filterForm = this.initializeFilterForm();
    this.searchTerm = this.initializeSearchTerm();
    this.deliveryModeFilter = this.initializeDeliveryModeFilter();
    this.roleFilter = this.initializeRoleFilter();
    this.deliveryModeFilterOptions = this.initializeDeliveryModeFilterOptions();
    this.roleFilterOptions = this.initializeRoleFilterOptions();
    this.filteredMembers = this.initializeFilteredMembers();

    this.initializeMembers();
  }

  public refreshMembers(): void {
    this.refresh$.next();
  }

  public onDeliveryModeChange(member: MailingListMember, mode: MailingListMemberDeliveryMode): void {
    if (member.delivery_mode === mode) return;
    this.updateMember({ ...member, delivery_mode: mode }, 'Delivery mode updated', 'Failed to update delivery mode');
  }

  public onRoleChange(member: MailingListMember, role: MailingListMemberModStatus): void {
    if (member.mod_status === role) return;
    this.updateMember({ ...member, mod_status: role }, 'Role updated', 'Failed to update role');
  }

  public deleteMember(member: MailingListMember): void {
    const ml = this.mailingList();
    if (!ml) return;

    const memberName = this.fullNamePipe.transform(member);
    const listName = ml.title || ml.group_name;

    this.confirmationService.confirm({
      message: `Are you sure you want to remove ${memberName} from ${listName}? They will no longer receive emails from this list.`,
      header: `Remove ${this.memberLabel.singular}`,
      acceptLabel: `Remove ${this.memberLabel.singular}`,
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-sm p-button-danger',
      rejectButtonStyleClass: 'p-button-sm p-button-secondary',
      accept: () => {
        this.mailingListService.deleteMember(ml.uid, member.uid).subscribe({
          next: () => {
            // Remove from local state
            const updatedMembers = this.members().filter((m) => m.uid !== member.uid);
            this.members.set(updatedMembers);
            this.messageService.add({
              severity: 'success',
              summary: 'Success',
              detail: `${this.memberLabel.singular} removed successfully`,
            });
          },
          error: (err) => {
            console.error('Failed to delete member', err);
            this.messageService.add({
              severity: 'error',
              summary: 'Error',
              detail: `Failed to remove ${this.memberLabel.singular.toLowerCase()}`,
            });
          },
        });
      },
    });
  }

  public openAddMemberModal(): void {
    const ml = this.mailingList();
    if (!ml) return;

    const dialogRef = this.dialogService.open(ManageMemberModalComponent, {
      header: `Add ${this.memberLabel.singular}`,
      width: '600px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: {
        mailingListId: ml.uid,
        mailingListName: ml.title || ml.group_name,
        member: null,
      },
    });

    dialogRef?.onClose.pipe(take(1)).subscribe((result) => {
      if (result) {
        this.refreshMembers();
      }
    });
  }

  public openEditMemberModal(member: MailingListMember): void {
    const ml = this.mailingList();
    if (!ml) return;

    const dialogRef = this.dialogService.open(ManageMemberModalComponent, {
      header: `Edit ${this.memberLabel.singular}`,
      width: '600px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: {
        mailingListId: ml.uid,
        mailingListName: ml.title || ml.group_name,
        member,
      },
    });

    dialogRef?.onClose.pipe(take(1)).subscribe((result) => {
      if (result) {
        this.refreshMembers();
      }
    });
  }

  private initializeMembers(): void {
    const mailingList$ = toObservable(this.mailingList);

    combineLatest([mailingList$, this.refresh$])
      .pipe(
        switchMap(([ml]) => {
          if (!ml?.uid) {
            this.loading.set(false);
            return of([]);
          }

          this.loading.set(true);
          this.error.set(false);

          return this.mailingListService.getMembers(ml.uid).pipe(
            catchError(() => {
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: 'Failed to load members',
              });
              this.error.set(true);
              return of([]);
            }),
            finalize(() => this.loading.set(false))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((members) => {
        this.members.set(members);
      });
  }

  private updateMember(updatedMember: MailingListMember, successMessage: string, errorMessage: string): void {
    const ml = this.mailingList();
    if (!ml) return;

    // Build the complete update payload - PUT requires all fields
    const updatePayload: UpdateMailingListMemberRequest = {
      username: updatedMember.username || null,
      first_name: updatedMember.first_name || null,
      last_name: updatedMember.last_name || null,
      organization: updatedMember.organization || null,
      job_title: updatedMember.job_title || null,
      delivery_mode: updatedMember.delivery_mode,
      mod_status: updatedMember.mod_status,
    };

    this.mailingListService.updateMember(ml.uid, updatedMember.uid, updatePayload).subscribe({
      next: () => {
        const updatedMembers = this.members().map((m) => (m.uid === updatedMember.uid ? updatedMember : m));
        this.members.set(updatedMembers);
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: successMessage,
        });
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: errorMessage,
        });
      },
    });
  }

  // Filter initialization methods
  private initializeFilterForm(): FormGroup {
    return new FormGroup({
      search: new FormControl(''),
      deliveryMode: new FormControl(null),
      role: new FormControl(null),
    });
  }

  private initializeSearchTerm(): Signal<string> {
    return toSignal(this.filterForm.get('search')!.valueChanges.pipe(startWith(''), debounceTime(300), distinctUntilChanged()), { initialValue: '' });
  }

  private initializeDeliveryModeFilter(): Signal<MailingListMemberDeliveryMode | null> {
    return toSignal(this.filterForm.get('deliveryMode')!.valueChanges.pipe(startWith(null), distinctUntilChanged()), { initialValue: null });
  }

  private initializeRoleFilter(): Signal<MailingListMemberModStatus | null> {
    return toSignal(this.filterForm.get('role')!.valueChanges.pipe(startWith(null), distinctUntilChanged()), { initialValue: null });
  }

  private initializeDeliveryModeFilterOptions(): Signal<{ label: string; value: MailingListMemberDeliveryMode | null }[]> {
    return computed(() => {
      return [
        { label: 'All Delivery Modes', value: null },
        { label: 'Individual', value: MailingListMemberDeliveryMode.NORMAL },
        { label: 'Digest', value: MailingListMemberDeliveryMode.DIGEST },
        { label: 'None', value: MailingListMemberDeliveryMode.NONE },
      ];
    });
  }

  private initializeRoleFilterOptions(): Signal<{ label: string; value: MailingListMemberModStatus | null }[]> {
    return computed(() => {
      return [
        { label: 'All Roles', value: null },
        { label: 'Member', value: MailingListMemberModStatus.NONE },
        { label: 'Moderator', value: MailingListMemberModStatus.MODERATOR },
      ];
    });
  }

  private initializeFilteredMembers(): Signal<MailingListMember[]> {
    return computed(() => {
      let filtered = this.members();

      // Apply search filter
      const searchTerm = this.searchTerm().toLowerCase();
      if (searchTerm) {
        filtered = filtered.filter(
          (member) =>
            member.first_name?.toLowerCase().includes(searchTerm) ||
            member.last_name?.toLowerCase().includes(searchTerm) ||
            member.email?.toLowerCase().includes(searchTerm) ||
            member.organization?.toLowerCase().includes(searchTerm) ||
            member.job_title?.toLowerCase().includes(searchTerm)
        );
      }

      // Apply delivery mode filter
      const deliveryModeFilter = this.deliveryModeFilter();
      if (deliveryModeFilter) {
        filtered = filtered.filter((member) => member.delivery_mode === deliveryModeFilter);
      }

      // Apply role filter
      const roleFilter = this.roleFilter();
      if (roleFilter) {
        filtered = filtered.filter((member) => member.mod_status === roleFilter);
      }

      return filtered;
    });
  }
}
