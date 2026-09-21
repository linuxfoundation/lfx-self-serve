<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Mentorship — BFF Consumer Brief

**Audience:** another project's agent or BFF that calls Mentorship over HTTP.  
**Do not query Postgres.** This service owns the `mentorship` schema.

JSON keys are **snake_case**. Nested JSONB blobs below use **camelCase** (legacy). IDs are UUID strings.

Schema source of truth: [`backend/db/migrations/001_initial.up.sql`](../backend/db/migrations/001_initial.up.sql).  
JSON field names: `json` tags in [`backend/internal/domain/models/`](../backend/internal/domain/models/).  
Endpoint details (if needed): [`backend/docs/api.md`](../backend/docs/api.md).

If a field is not in this brief **and** not in those sources, it is not available. Do not invent column or JSON names.

---

## 1. Decision procedure

1. Is the concept one of the ten tables below? If no → **not possible** (or out of scope).
2. Use the JSON name in this document (`logo_url`, not `logoUrl`).
3. Honor enum values exactly. Invalid enums return `400`.
4. Honor state machines. Illegal transitions return `409`.

---

## 2. Database

PostgreSQL, schema `mentorship`, on the shared LFX v2 RDS.

```
users
  └── user_profiles                 (1:many; profile_type = mentor | mentee)

programs
  ├── program_skills                (many:1)
  ├── program_funding_stats         (1:1 cache of Crowdfunding)
  ├── program_terms                 (1:many; max 4 with status=open)
  │     └── applications            (1:many; unique (term, user, role))
  │           └── tasks             (1:many)
  └── program_members               (1:many; program_admin | mentor only)
```

Mentees are **not** `program_members`. Enrollment is an `applications` row with `role = mentee`.  
There is **no** enrollments table, **no** per-mentee mentor assignment, **no** invitation_tokens table (invite tokens are HMAC, not rows).

`created_on` / `updated_on` are trigger-maintained. Callers never write `updated_on`.

---

## 3. Naming and vocabulary

| Do not send / display | Use instead |
| --- | --- |
| `maintainer` | `program_admin` (`member_type`) / "Program Admin" in copy |
| `apprentice` | `mentee` |
| `rejected` on an application or member | `declined` |
| `active` as a stored application status | `accepted` (enrolled). Directory filter `status=active` *selects* accepted rows; responses still return `accepted`. |
| camelCase keys (`firstName`, `programId`) | `first_name`, `program_id` |

`rejected` is **only** a `programs.status` value (moderation).

**JSONB exception — camelCase keys inside these blobs:**

| Parent JSON field | Nested keys (as stored) |
| --- | --- |
| `address` | `country`, `city`, `address1`, `zipCode` |
| `demographics` | `gender`, `race`, `age` |
| `socioeconomics` | `income`, `educationLevel` |
| `skill_set` | `skills[]`, `improvementSkills[]`, `comments` |
| `profile_links` | `resumeLink`, `linkedinProfileLink`, `githubProfileLink` |
| `task_templates[]` | `name`, `description`, `submitFile`, `dueDate` |

Public directory payloads flatten GitHub/LinkedIn to `github_url` / `linkedin_url`. Do not expect `profile_links` there.

---

## 4. Entities and JSON attributes

Optional fields are omitted when null (`omitempty`). Always send/read the names below.

### users

| JSON | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Caller-supplied on create (SSO user id) |
| `email` | string? | unique |
| `lfid` | string? | LF username, unique |
| `name` | string? | |
| `given_name` | string? | |
| `family_name` | string? | |
| `avatar_url` | string? | |
| `created_on` | timestamptz | |
| `updated_on` | timestamptz | |

### user_profiles

| JSON | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Caller-supplied on create |
| `user_id` | uuid | |
| `profile_type` | `mentor` \| `mentee` | |
| `slug` | string? | unique |
| `first_name` | string? | |
| `last_name` | string? | |
| `email` | string? | |
| `phone` | string? | |
| `logo_url` | string? | |
| `introduction` | string? | |
| `terms_and_conditions` | bool | |
| `number_of_projects` | int | |
| `address` | object? | see JSONB table |
| `demographics` | object? | |
| `socioeconomics` | object? | |
| `skill_set` | object? | `skills` drives directory skill filters |
| `profile_links` | object? | |
| `created_on` / `updated_on` | timestamptz | |

Create-only (not stored, not returned): `age_eligible`, `work_eligible` — mentee create requires both `true` or the API returns `422`.

### programs

| JSON | Type | Notes |
| --- | --- | --- |
| `id` | uuid | |
| `name` | string | required on create |
| `slug` | string | unique; program reads also accept slug |
| `status` | enum | `draft` \| `submitted` \| `published` \| `rejected` \| `archived` \| `hidden` |
| `is_paid` | bool | stipend paid to mentees |
| `description` | string? | required to submit |
| `logo_url` | string? | required to submit |
| `website_url` | string? | |
| `repo_link` | string? | required to submit |
| `code_of_conduct` | string? | |
| `industry` | string? | raw comma-separated tags; prefer `program_skills` |
| `color` | string? | |
| `lfid` | string? | **owner LF username**, not an LF project id |
| `cii_project_id` | string? | |
| `accept_applications` | bool | denormalised |
| `terms_and_conditions` | bool | |
| `program_term_status` | `open` \| `closed`? | denormalised summary |
| `discover_sort_rank` | int | |
| `amount_raised` | number | denormalised; live cache is `program_funding_stats` |
| `mentee_needs` | object? | opaque JSONB |
| `task_templates` | array? | cloned onto new applications as prerequisite tasks |
| `created_on` / `updated_on` | timestamptz | |

**Not in the schema today:** `project_uid`, `cf_initiative_id`. Architecture docs mention them; do not send them.

### program_skills

`id`, `program_id`, `skill`, `created_on`, `updated_on`. Create body: `{ "skill": "Go" }`.

### program_funding_stats

`id`, `program_id`, `amount_raised`, `amount_spent`, `created_on`, `updated_on`.  
Platform aggregate of the same two amount fields is also available.

### program_terms

| JSON | Type | Notes |
| --- | --- | --- |
| `id` | uuid | |
| `program_id` | uuid | |
| `name` | string | |
| `status` | `open` \| `closed` \| `deleted` | delete is a soft-delete to `deleted` |
| `active_users` | int | denormalised |
| `start_date_time` | timestamptz? | term start |
| `end_date_time` | timestamptz? | term end |
| `application_start_date` | timestamptz? | apply window open |
| `application_end_date` | timestamptz? | apply window close |
| `discovery_label` | string | **computed on term reads**, not stored: `Coming Soon` \| `Apply Now` \| `In Progress` \| `Completed` |
| `created_on` / `updated_on` | timestamptz | |

### program_members

| JSON | Type | Notes |
| --- | --- | --- |
| `id` | uuid | |
| `program_id` | uuid | |
| `user_id` | uuid | |
| `member_type` | `program_admin` \| `mentor` | mentees do not appear here |
| `status` | enum? | `invited` \| `requested` \| `pending` \| `active` \| `declined` \| `withdrawn` |
| `email` | string? | redacted on the public roster |
| `created_on` / `updated_on` | timestamptz | |

Public roster is pinned to `status = active`. Removing a member sets `withdrawn` (no hard delete).

### applications

| JSON | Type | Notes |
| --- | --- | --- |
| `id` | uuid | |
| `program_term_id` | uuid | |
| `user_id` | uuid | |
| `role` | `mentor` \| `mentee` | |
| `status` | enum | `pending` \| `accepted` \| `declined` \| `withdrawn` \| `graduated` \| `hold` |
| `program_term_status` | `open` \| `closed`? | denormalised |
| `start_date_time` / `end_date_time` | timestamptz? | |
| `attendance_type` | `full_time` \| `part_time`? | **required** when transitioning to `accepted` |
| `tasks_submitted` | bool | set by the service when all prerequisite tasks are `submitted` or `complete` |
| `admin_notified` | bool | |
| `created_on` / `updated_on` | timestamptz | |

Create body is `{ "user_id", "role" }` only. Status is always assigned `pending`; a client `status` on create is ignored.

Withdrawing sets `status = withdrawn`; it does not remove the row.

### tasks

| JSON | Type | Notes |
| --- | --- | --- |
| `id` | uuid | |
| `application_id` | uuid? | |
| `program_term_id` | uuid? | denormalised |
| `assignee_id` | uuid | |
| `owner_id` | uuid? | |
| `name` / `description` | string? | |
| `category` | `prerequisite` \| `non_prerequisite`? | |
| `status` | `incomplete` \| `in_progress` \| `complete` \| `submitted` | |
| `application_status` | application status? | denormalised |
| `program_term_status` | term status? | denormalised |
| `custom` | bool | |
| `submit_file` | string? | `null` \| `"required"` \| URL |
| `file` | string? | uploaded file URL |
| `due_date` | `YYYY-MM-DD`? | date only |
| `created_by` | string? | creator LFID |
| `created_on` / `updated_on` | timestamptz | |

Task completion never changes application status.

### Public directory / catalog shapes (computed, not tables)

**Program catalog item** = program + `skills: string[]` + `terms[]` (with `discovery_label`) + `mentors[]`.

**Catalog mentor:** `id`, `user_id`, `name`, `avatar_url`, `introduction`.

**Catalog / program mentee:** `user_id`, `name`, `avatar_url`, `introduction`, `status` (`accepted` \| `graduated`), `term_id`, `term_name`.

**Mentee directory item:** `user_id`, `name`, `avatar_url`, `introduction`, `skills[]`, `status`, `joined_at`, `program` `{id,name,slug,logo_url}`, `mentors[]`.  
Detail adds `github_url`, `linkedin_url`, `programs[]`. Directory `{id}` is **user_id**, not profile id.

**Mentor directory item:** `user_id`, `name`, `avatar_url`, `introduction`, `skills[]`, `joined_at`.  
Detail adds `github_url`, `linkedin_url`, `stats` `{programs_mentoring, current_mentees, mentees_graduated}`, `programs[]`, `current_mentees[]`, `graduated_mentees[]`.

**Platform summary:** `program_count`, `accepting_program_count`, `mentor_count`, `graduated_mentee_count`, `stipends_paid`, `graduated_mentee_users[]` `{name, avatar_url}`.

**Transactions** (proxied from Crowdfunding, not Mentorship tables): `id`, `type`, `amount_cents`, `date`, `category`, `recurring`, `initiative_name`, `donor_name`, `donor_type`, `donor_logo_url`, `donor_username`. Grouped as `individual_transactions`, `organization_transactions`, plus `total_count`, `limit`, `offset`.

**Sponsors:** `id`, `name`, `logo_url`, `amount_cents`.

List responses use `{ "data": [...], "meta": { "total", "limit", "offset" } }`. Errors use `{ "error": "<message>" }`.

---

## 5. Possible vs not possible

### Possible

- Discover published programs, terms, skills, public mentor/mentee directories, landing summary, funding cache, sponsors/transactions.
- Create a draft program; add skills and terms; submit (`status: submitted`); hide/archive within guards.
- Invite or self-request mentors; accept/decline via invite token; withdraw a member.
- Create mentee/mentor profiles (eligibility flags on mentee create).
- Apply to an **open** term **inside** the application window.
- Review applications: accept (with `attendance_type`), decline, hold, graduate, bulk-decline pending, CSV export.
- Applicant self-withdraw (`pending` → `withdrawn`).
- Clone of `task_templates` onto a new application as prerequisite tasks.
- Mentee starts/submits tasks; reviewer completes or resets; `tasks_submitted` flips automatically.

### Not possible — do not build UI as if they exist

| Need | Why |
| --- | --- |
| Query Postgres / another schema | Mentorship owns the data. HTTP only. |
| Elasticsearch / arbitrary full-text | Out of scope. Filters are name/skill/status only. |
| Employer portal | Out of scope. |
| Send email from the BFF via Mentorship | Notifications go through `lfx-v2-email-service`. No mail API for callers. |
| `project_uid`, LF project/foundation on a program | Not a column yet. `lfid` is the **owner username**. |
| `cf_initiative_id` | Not stored. Funding is a cached proxy. |
| Mentee as `program_members` row | Wrong table. Use `applications`. |
| Assign a specific mentor to a specific mentee | No such relation. Mentors belong to the **program**. |
| Application status `active` | Stored value is `accepted`. |
| Application or member status `rejected` | Use `declined`. `rejected` is program-only. |
| Hard-delete an application or member | Both are status changes (`withdrawn`). |
| Set application `status` on create | Always `pending`. |
| Apply outside the window / to a closed term | `422`. |
| Re-apply after `declined` | Blocked. `withdrawn` may re-apply while the window is open. |
| Accept without `attendance_type` | `409` / validation. |
| More than 4 `open` terms | `409`. |
| Close a term that still has `accepted` applications | `409`. |
| Hide a program with pending/accepted/graduated applications | `409`. |
| Submit a program without `lfid`, `description`, `repo_link`, `logo_url`, ≥1 skill, ≥1 open term | `409`. |
| Second active mentee profile | `422`. |
| WebSocket / SSE / push | Not supported. |
| Mentorship-owned file upload | Task `file` is a URL string. Uploads go to S3; this API stores the URL. |
| Directory email / phone / demographics | Public mentee/mentor payloads omit PII. |

---

## 6. State machines

**Program:** `draft → submitted → published | rejected`. From `published`: `hidden` or `archived`. `rejected → submitted`. `hidden → published | archived`.

**Term:** `open ↔ closed`; `open | closed → deleted` (soft).

**Application:** `pending → accepted | declined | withdrawn | hold`. `accepted → graduated | declined`. `hold → accepted | declined | pending`. `declined → pending` (admin reopen). Graduation is never automatic.

**Member:** invite → `invited` → `active` \| `declined`. Self-request → `requested` → `active` \| `declined`. Remove → `withdrawn`.

**Task:** assignee: `incomplete → in_progress → submitted`. Reviewer: `submitted → complete`, or any → `incomplete`. `incomplete → complete` is invalid (`409`).
