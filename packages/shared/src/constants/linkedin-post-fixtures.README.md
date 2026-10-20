# LinkedIn Post recorded test fixtures

These synthetic/aliased fixtures support contract, renderer, questions/activity,
BFF and browser regression tests. They are not a live deployment check.

- `linkedin-post-recorded-base.fixture.ts`: base envelope cases.
- `linkedin-post-recorded.fixture.ts`: aggregates eight cases with source provenance.
- `linkedin-post-questions.fixture.ts`: questions/answers and safe public progress.

Sources are the agent QA runs named in each file's header. Person and external
organisation identities are aliased; original document digests are provenance
only. Each envelope's own digest hashes its aliased document bytes. No recorded
authentication metadata or private reasoning is included.

The modules are not exported by production barrels. Their current location is
still emitted to `dist`; moving/excluding them requires a separate build-config
change. No production validator is bypassed when tests consume these fixtures.
