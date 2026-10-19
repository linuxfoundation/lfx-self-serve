<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Cursor-Based Pagination

## Overview

The application uses cursor-based pagination (via `page_token`) rather than offset-based pagination. This approach provides consistent results when data changes between pages and scales better for large datasets.

## Query Service API Parameters

| Parameter       | Type       | Description                                                                                                                                                                                                                       |
| --------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page_token`    | `string`   | Opaque cursor from a previous response. Omit for the first page.                                                                                                                                                                  |
| `page_size`     | `number`   | Items per page (default: 50, range: 1–1000)                                                                                                                                                                                       |
| `name`          | `string`   | Typeahead search (multi_match with bool_prefix); the last term matches as a prefix                                                                                                                                                |
| `filters`       | `string[]` | Field filtering (`field:value`, auto-prefixed with `data.`)                                                                                                                                                                       |
| `tags`          | `string[]` | Exact tag matching, OR logic (any tag matches); combinable with `tags_all` in one request                                                                                                                                         |
| `tags_all`      | `string[]` | Exact tag matching, AND logic (every tag must match)                                                                                                                                                                              |
| `type`          | `string`   | Resource type filter                                                                                                                                                                                                              |
| `parent`        | `string`   | Parent resource filter                                                                                                                                                                                                            |
| `filter_grants` | `string`   | `direct` narrows to resources the caller holds a direct OpenFGA `user:` tuple on (no team usersets, no parent inheritance); requires `type`, and only for types that are FGA objects themselves (e.g. `project`, not `formation`) |
| `sort`          | `string`   | Sort order: `name_asc` (default), `name_desc`, `updated_asc`, `updated_desc`, `best_match`                                                                                                                                        |

> **Note**: Use `page_size` (not `limit`) for consistency with the query service API.

**Always pass `sort: 'best_match'` alongside `name`.** `sort` defaults to `name_asc`, and
OpenSearch discards relevance scoring whenever an explicit non-`_score` sort is present. A search
that omits `sort` therefore returns the alphabetically-first page of matches rather than the
closest ones, and the match the user is typing can land on any page. This matters most for
endpoints that truncate or cap their page scan, where upstream order decides what the user ever
sees.

Terms are OR-ed upstream today, so each added word matches _more_ documents rather than fewer.
[linuxfoundation/lfx-v2-query-service#70](https://github.com/linuxfoundation/lfx-v2-query-service/pull/70)
switches this to AND; update this note once it deploys. Relevance ordering is what keeps the
closest match on top either way, which is why `best_match` matters independently of that change.

## Backend Interfaces

```typescript
// Single page response from the query service
export interface QueryServiceResponse<T = unknown> {
  resources: QueryServiceItem<T>[];
  page_token?: string; // Present when more pages exist
}

export interface QueryServiceItem<T = unknown> {
  type: string;
  id: string;
  data: T;
}

// Response shape returned to the frontend
export interface PaginatedResponse<T> {
  data: T[];
  page_token?: string;
}
```

## Backend: Single-Page Fetch

Services that expose pagination to the frontend return `PaginatedResponse<T>`:

```typescript
public async getVotesUpstreamPage(
  req: Request,
  query: Record<string, unknown> = {}
): Promise<PaginatedResponse<Vote>> {
  const { resources, page_token } = await this.microserviceProxy.proxyRequest<
    QueryServiceResponse<IndexedVote>
  >(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', { ...query, type: 'vote' });

  const votes = resources.map((resource) => this.normalizeIndexedVote(req, resource.data));
  return { data: votes, page_token };
}
```

The `page_token` from the query service passes through unchanged.

> **Exception (GH-1558):** the route-mounted `VoteService.getVotes` (`GET /api/votes`) is _not_ a
> passthrough. The query service has no `created_at` sort, so `getVotes` drains the full filtered
> set with `fetchAllQueryResources`, sorts it with the shared `compareVotesByRecency` (active votes
> first, then `creation_time` descending), and slices the requested page itself — emitting its own
> opaque `offset:<n>` page_token. The single-page passthrough above (`getVotesUpstreamPage`) survives
> only for internal consumers that need the raw upstream cursor, like committee-activity's
> saturation walk.

### Management vote summaries, status-tab counts, and closing-only lists

`GET /api/votes/summary` accepts exactly one nonempty `parent=project:<uid>` and an optional
nonempty `group` committee name. Other keys and repeated values are rejected. Accepted Group
names are trimmed before the caller-authorized indexed scan uses `committee_name:<group>`.
The endpoint returns `{ active_votes, closing_soon, as_of }`. No invitation lookup or project enrichment
is needed. Search, status, and pagination never affect these totals; foundation scope is the
selected foundation's project UID, not an expansion into descendants.

`GET /api/votes?closing_soon=true` applies the shared active/deadline predicate to the complete
normalized set **before** sorting and slicing. This BFF-only flag accepts a single `true` or
`false` and is never forwarded upstream. True responses add `total_records` from the same
snapshot as the returned page; the dashboard skips the separate count request in this mode.
False/omitted flags preserve the ordinary response shape. Summary and list both require
`failOnPartial: true`, so a failed scan is unavailable, never a partial total.

`GET /api/votes/status-counts` returns `{ all, active, disabled, ended }` for the votes table's
status tabs (#3687). It accepts exactly one nonempty `parent=project:<uid>`, plus an optional
nonempty `name` search and an optional nonempty `group` committee name. Other keys and repeated
values are rejected, and accepted values are trimmed. Unlike the summary, the search applies
here, because each tab count must equal its tab's list total. One caller-authorized scan
(`failOnPartial: true`) forwards `name` and `committee_name:<group>` upstream, then buckets rows
with the shared `countVotesByStatus`. `all` counts every row, including statuses that are
unrecognized after normalization; those rows fall into no per-status bucket. Status, quick
filters, and pagination never affect these counts.

Any `filters=status:<x>` clause whose value normalizes to a known `PollStatus` (`active`,
`disabled`, `ended`) is evaluated locally with normalized status for both `GET /api/votes` and
`GET /api/votes/count`. Forwarding it as an exact upstream term would exclude legacy mixed-case
votes that the summary and status-tab counts include. The BFF removes only that clause, keeps
other filters/search/scope upstream, and applies normalized status matching to the complete
authorized scan. Status-filtered counts therefore drain pages rather than using the upstream
exact-value count; they ignore list pagination and reject incomplete scans. Count queries
without a recognized status clause, and the internal upstream-cursor passthrough, retain their
existing behavior. Recognized indexed statuses are canonicalized in returned rows so
status-dependent actions agree with the normalized predicates; unrecognized values are
preserved.

Closing means `now < end_time <= now + 7 × 24 hours`. Active totals still include indexed-active
votes whose deadlines are past or invalid. The summary's RFC3339 `as_of` describes its snapshot;
list pagination takes a fresh snapshot, so counts can legitimately differ at a deadline.
Existing cursor recovery handles shrinking sets. Refresh/re-entry reloads totals and rows,
but cannot promise immediate convergence of the search index after mutations.

### Personal vote-feed completeness

`GET /api/votes/my-votes` preserves its array response by default for already-open browser
clients. New clients request `include_status=true` to receive `{ votes, complete }`, following
the personal-newsletter feed's opt-in convention. Only the exact single string `true` opts in.
Invitation enumeration retains successfully fetched pages when a later page exhausts retries,
but marks the feed incomplete.
Per-vote detail reads that explicitly return upstream 403/404 are skipped as not visible to the
caller without marking the feed incomplete; exact counts describe the remaining readable votes.
Other failed or empty required vote-detail reads still mark it incomplete while keeping usable
votes. A first-page failure still fails the request. Optional project metadata does not prove
invitation or vote-detail completeness.

The Me-lens status tabs show unavailable counts unless `complete` is explicitly true; a
partial feed with no usable rows is not a confirmed zero. Filtering or switching status tabs
does not change completeness. Refresh fetches a new feed and restores counts on complete success.
The frontend also accepts legacy array responses, retaining their rows with unknown completeness
and withholding exact tab totals.

## Backend: Complete Fetch (All Pages)

When the server needs all records (e.g., meeting registrants for invitation checks), use the `fetchAllQueryResources` helper:

```typescript
import { fetchAllQueryResources } from '../helpers/query-service.helper';

const registrants = await fetchAllQueryResources<MeetingRegistrant>(req, (pageToken) =>
  this.microserviceProxy.proxyRequest<QueryServiceResponse<MeetingRegistrant>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
    type: 'v1_meeting_registrant',
    tags: `meeting_id:${meetingUid}`,
    page_size: 100,
    ...(pageToken && { page_token: pageToken }),
  })
);
```

The helper:

- Follows `page_token` automatically until all pages are fetched
- Accumulates results into a single array
- Retries on 5xx errors (up to 2 retries with 100ms delay)
- Logs pagination progress at DEBUG level

See [Server Helpers](./server-helpers.md) for more details on the helper implementation.

### Bound multi-request dashboard sources

For a paginated source that also performs authorization and enrichment, a timeout per HTTP request is not a timeout for the entire source. Pass the same `ApiRequestOptions.deadlineAt` (absolute epoch milliseconds) to every standard JSON proxy request and strict access check. `ApiClientService` uses the smaller of the per-request timeout and the remaining deadline, aborts an in-flight transfer when that budget expires, and rejects before dispatch when no budget remains. Pagination retry delays can briefly extend source completion beyond the transport deadline, but cannot dispatch another expired request.

`CommitteeService.getManagedPendingApplications` shares a five-second deadline across discovery pages, writer checks, live reads, and committee-name enrichment. Writer checks run sequentially in batches of at most 100. Groups that pass are then narrowed to those whose own `settings.writers` roster lists the caller (username, then email), so project/foundation admins with inherited writer access do not get every group's requests in their pending actions; roster reads run ten at a time, a 403/404 means "not on the roster", and any other failure rejects the source. Live reads run ten at a time and do not start another wave after the deadline. Metadata reads are likewise limited to one 100-UID batch at a time and pass the same deadline through `getCommitteesByIds`. Timeout or other strict failures reject the entire application source; the Me pending-actions aggregator isolates that failure from its other sources rather than returning an incomplete application list.

This is containment, not writer-scoped discovery. The query service filters returned applications by viewer access, but its status-only candidate search can still walk unrelated pending records upstream. Its direct-grant filter and access-check's `/my-grants` do not enumerate effective inherited writers, so using them as a no-manager short-circuit would exclude legitimate managers. Fully scoped discovery requires an upstream contract that preserves effective writer access.

## Frontend: Service Layer

Frontend services pass pagination parameters through to the backend:

```typescript
public getVotesByProjectPaginated(
  projectUid: string,
  pageSize?: number,
  pageToken?: string,
  searchName?: string,
  filters?: string[]
): Observable<PaginatedResponse<Vote>> {
  let params = new HttpParams().set('parent', `project:${projectUid}`);

  if (pageSize) params = params.set('page_size', pageSize.toString());
  if (pageToken) params = params.set('page_token', pageToken);
  if (searchName) params = params.set('name', searchName);
  if (filters?.length) {
    for (const filter of filters) {
      params = params.append('filters', filter);
    }
  }

  return this.http.get<PaginatedResponse<Vote>>('/api/votes', { params });
}
```

## Frontend: Infinite Scroll Pattern

Used in the meetings dashboard. Data accumulates as the user scrolls.

### State

```typescript
private upcomingPageToken = signal<string | undefined>(undefined);
public loadingMore = signal(false);
public hasMore = computed(() => !!this.upcomingPageToken());
```

### Data Stream

Two observable streams merge into a single accumulated signal:

```typescript
// PageResult adds a reset flag to PaginatedResponse
interface PageResult<T> extends PaginatedResponse<T> {
  reset: boolean;
}

private initMeetings(): Signal<Meeting[]> {
  // First page: resets on filter/search/refresh changes
  const firstPage$ = combineLatest([project$, filter$, search$]).pipe(
    switchMap(([project, filter, search]) => {
      this.loading.set(true);
      return this.meetingService
        .getMeetingsByProjectPaginated(project.uid, 50, undefined, undefined, search)
        .pipe(
          map((r): PageResult<Meeting> => ({ ...r, reset: true })),
          finalize(() => this.loading.set(false))
        );
    })
  );

  // Next pages: triggered by loadMore
  const nextPage$ = this.loadMore$.pipe(
    switchMap((pageToken) => {
      this.loadingMore.set(true);
      return this.meetingService
        .getMeetingsByProjectPaginated(project.uid, 50, undefined, pageToken)
        .pipe(
          map((r): PageResult<Meeting> => ({ ...r, reset: false })),
          finalize(() => this.loadingMore.set(false))
        );
    })
  );

  return toSignal(
    merge(firstPage$, nextPage$).pipe(
      tap((response) => this.upcomingPageToken.set(response.page_token)),
      scan((acc, response) => (response.reset ? response.data : [...acc, ...response.data]), [])
    ),
    { initialValue: [] }
  );
}
```

**Key details:**

- `scan()` accumulates results: `reset: true` replaces the list, `reset: false` appends
- `tap()` stores the `page_token` for the next load
- Filter/search changes emit with `reset: true`, discarding previous results

### Load More Trigger

```typescript
public loadMore(): void {
  const pageToken = this.upcomingPageToken();
  if (!pageToken || this.loadingMore()) return;
  this.loadMore$.next(pageToken);
}
```

## Frontend: Table Pagination Pattern

Used in the votes dashboard with PrimeNG Table. Users navigate between discrete pages.

### Token Array Strategy

Since cursor-based pagination only provides a forward token (no reverse), tokens are stored in an array indexed by page number:

```typescript
// Index 0 = token for page 2, index 1 = token for page 3, etc.
private pageTokens: string[] = [];
protected readonly currentFirst = signal<number>(0); // PrimeNG table offset
protected readonly rowsPerPage = signal<number>(10);
```

### Page Change Handler

```typescript
protected onPageChange(event: { first: number; rows: number }): void {
  if (event.rows !== this.rowsPerPage()) {
    // Rows per page changed — reset pagination
    this.pageTokens = [];
    this.rowsPerPage.set(event.rows);
    this.currentFirst.set(0);
    this.fetch$.next();
    return;
  }

  this.currentFirst.set(event.first);
  this.fetch$.next();
}
```

### Token Lookup

```typescript
const rows = this.rowsPerPage();
const first = this.currentFirst();
const pageIndex = first / rows;

// Look up the token for the requested page
const pageToken = pageIndex > 0 ? this.pageTokens[pageIndex - 1] : undefined;

// Store the response token for the next page
tap((response) => {
  if (response.page_token) {
    this.pageTokens[pageIndex] = response.page_token;
  }
});
```

### Refresh

On refresh, clear stored tokens and reset to page 1:

```typescript
protected refresh(): void {
  this.pageTokens = [];
  this.currentFirst.set(0);
  this.fetch$.next();
}
```

## When to Use Each Pattern

| Scenario                   | Pattern                         | Example                                |
| -------------------------- | ------------------------------- | -------------------------------------- |
| Server needs all records   | `fetchAllQueryResources` helper | Meeting registrants, invitation checks |
| Scrollable list that grows | Infinite scroll with `scan()`   | Meetings dashboard                     |
| Table with page navigation | Token array with PrimeNG Table  | Votes dashboard                        |
| Simple single fetch        | Direct service call             | Drawer data, search results            |

## Guidelines

- Always use `page_size` (not `limit`) for new endpoints
- Pass `page_token` conditionally: `...(pageToken && { page_token: pageToken })`
- Reset token storage when filters, search, or page size change
- Handle missing tokens gracefully (reset to first page)
- Use `switchMap` to cancel in-flight requests when context changes
