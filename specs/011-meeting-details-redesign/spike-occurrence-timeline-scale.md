# Spike S-02: occurrence timeline scale

**Issue**: [#3611](https://github.com/linuxfoundation/lfx-self-serve/issues/3611) · **Epic**:
[#1765](https://github.com/linuxfoundation/lfx-self-serve/issues/1765) · **Feeds**: E6-02
([#3585](https://github.com/linuxfoundation/lfx-self-serve/issues/3585), shipped in PR #3673) ·
**Measured**: 2026-10-20

## Answer

- **Past occurrences per series**: p50 **13**, p90 54, p95 76, p99 **140**, max **761**
  (2,688 series with at least two held occurrences).
- **Future occurrences per series**: the ceiling for an open-ended series, which is about 85% of
  the active recurring ones. So p50 and p99 are both the ceiling. Fewer only when the recurrence
  ends sooner.
- **Ceiling on upcoming occurrences**: **not determined for the ITX response the BFF reads.** The
  only number found is **100**, the count the meeting service itself indexes. ITX probably matches
  it, but nobody has observed that, and the ITX contract documents no cap. The upper bound found is
  1,000, the hard cap in the meeting service's port of ITX's algorithm. See
  [§ ITX ceiling](#itx-ceiling) and how to settle it.
- **Default window**: keep what #3673 shipped, `page_size` 12 per side (max 50), with cursor paging
  per side. No change is needed.
- **Server-side rendering**: no. The strip already renders only its placeholder on the server
  (E6-03, #3586) and should stay that way.
- **Follow-up**: one small one, the false "of M" total described in
  [§ Follow-up](#follow-up). One check is also needed: confirm the ITX count from the logs. Nothing
  else is needed now.

## Method

All reads were read-only, against production, on 2026-10-20. Series are referred to by rank only;
no title, name or identifier is recorded here.

| Question                    | Source                                                                                                 | Population                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Past occurrences per series | LFX analytics warehouse, meeting occurrences model (one row per held occurrence), grouped by series id | Every series in the warehouse, not a sample: 7,540 series, 2,688 of them with at least two occurrences |
| Upcoming occurrences        | Recurrence settings in the warehouse's occurrence dimension; the v2 meeting index (`v1_meeting`)       | 1,676 recurring series that have not ended; three open-ended series read through the index             |
| Ceiling                     | `lfx-v2-meeting-service` source and ITX contract docs (`gh api`)                                       | n/a                                                                                                    |
| Record sizes                | Shape of one `v1_past_meeting` record and one ITX occurrence, with a 250-character description         | Byte counts of compact JSON; content replaced with filler                                              |

Caveats:

- **History starts in 2022.** The warehouse's earliest held occurrence is 2022-01-14, and the v2
  index has no `v1_past_meeting` record before 2022 visible to the reader. So no series has
  history from 2019: the longest-running weekly series found has about 200 held occurrences since
  2022-08. The largest series is a weekday stand-up, at 761 since 2022-11, growing by roughly 250
  a year.
- **Two sources, close but not identical.** The BFF reads `v1_past_meeting` from the query
  service. The warehouse model is built from attendance records, so an occurrence nobody joined may
  be missing, which makes its counts a slight floor. Index counts could only be read with the
  reader's own visibility, which is lower than the BFF's M2M view: 30 and 69 records for two series
  the warehouse counts at 200 and 260, and 35 for a fortnightly series that has run since 2025-01.
  They cannot replace the warehouse figures.
- **The future distribution is computed, not read.** The remaining-occurrence estimate came from
  recurrence fields through generated SQL. It shows that the ceiling binds: for open-ended series
  the uncapped count runs into the thousands. The exact count of each series' live list was not read.

## Measurements

### Occurrence counts

| Side                      | p50 | p90 | p95 | p99 | max | Notes                                                     |
| ------------------------- | --: | --: | --: | --: | --: | --------------------------------------------------------- |
| Past (held)               |  13 |  54 |  76 | 140 | 761 | Top five: 761, 535, 445, 296, 263, mostly daily stand-ups |
| Future (live list)        | cap | cap | cap | cap | cap | 1,426 of 1,676 active recurring series are open-ended     |
| Pages of 500 (past reads) |   1 |   1 |   1 |   1 |   2 | `fetchAllQueryResources` at `page_size: 500`              |

### Payload sizes

Per record (compact JSON, 250-character description, 30-character title):

| Record                                                      |  Bytes |
| ----------------------------------------------------------- | -----: |
| `v1_past_meeting` resource, as the query service returns it | ~1,760 |
| ITX occurrence in the meeting payload                       |   ~475 |
| `past[]` entry in the endpoint response                     |   ~147 |
| `future[]` entry in the endpoint response                   |   ~163 |

Per series:

| Series (past / future) | Upstream past read | ITX `occurrences[]` | Unpaged response (V1) | Paged response, `page_size` 12 (V2) |
| ---------------------- | -----------------: | ------------------: | --------------------: | ----------------------------------: |
| p50 (13 / 13)          |              22 KB |                6 KB |                  4 KB |                              3.6 KB |
| p90 (54 / 100)         |              93 KB |               46 KB |                 24 KB |                              3.6 KB |
| p99 (140 / 100)        |             241 KB |               46 KB |                 36 KB |                              3.6 KB |
| max (761 / 100)        |           1,308 KB |               46 KB |                125 KB |                              3.6 KB |

Future counts assume the 100 cap. If ITX returned up to 1,000, the ITX column and the unpaged
response would grow tenfold on the future side: about 464 KB raw at 250 characters. The paged
response would not change. Every paged response also carries the whole `cancelled_occurrences`
list, which is unpaged and grows with the series, so its bound holds only up to that list. The ITX
column grows with the description: with a 2,000-character agenda
(`MEETING_AGENDA_MAX_LENGTH`), 100 occurrences take about 216 KB raw. They compress to a few KB on
the wire, because each occurrence carries the same description unless that occurrence was edited.

## ITX ceiling

**Not determined for the ITX response; 100 in the index.** What was checked:

- `lfx-v2-meeting-service` `docs/api-contracts/itx-meetings-api.md` and `itx-occurrences-api.md`:
  neither documents a cap on `occurrences[]` in `GET /v2/zoom/meetings/{id}`.
- `lfx-v2-meeting-service` `cmd/meeting-api/eventing/occurrence_calculator.go`: it describes itself
  as a port of ITX's `CalculateOccurrencesV2` ("diverging from it causes occurrence/rule mismatch
  between OpenSearch … and ITX"). `meeting_event_handler.go` calls it for **100** future occurrences
  per meeting. The calculator's own hard limits sit above that: 1,000 occurrences, a 10-year
  horizon and 100 series segments.
- In the production index, all three open-ended recurring series read (weekly and every two weeks)
  carry exactly 100 upcoming occurrences. That only confirms the meeting service's own parameter.
- The BFF does not read the index for `future[]`. `MeetingService.getMeetingById` calls
  `/itx/meetings/{id}`, and the meeting service passes that call through to ITX
  `/v2/zoom/meetings/{id}` with no occurrence parameter and no truncation. ITX's own source is not
  in a repository the reader can reach, and no ITX credentials were used.

So 100 is a working assumption for the ITX response, not a measurement. **To settle it:** the
endpoint already logs `future_count` on every success (`get_public_meeting_occurrences`). An
unpaged (V1) call logs the full `future[]` length, so one log query over open-ended series gives
the real number. It needs production log access, which this spike did not have.

The warehouse's occurrence dimension expands recurrences one year ahead, by its own rule. That is
not the ITX ceiling.

## SSR cost

The current code paths:

1. **Page render.** On the server, `MeetingDetailsStateService` reads
   `GET /public/api/meetings/:id`, which returns the ITX meeting with all of `occurrences[]`, and
   writes it into `TransferState`. At 100 occurrences that is about 46 KB raw, or about 216 KB with
   the longest agendas, serialized into the HTML. It compresses well (see above). It is the same
   for V1. If ITX returns more than 100, this grows in proportion: it is the one SSR cost the log
   check above would change.
2. **Occurrence strip.** `MeetingOccurrenceStripComponent` reads the paged endpoint only in the
   browser (`isPlatformBrowser`), so the server renders the placeholder alone. The endpoint is
   never on the SSR path.
3. **Each endpoint call** reads the ITX meeting again plus _every_ past record, then slices. Cost
   per call is therefore O(series), whatever the `page_size`: one 500-record query page at p99
   (~240 KB of upstream JSON), two at the maximum (~1.3 MB). A strip makes up to 11 calls on load:
   the first page, up to `MEETING_OCCURRENCE_STRIP_MAX_CHASE_PAGES` (5) toward the page's
   occurrence, and up to 5 more toward the next one. It then makes up to 5 per chip move or
   Previous / Next, and one per "Load more" in the browse dialog. That is inside
   `publicApiRateLimiter` (100 per minute per IP) for ordinary use. For the largest series, though,
   each call is two query-service pages.

Rendering the strip on the server would put path 3 in front of the first byte of every public page
view. It would read the ITX meeting a second time, and the history read for the largest series
would take two sequential query-service pages. The strip is below the fold and works as progressive
enhancement, so **it should stay browser-only**.

## Recommendation, against what shipped

| Topic                       | Shipped (PRs #3670, #3673, #3675)                                 | Recommendation                                                                                                                                                                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Default window              | Opt-in `page_size`, default 12 per side, max 50; V1 stays unpaged | **Keep.** 12 past covers the whole history of the median series (13). 12 future is about three months of a weekly series.                                                                                                                                                                              |
| Pagination                  | Per-side cursor (13-digit ms start); ties widen the page          | **Keep.** The response is bounded at about 3.6 KB whatever the series size.                                                                                                                                                                                                                            |
| Upstream reads              | Whole history at `page_size: 500`, sliced in the BFF              | **Keep for now.** p99 is one query page. Revisit once a series passes 1,000 held occurrences (three pages). At the current rate the largest series gets there around late 2027. The fix then is a date-bounded query (`date_from` / `date_to` on start time) for paged requests. It is not needed now. |
| Partial failure             | `past_incomplete` on paged requests                               | Keep.                                                                                                                                                                                                                                                                                                  |
| Strip on the server         | Placeholder only; data read in the browser                        | **Keep browser-only** (see § SSR cost).                                                                                                                                                                                                                                                                |
| Total ("Occurrence N of M") | Shown once neither side has more and history is complete          | **Follow-up needed** (below).                                                                                                                                                                                                                                                                          |

## Follow-up

**Do not claim a total for a series cut at the ceiling.** For an open-ended series, `future[]` ends
at the last occurrence ITX lists (100 in the index) even though the series goes on. Once a viewer has paged through it,
`future_has_more` is `false`. The strip's "Occurrence N of M" and the browse dialog's "N occurrences"
then present past + 100 as the size of the series, which is false. The fix: have the endpoint report
that the live list is capped. For example, `future_capped: true` when the recurrence has no end
on or before the last returned occurrence. That test does not depend on the exact ceiling. The strip and dialog would
then treat that as "total unknown". It is BFF plus two V2 components, behind the flag, with V1
unaffected. It is not implemented here.

Not needed: changes to the default window, the page size limits or the cursor format, and moving
the strip to the server.
