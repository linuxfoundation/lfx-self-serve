# State Management

## 🎯 Angular Signals Architecture

The application uses Angular Signals as the primary state management solution, providing reactive programming without the complexity of RxJS for simple data flows.

## 🔄 Service-Based State Pattern

### Core Pattern

```typescript
@Injectable({ providedIn: 'root' })
export class DataService {
  // Private state signals
  private readonly dataSignal = signal<Data[]>([]);
  private readonly loadingSignal = signal<boolean>(false);
  private readonly errorSignal = signal<string | null>(null);

  // Public readonly signals
  public readonly data = this.dataSignal.asReadonly();
  public readonly loading = this.loadingSignal.asReadonly();
  public readonly error = this.errorSignal.asReadonly();

  // Computed signals for derived state
  public readonly activeData = computed(() => this.dataSignal().filter((item) => item.is_active));

  public readonly dataCount = computed(() => this.dataSignal().length);

  // Actions that update state
  public updateData(newData: Data[]): void {
    this.dataSignal.set(newData);
  }

  public setLoading(loading: boolean): void {
    this.loadingSignal.set(loading);
  }

  public setError(error: string | null): void {
    this.errorSignal.set(error);
  }
}
```

### Benefits

- **Reactive Updates**: Components automatically re-render when signals change
- **Type Safety**: Full TypeScript support with proper typing
- **Performance**: Efficient change detection without Zone.js
- **Simplicity**: Easier to understand than RxJS for simple state
- **Debugging**: Clear state flow and mutations

## 👤 User State Management

### UserService Pattern

```typescript
@Injectable({ providedIn: 'root' })
export class UserService {
  // Authentication state
  private readonly authenticatedSignal = signal<boolean>(false);
  private readonly userSignal = signal<User | null>(null);

  // Public readonly signals
  public readonly authenticated = this.authenticatedSignal.asReadonly();
  public readonly user = this.userSignal.asReadonly();

  // Computed user information
  public readonly userDisplayName = computed(() => {
    const user = this.userSignal();
    return user ? `${user.given_name} ${user.family_name}` : '';
  });

  public readonly userInitials = computed(() => {
    const user = this.userSignal();
    if (!user) return '';

    const firstInitial = user.given_name?.charAt(0) || '';
    const lastInitial = user.family_name?.charAt(0) || '';
    return `${firstInitial}${lastInitial}`.toUpperCase();
  });

  // Actions
  public setAuthenticated(authenticated: boolean): void {
    this.authenticatedSignal.set(authenticated);
  }

  public setUser(user: User | null): void {
    this.userSignal.set(user);
  }

  public logout(): void {
    this.authenticatedSignal.set(false);
    this.userSignal.set(null);
  }
}
```

Personal meeting caches key on `UserService.meetingFeedIdentity`, which combines the effective user's `sub` with `UserService.viewerUsername` (the canonical-first LFID with an alias-only fallback), so a subject swap is caught even when the LFID claim is absent or unchanged. Login/logout and impersonation changes tear down upcoming, past, and latest-past replay chains before a new consumer fetches data. The meeting dashboard and the join page's organizer RSVP lookup also reconnect on this identity and clear the previous subject's data while the replacement request is pending. `viewerUsername` alone remains the LFID used for filters, display, and organizer checks. Lens transitions clear personal rows once when leaving Me, without allowing later inactive personal emissions to erase Foundation/Project results.

Uploaded-avatar resets prefer the effective user's stable `sub`, falling back to the canonical-first LFID when absent. Successful RSVP controls also record confirmations in root-scoped `UserService`, keyed by the effective subject captured when the write started and the meeting (`sub`, then LFID/email fallback). `getUserMeetings()` overlays these confirmations on indexed rows, so Foundation/Project-to-Me route destruction and a stale lazy refetch cannot discard a successful write. It checks replay ownership before reuse, keeping another subject isolated even when aliases are unchanged. Writes outside Me still defer the personal refetch; failed writes are never retained. Newer applicable indexed responses win according to the existing timestamp rules; when a newer indexed `my_rsvp` from an indexed registration fully covers a retained answer (`isRsvpSupersededBy`: the same row, an all-dates answer, or a fully covering scoped answer for the same registration), the personal-feed reconciliation retires that retained answer so a later enrichment outage cannot resurface it. A single-date answer covers only the same normalized date; a following-range answer covers a single date or following range anchored at or after its normalized anchor. Partial overlaps and scoped answers from another live registration do not retire that registration's confirmation, which the organizer overview still needs while its roster is stale. A late canonical claim still refreshes feeds and ownership comparisons without dropping the same subject's avatar or confirmations. For an unresolved recurring date, the root personal-feed overlay filters retained/indexed candidates to all-date responses before selecting the newest answer, so a newer date-scoped answer cannot hide an older all-date confirmation.

Meeting cards reset their local confirmed RSVPs and optimistic post-registration state when either the meeting ID or `meetingFeedIdentity` changes. Foundation/Project rows can lack `my_registrant_ids`, so registration checks alone cannot isolate those local confirmations after login/logout or impersonation. Same-subject service-owned confirmations remain available after a canonical LFID change; local state does not reset when both the meeting ID and viewer identity are unchanged.

The BFF personal feed likewise prefers all-date history before reducing an unresolved recurring meeting to `my_rsvp`. It retains the legacy aggregate fallback only when no all-date answer exists; personal response filters still reject that date-scoped fallback. The join page and RSVP controls request `rsvp_scope=all` on the existing current-user RSVP lookup when their recurring date is unresolved, so the BFF selects only the effective user's all-date responses before choosing the newest answer (or returns `null` without one). Resolved-date and default aggregate lookups keep their existing precedence.

Registration lifetime also bounds retained responses. The personal-feed BFF enriches `my_registrant_ids` from its existing active-registration lookup (`[]` means no active registration; absent means enrichment unavailable). Without an active registration the RSVP write cannot resolve a registrant, so the dashboard keeps meetings with `[]` out of Needs response; absent IDs stay eligible, because a retained confirmed write during an outage already proves a live registration. `UserService` reconciles retained and indexed candidates against those IDs and records ended registration UIDs per effective subject and meeting. Fully completed card/page removals clear root confirmations under the captured subject and discard local history; RSVP controls reject supplied, fetched, retained, and late write acknowledgements for ended registrations. Re-registration can retain responses only for the new registration, while a failed removal leaves the previous response intact. A complete removal also advances a per-subject, per-meeting registration generation; RSVP controls capture it before each write, so an acknowledgement for a write submitted before the removal ends its registration even when the removal could not name that registration's ID. Answers from every live registration stay retained (`retainConfirmedRsvp`): a newer scoped answer keeps an older all-dates answer covering the other dates, and only a newer all-dates answer supersedes them. Confirmation order beats stored timestamps: an acknowledgement (scoped or all-dates) whose timestamp is not later than every retained answer is stamped just after the newest one, so it still wins when a superseded answer resurfaces from the card or roster index, and RSVP controls use that retained copy. Card and join-page organizer overviews receive the same retained answers (filtered by `isMeetingRsvpCurrent`) and apply each by date, so an occurrence switch or remount does not drop a successful write; when a roster is present, a confirmed answer whose registration has no roster row yet is added as its own guest row so counts and previews include it.

`DELETE /api/meetings/:uid/registrants/self` returns `200` with `MeetingRegistrationRemovalResult`: `removed_registrant_ids` contains only successful upstream deletions and `remaining_registrant_ids` contains the caller's rows whose deletion failed. The BFF resolves those IDs from the session; the client supplies only the meeting ID, plus an optional `x-lfx-removal-source` header (`meeting-card`, `meeting-join` or `email-link`, the last for the remove-yourself link in invite emails and calendar events that opens the meeting page with `?action=leave`) that the BFF only logs as `source`. A missing or unrecognised value is logged as `unknown`; the header is never used for authorization and is not forwarded upstream. The success log records the `removed_registrant_ids` and never the removing user's `username` or `email`, so removals can be matched to the upstream service's own logs and registrant records without putting personal data in durable logs. On partial removal it also reads raw RSVP history under the caller's token and returns `remaining_rsvps` restricted to the surviving IDs and meeting. An empty history is known-empty; an omitted field means history was unavailable (or removal was complete). History lookup failure cannot undo successful deletions or turn their result into a failed removal. `clearConfirmedMeetingRsvps` ends only the deleted IDs and preserves the registration generation and surviving confirmations, so a survivor's in-flight RSVP acknowledgement stays valid. It merges recovered history without stamping it as a new write and keeps the newer copy of a matching RSVP row. The active personal feed therefore immediately reselects the survivor's applicable response even after a fresh page load; the card controls and join-page status use the same retained history with their date guards. The card and join page remain invited, warn that removal is incomplete, refresh meeting data, and lazily invalidate the personal replay for its next consumer. Only a result with no remaining IDs marks the meeting registration removed.

Fresh acknowledgements bridge registration-index lag too: before a newly confirmed registration first appears in indexed metadata, an older or empty registration list cannot invalidate its successful write. Once its UID has appeared, a later missing/replaced UID invalidates that registration's retained responses. Explicit successful removal always ends the registration immediately, even before its first indexed appearance.

For the personal feed, `my_rsvp: null` confirms no response, whereas absent `my_rsvp` means the prerequisite lookup was unavailable. The dashboard keeps unknown rows in All meetings but excludes them from response-specific membership and counts. Otherwise-valid local confirmations still bridge an enrichment outage; an outage alone does not invalidate a registration.

## 🧩 Component Integration

### Signal Consumption

```typescript
@Component({
  selector: 'lfx-user-profile',
  template: `
    @if (userService.authenticated()) {
      <div class="user-profile">
        <lfx-avatar [image]="userService.user()?.picture" [label]="userService.userDisplayName()" [shape]="'circle'"> </lfx-avatar>

        <div class="user-info">
          <h3>{{ userService.user()?.name }}</h3>
          <p>{{ userService.user()?.email }}</p>
        </div>
      </div>
    } @else {
      <div>Please log in</div>
    }
  `,
})
export class UserProfileComponent {
  public readonly userService = inject(UserService);
}
```

### Local Component State

```typescript
@Component({
  selector: 'lfx-project-list',
  template: `
    @if (loading()) {
      <div>Loading projects...</div>
    } @else if (error()) {
      <div class="error">{{ error() }}</div>
    } @else {
      <div class="project-grid">
        @for (project of filteredProjects(); track project.id) {
          <lfx-project-card [title]="project.name" [description]="project.description"> </lfx-project-card>
        }
      </div>
    }

    <lfx-button [label]="'Load More'" [loading]="loading()" (onClick)="loadMoreProjects()"> </lfx-button>
  `,
})
export class ProjectListComponent {
  private readonly projectService = inject(ProjectService);

  // Local state
  private readonly filterSignal = signal<string>('');

  // Service state
  public readonly projects = this.projectService.projects;
  public readonly loading = this.projectService.loading;
  public readonly error = this.projectService.error;

  // Computed state
  public readonly filteredProjects = computed(() => {
    const filter = this.filterSignal().toLowerCase();
    const projects = this.projects();

    if (!filter) return projects;

    return projects.filter((project) => project.name.toLowerCase().includes(filter) || project.description.toLowerCase().includes(filter));
  });

  // Actions
  public updateFilter(filter: string): void {
    this.filterSignal.set(filter);
  }

  public loadMoreProjects(): void {
    this.projectService.loadMoreProjects();
  }
}
```

## 🔄 Data Flow Patterns

### Unidirectional Data Flow

```text
User Action → Component Method → Service Action → Signal Update → UI Update
```

### Example Flow

1. User clicks "Load Projects" button
2. Component calls `projectService.loadProjects()`
3. Service sets `loading.set(true)`
4. Service makes HTTP request
5. On success: `projects.set(data)`, `loading.set(false)`
6. On error: `error.set(message)`, `loading.set(false)`
7. Components automatically re-render with new state

## 📡 Async State Management

### HTTP Requests with Signals

```typescript
@Injectable({ providedIn: 'root' })
export class ProjectService {
  private readonly http = inject(HttpClient);

  private readonly projectsSignal = signal<Project[]>([]);
  private readonly loadingSignal = signal<boolean>(false);
  private readonly errorSignal = signal<string | null>(null);

  public readonly projects = this.projectsSignal.asReadonly();
  public readonly loading = this.loadingSignal.asReadonly();
  public readonly error = this.errorSignal.asReadonly();

  public async loadProjects(): Promise<void> {
    this.loadingSignal.set(true);
    this.errorSignal.set(null);

    try {
      const projects = await firstValueFrom(this.http.get<Project[]>('/api/projects'));
      this.projectsSignal.set(projects);
    } catch (error) {
      this.errorSignal.set('Failed to load projects');
      console.error('Error loading projects:', error);
    } finally {
      this.loadingSignal.set(false);
    }
  }
}
```

### Signal + RxJS Integration (when needed)

```typescript
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private readonly dataSignal = signal<RealtimeData[]>([]);

  public readonly data = this.dataSignal.asReadonly();

  constructor() {
    // Use RxJS for complex async operations
    this.setupRealtimeConnection();
  }

  private setupRealtimeConnection(): void {
    const websocket$ = webSocket<RealtimeData>('ws://localhost:8080');

    websocket$
      .pipe(
        takeUntilDestroyed() // Angular 16+ pattern
      )
      .subscribe({
        next: (data) => {
          // Update signal from RxJS stream
          this.dataSignal.update((current) => [...current, data]);
        },
        error: (error) => {
          console.error('WebSocket error:', error);
        },
      });
  }
}
```

## 🎛 State Composition

### Combining Multiple Services

```typescript
@Component({
  selector: 'lfx-dashboard',
  template: `
    <div class="dashboard">
      @if (userService.authenticated()) {
        <div class="welcome">Welcome, {{ userService.user()?.name }}!</div>

        @if (projectService.loading()) {
          <div>Loading projects...</div>
        } @else {
          <div class="stats">
            <div>Total Projects: {{ projectService.projectCount() }}</div>
            <div>Active Projects: {{ projectService.activeProjectCount() }}</div>
          </div>
        }
      }
    </div>
  `,
})
export class DashboardComponent {
  public readonly userService = inject(UserService);
  public readonly projectService = inject(ProjectService);

  constructor() {
    // Load data when component initializes
    if (this.userService.authenticated()) {
      this.projectService.loadProjects();
    }
  }
}
```

## 🔧 Advanced Patterns

### Signal-to-RxJS State Bridges

Use `toObservable()` with lifecycle-managed RxJS subscriptions for state-changing work. Reserve `effect()` for simple logging/debugging, as required by the [frontend review checklist](../../reviews/frontend-checklist.md#5-no-effect-should-fix).

```typescript
import { inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';

export class ComponentWithFilterSync {
  private readonly filterSignal = signal<string>('');
  private readonly projectService = inject(ProjectService);

  public constructor() {
    toObservable(this.filterSignal)
      .pipe(
        filter((value) => !!value),
        takeUntilDestroyed()
      )
      .subscribe((value) => this.projectService.filterProjects(value));
  }
}
```

### Cross-Component Communication

```typescript
// Event bus service for complex component communication
@Injectable({ providedIn: 'root' })
export class EventBusService {
  private readonly eventsSignal = signal<AppEvent[]>([]);

  public readonly events = this.eventsSignal.asReadonly();

  public emit(event: AppEvent): void {
    this.eventsSignal.update((events) => [...events, event]);
  }

  public clear(): void {
    this.eventsSignal.set([]);
  }
}
```

## 📊 Best Practices

1. **Keep signals simple**: Use signals for straightforward state, RxJS for complex async operations
2. **Use readonly signals**: Expose only readonly versions of signals from services
3. **Computed signals for derived data**: Always compute derived state instead of storing it
4. **Service-based state**: Keep state in services, not components
5. **Single responsibility**: Each service should manage one domain of state
6. **Error handling**: Always handle loading and error states
7. **Type safety**: Use proper TypeScript interfaces for all state
8. **Performance**: Use computed signals to avoid unnecessary recalculations

## Marketing OS asset-run handoff

An explicit `?mode=new` opens Sources for review, never a generation or a
questions-token consumption. Scalar prefill comes from the writer-gated durable
last-intake snapshot, this user's scoped same-visit inputs, then completed device-run
inputs, choosing the first present value per field before honestly labelled defaults.
An explicit blank wins over lower-priority values; each field labels its actual origin.
An unavailable history read is distinct from no history; denied access suppresses
private fallback and Start. Recorded blank fields remain blank. Project, effective
subject and explicit entry-mode changes cancel the previous reads and reset the form; SSR never
reads private browser history or starts a history request. Once Generate is accepted, its
entry-only mode is consumed with replaceUrl. Sources state stays latched for that visit;
the scoped internal URL clear does not reset or cancel the attempt. Reload restores saved
questions or polls the accepted writing attempt, never issuing another Generate. Back, catalog tiles and
dependency links clear this entry-only mode instead of transferring it to another agent.

Edit exposes the registered intake controls in place. Start alone prepares or
submits a fresh run, resolving dependency documents again, and removes fresh mode
from the asset handoff URL. Sources stay read-only above research/questions once
started. Dependency blockers and recovery controls remain visible with the editor collapsed.
Fresh sessions never reset document-history numbering: envelope identity is retained separately,
while local history stays monotonic; regenerate-via-generate intakes still send priorVersion.
Uploaded payloads are reused only from an owned same-visit draft when no shared snapshot exists.
The shared scalar/count DTO cannot bind local bytes to a recorded run, so equal values/counts
never establish upload provenance; a shared snapshot requires reattachment or explicit omission.
The same-visit cache outlives successful attempt cleanup, not an application reload. Missing
source counts require reattachment or an explicit choice to continue without them,
never a false kept-file claim. No uploaded content is added to browser persistence.
The explicit omission action is PROVISIONAL pending design sign-off, alongside the Family row Run affordance.

The run route owns intake, the research/writing feed and questions, not the
result or a feedback form. Direct no-answers intakes open the document route
before their first POST. Questions runs transfer their owned attempt after the
accepted answers ACK. Without questions, the first finalize/checking step (or
an earlier receipt-less ready result) transfers the same attempt. A partial
Guild stream cannot distinguish writing from another research/questions round;
model starts or completions alone never authorize a handoff. The producer can
label no-questions writing retroactively once an unambiguous finalize confirms
it. An agent-emitted writing marker would allow an earlier writing-start
handoff; it is a follow-up in marketing-os-agents' [self-serve follow-ups](https://github.com/linuxfoundation/marketing-os-agents/blob/main/docs/self-serve-follow-ups.md), not a contract change here.
There is no unused no-feed submitted-ACK fallback.
The asset page resumes the same attempt without a second POST and owns writing
until the exact stored revision lands. Catalog/intakes own membership/routing.
Framework, kit and boilerplates renderers, exports and dependency sidecars stay
on the document view. Revision workflows, not the retired inline feedback form,
own changes; the existing asset-store current pointer remains authoritative.
The Markdown-era README outcome note was dropped with the Markdown result
surface; it was not moved to About. Source/gap information in asset views remains.

The BFF records a private session-keyed start before acknowledging generation.
Documents reads require the resolved project's writer grant and reconcile those
starts through each agent's schema/hash-validated result path. Public progress
contains an opaque run id, never a Guild session, owner token or starter identity.
A persistence receipt names the exact recorded revision. Turn identity, not a
resettable envelope version, renews an attempt; retries preserve its original
Started date and poll the same session without starting generation. Only a
successful Guild lookup can spend the writing deadline; unresolved questions
pause it. A refusal or a completed idle agent runtime with no valid asset fails
immediately, with its reply rendered as plain text. Reasoning MIME is excluded
before activity, questions, envelope or reply extraction. No new worker, bucket
or atomic-write guarantee is introduced; concurrent completion keeps the
existing revision writer's CAS publication and current-pointer semantics.

Client drafts and pending attempts are subject/project/agent-bound, including a
draft saved before the first POST and the acknowledged answers block saved before
polling. A failed answers poll resumes that bookkeeping; it never repeats the
answers POST. A failed navigation retries its saved destination only. Project or
effective-user changes cancel the handoff and clear displayed progress. Public
selected-run ids travel from Started-run links through the asset view to Retry,
so two failed sessions of one living document cannot share a retry target.

Initial navigation discovers runs of all ages. Timer reads are bounded; private
coverage is materialized into validated public rows, never serialized as skipped
ids or counts. Window-skipped unfinished snapshots are last-known and unavailable.
Clients retain missing same-scope rows while unavailable, back off and stop at the
shared availability timeout; manual refresh resets that budget. One stale row can
make the project's progress unknown and retain another completed run's last-known
row until that pause/manual refresh. Known stored-current metadata is not changed.
Transient reads retain the last same-scope asset/list with a warning; auth,
permission and scope changes fail closed. A first run can have zero revisions and
progress only. Other browsers can read writer-authorized progress, not creator
session capabilities. A restored owned attempt can check questions without another
POST; missing memory-only files require reattachment and explicit Generate.

A stored-revision count or newest write is not an approved-current selection.
Generation receipts identify the produced revision; they do not move an approval
pointer. Client `document`/`persisted` events carry the selected outcome's explicit
location (or `null` until its receipt arrives) and accepted attempt. Cached history
order never selects a handoff revision; receipt-less recovery retains that attempt's
session, capability and prior-version hint, not a newer cached run's. The asset-store item's single approved-current pointer and its chip/state
are the authority for current status, never a separate run/list-derived flag.
