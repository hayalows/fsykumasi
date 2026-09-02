# Registration operations and future committee modules

Date: 2026-09-02
Status: Day-of people capture in development; committee modules are planned architecture

## Purpose

The registration desk needs to move people through a crowded arrival flow without asking operators to edit spreadsheets. The most useful local operations are: find the person, confirm they are expected, confirm their counselor group/company, record arrival, and send genuine exceptions to a smaller resolution workflow.

The official Church registration system remains the authority for the original registration, approval, agreements and consent. FSY Operations remains the local operational layer for imported approved data, arrival, assignments, head count and other conference-day state.

## Day-of youth capture

The rule is **search before create**. If the youth is not in the imported list, an authorized operator may create an on-site record.

Required operational fields:

- first and last name
- sex, because counselor groups remain same sex
- date of birth
- ward or branch
- at least one reachable phone: participant or parent/guardian

Age is calculated from date of birth against the session start date. It is displayed as a derived value and is not independently typed. This prevents inconsistent age/DOB combinations and avoids timezone shifts by treating DOB as a date-only value.

Ward/branch and stake/district entry uses values already observed in the current session data as suggestions. Selecting an exact known ward/branch may fill the corresponding stake/district. The operator can still type a new value when the unit is genuinely absent.

Optional conference-support fields include T-shirt size, dietary information and medical/wellness information. These are progressively disclosed and stored in restricted private-detail tables rather than the broad people directory.

The youth workflow is:

**Search → Add pending record → Verify → Assign counselor group/company → Check in**

Adding someone never silently checks them in.

## Day-of staff capture

Staff can also arrive without being in the imported export. They use the same search-first approach but a separate staff form.

A staff record requires identity, DOB-derived age, sex, ward/branch, at least one contact method, and an operational staff type. The first supported on-site types are Counselor, Assistant Coordinator, Committee member and Other staff. Creating an on-site staff record does not create a login account; account access remains a separate explicit invite process.

This distinction is intentional: **being a staff record is not the same thing as having system access**.

## Registration committee access

Do not solve registration-team access by making `committee_viewer` broadly powerful.

The intended model is role + scope/capability. A future registration scope should allow only the operations needed at the registration desk, such as:

- whole-session operational person search
- see registration eligibility and group/company assignment
- see check-in state
- add a missing youth or staff member on site
- verify a day-of youth record if leadership delegates that responsibility
- assign an eligible youth to a compatible counselor group
- record check-in
- see staffing-readiness exceptions relevant to registration

It should not automatically grant:

- access-management powers
- unrestricted private medical data
- full session configuration
- unrestricted structure rebuild/publish
- automatic authority to replace the master CSV snapshot

Before delegating staff assignment, the application should separate `manage staffing` from `rebuild/publish structure` at the database capability level. This avoids giving a registration operator more structural power than the task requires.

## Rooms / Housing module

Housing should become its own session-scoped module rather than extra free-text fields on people.

Suggested core records:

- `rooms` — venue/building/room identifiers and capacity
- `room_assignments` — person, room, effective state, assigned by, timestamp
- `room_assignment_events` — append-only move/correction history

The housing team should be able to search a person, see the operational identity and company/group needed to confirm them, assign or move a room, and see current occupancy. Changes should retain history rather than silently overwrite the previous room.

A room assignment is different from a live location observation. If the session later needs temporary-location tracking, use a narrowly defined event model rather than treating the assigned room as a surveillance field.

## Wellness module

Wellness also deserves a dedicated, restricted workflow.

Leadership commonly needs only an actionable status such as **At wellness** rather than a medical narrative. A future module can use minimal states such as:

- checked in to wellness
- receiving support
- returned to activity
- referred/escalated through the approved process

Sensitive notes, where authorized and genuinely necessary, must have stricter RLS than ordinary participant visibility. A counselor or registration operator should not receive broad health history just because they can search a participant.

Serious incidents and required formal reports remain in the approved Church/Global incident process. FSY Operations can record the operational fact needed to account for the person without becoming the authoritative serious-incident reporting system.

## Reusable product direction

Registration, Housing and Wellness should be modules attached to a session, not Kumasi-specific screens tied to one event. Permissions should be capabilities/scopes attached to a user's session access. This supports future FSY sessions using the same application with different people, dates, venues and committee assignments.

## Engineering rules

1. Keep raw imported data and conference-day operational events distinct.
2. Never let a later CSV silently erase an on-site record, assignment, room move or check-in.
3. Keep sensitive contact/health data outside broadly readable tables.
4. Store who changed important operational state and when.
5. Prefer a fast normal path and a separate exception path.
6. Give committee users the narrowest capability that completes their assignment.
7. Continue development-first migration and test discipline before production changes.
