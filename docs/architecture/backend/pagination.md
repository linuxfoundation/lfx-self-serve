<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Cursor-Based Pagination

## Overview

The application uses cursor-based pagination (via `page_token`) rather than offset-based pagination. This approach provides consistent results when data changes between pages and scales better for large datasets.

## Query Service API Parameters

| Parameter    | Type       | Description                                                        |
| ------------ | ---------- | ------------------------------------------------------------------ |
| `page_token` | `string`   | Opaque cursor from a previous response. Omit for the first page.   |
| `page_size`  | `number`   | Items per page (default: 50, range: 1–1000)                        |
| `name`       | `string`   | Typeahead search (multi_match with bool_prefix)                    |
| `filters`    | `string[]` | Field filtering (`field:value`, auto-prefixed with `data.`)        |
| `tags`       | `string`   | Exact tag matching                                                 |
| `tags_all`   | `string`   | Multiple tag matching (AND logic)                                  |
| `type`       | `string`   | Resource type filter                                               |
| `parent`     | `string`   | Parent resource filter                                             |
| `sort`       | `string`   | Sort order: `name_asc`, `name_desc`, `updated_asc`, `updated_desc` |

> **Note**: Use `page_size` (not `limit`) for consistency with the query service API.

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
public async getVotes(
  req: Request,
  query: Record<string, any> = {}
): Promise<PaginatedResponse<Vote>> {
  const { resources, page_token } = await this.microserviceProxy.proxyRequest<
    QueryServiceResponse<Vote>
  >(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', { ...query, type: 'vote' });

  const votes = resources.map((resource) => resource.data);
  return { data: votes, page_token };
}
```

The `page_token` from the query service passes through to the frontend unchanged.

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

  return this.getVotes(params);
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
