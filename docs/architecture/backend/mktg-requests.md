# Marketing requests storage

`MktgRequestsService` stores one `mktg-requests/v1` record at
`requests/<server-resolved-project>/requests.json` in `marketing-os-artifacts`.
The maximum is 500 requests; reaching it rejects creation rather than dropping history.
Only confirmed absence is empty. Malformed records, missing ETags and read failures
must never be repaired by overwriting them. Like the comments ledger, reads and writes
also enforce a byte ceiling (`MKTG_REQUESTS_STORE_MAX_BYTES`), and private conditional
objects use `private, no-store`. Text is validated as non-blank but retained verbatim.

Creates and state changes use the object store's conditional write, retrying against
fresh snapshots up to `MKTG_DOCUMENT_WRITE_ATTEMPTS`; exhausted contention returns 412.
A create token is bound to the original subject and content. Each request retains at
most two state-change receipts, so retrying a successful action after a later change
returns the current request instead of repeating the action. Token reuse with a
different payload conflicts. Done and declined are terminal.

Subjects are opaque effective-user keys; committee IDs remain empty pending the shared
roles resolver. Public responses whitelist fields, replace subjects with directory-resolved
names and compute `isRequester` for the caller. Author lookups use the same request-memoized
`MktgDocumentAuthorService` resolver as document revisions/comments, bounded to four in-flight directory calls per response.
Request text is not logged. The provisional withdrawal convention is an own open request
moving to declined with note `withdrawn`; ownership is enforced again on the server.
