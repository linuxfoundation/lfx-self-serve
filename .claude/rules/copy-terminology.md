---
description: Company Lens glossary — user-facing copy says "company", never "organization" or "Org Lens"
paths:
  - '**/*.html'
  - '**/*.component.ts'
  - '**/*.routes.ts'
  - 'docs/user/**'
---

# Copy terminology (Company Lens)

Epic #5060, story #5061. Everything a user can read says **company**. This is the glossary every new template, page title, label, tooltip, aria label, server message and user doc must follow.

| Today                                                                            | Becomes                                            |
| -------------------------------------------------------------------------------- | -------------------------------------------------- |
| Organization Lens, Organizational Lens, Org Lens, "Organization" (lens switcher) | **Company Lens**, "Company"                        |
| Organiz. (lens short label)                                                      | Company                                            |
| organization / organisation                                                      | company                                            |
| organizations / organisations                                                    | companies                                          |
| organizational                                                                   | company (adjective), reworded where it reads badly |
| "your organization"                                                              | "your company"                                     |
| Org (as a user-facing abbreviation)                                              | Company                                            |
| "Org Summary", "All Organizations"                                               | Company Summary, All Companies                     |

## No exceptions by entity type

"Company" is the platform's name for the entity, not a description of it. Foundations, universities, non-profits, government bodies and The Linux Foundation itself are all "company". Do not swap in "organization", "entity" or "institution" for some of them.

## Only the visible UI changes

Never rename code to match: identifiers, file names, the `org` lens id, `Org…`/`ORG_…` names, upstream API field names, Snowflake/dbt views, Auth0/FGA names, AI tool names (e.g. `get_org_committee_seats`), test ids and comments all keep their current spelling.

## CI enforcement

`check-company-copy.mjs` (run by the Quality Checks workflow and `yarn check:company-copy`) fails on "organization"/"organisation"/"organizational" or "Org Lens" in user-facing copy: Angular templates, user-facing string values (`title`, `label`, `header`, `placeholder`, `ariaLabel`, `tooltip`, `description`, `message`, ...) in `.ts`, and `docs/user/**`. Existing violations are listed in `check-company-copy.allowlist.txt`; the list only shrinks. Fix copy, then run `node check-company-copy.mjs --update`. For a hit that is genuinely not user-facing, put `company-copy-ignore` on that line or the previous one.
