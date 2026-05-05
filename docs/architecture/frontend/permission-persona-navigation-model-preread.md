# Permission, Persona, and Navigation Model

Meeting preread for aligning how LFX One decides where users can go, what they see, and what they can do.

## Purpose

This preread proposes a clear separation between access, experience, and authority. The goal is to make the product easier to reason about and to keep persona-driven UX from accidentally becoming authorization logic.

## Core Contract

| Decision             | Source of Truth           | Meaning                                                          |
| -------------------- | ------------------------- | ---------------------------------------------------------------- |
| Where can I go?      | View permission           | Foundation/Project selector eligibility.                         |
| What do I see there? | Persona / role            | Sidebar links, page sections, dashboard variants, content shape. |
| What can I do?       | Manage / write permission | Create, edit, delete, configure, invite, assign, administer.     |

## Decision Boundaries

### 1. Context Selector: Where Can I Go?

- Foundation and Project selector eligibility should be based on view permission.
- If a context appears in the selector, the user should be allowed to enter that context.
- Persona may narrow or prioritize the experience, but it should not be the authority for selector eligibility.

### 2. Sidebar and Page Content: What Do I See There?

- Once inside a view-permitted context, persona/role should shape navigation links, page sections, dashboards, tabs, cards, metrics, and content variants.
- This is where Executive Director, Board Member, Maintainer, Contributor, and committee roles can create different product experiences.

### 3. Actions and Routes: What Can I Do?

- Create, edit, delete, configure, invite, assign, permission management, and admin operations should require manage/write permission.
- Buttons should be hidden or disabled, direct routes should be guarded, and backend/downstream authorization should remain authoritative.

## Default Foundation and Project Selection

Defaulting should happen only after the selector candidate list has already been filtered by view permission.

| Step | Foundation Lens                                            | Project Lens                                            |
| ---- | ---------------------------------------------------------- | ------------------------------------------------------- |
| 1    | Keep existing selected foundation if still view-permitted. | Keep existing selected project if still view-permitted. |
| 2    | Choose Executive Director foundation if view-permitted.    | Choose Maintainer project if view-permitted.            |
| 3    | Choose Board Member foundation if view-permitted.          | Choose Contributor project if view-permitted.           |
| 4    | Choose first view-permitted foundation in stable order.    | Choose first view-permitted project in stable order.    |

## Implementation Priority

```text
Priority 1:
Make Foundation/Project selector eligibility explicitly view-permission scoped.

Candidate contexts + view permission check = selector items
```

## Known Follow-Up Areas

- Confirm whether upstream query/resource APIs already enforce view permission; if not, add explicit batch view checks.
- Keep persona/lens logic for sidebar and page composition, but avoid using persona as action authority.
- Guard direct create/edit/admin routes with manage/write permission, not only hidden buttons.
- Gate Permissions page admin actions such as Add User, role update, and removal by manage/write permission.

## Meeting Ask

Can we agree on this contract?

```text
Context selector eligibility -> view permission
Sidebar/page/content visibility -> persona/role
Action authority -> manage/write permission
```
