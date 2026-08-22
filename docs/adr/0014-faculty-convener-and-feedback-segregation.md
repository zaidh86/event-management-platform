# ADR-0014 — Faculty & Convener club roles, participant removal, feedback segregation

Status: accepted (migration 00021)
Supersedes nothing. Extends ADR-0001 (clubs), ADR-0002 (roles), ADR-0005 (RLS), ADR-0009 (feedback).

## Context

Three requests arrived together, and they turned out to share one seam:

1. Organizers need to remove a registered participant from an event.
2. Clubs have teachers. Some merely belong (**Faculty**); one runs the club
   (**Convener**) and needs the same authority a Club Admin has.
3. Feedback should distinguish teacher feedback from participant feedback.

(3) depends on (2), and (1) turned out to already exist in an unsafe form.

## Decision 1 — Faculty and Convener are club_members.role values

`club_members.role` is a text CHECK column. It gains two values:

```
club_admin | convener | faculty | member
```

**Convener is granted authority by rewriting one function.** `is_club_admin()`
is the sole chokepoint for club authority in this schema — `role = 'club_admin'`
appears exactly once in the whole SQL surface (00004:40); all 13 authority sites
(clubs update, club_members insert/update/delete, events insert/select/update/
delete, `protect_event_club`, `can_manage_event`) call the predicate instead of
comparing the column. Widening the predicate body therefore grants convener full
authority everywhere at once, atomically, **without dropping a single policy**.

This is the manoeuvre 00007 used to make `platform_owner` inherit `super_admin`
everywhere by rewriting `is_super_admin()` alone, and 00016's precedent for
widening a role CHECK (`event_members_role_check`, to add `judge`).

**Faculty is granted nothing by being absent from that predicate.** It still
satisfies `is_club_member()`, so a faculty member reads the roster like any
member — which is exactly "associated with the club, no authority over it".

### Alternatives rejected

- **An orthogonal `designation` column** (faculty/convener alongside role).
  Rejected: it is a second role system for the same subject, and the codebase
  would then have two answers to "what is this person to this club". The
  objection it solves — that setting a Club Admin to Faculty demotes them — is
  not a defect but the correct semantics of a single-valued role, identical to
  the existing member↔club_admin selector. The UI now confirms authority-crossing
  changes explicitly rather than hiding them.
- **A new `is_club_manager()` helper** that policies switch to. Rejected: it
  requires dropping and recreating 9 production policies (including 00011's,
  whose bodies carry load-bearing documented subtleties) for zero behavioural
  gain over replacing one function body.
- **Making convener a platform-level role.** Rejected: authority is club-scoped.
- **Letting faculty inherit anything.** Rejected explicitly; this is the whole
  distinction being asked for.

### Not changed

`clubs_insert` and `clubs_delete` remain `is_super_admin()`. A club_admin cannot
create or delete clubs today, so "the same authority as club_admin" means a
convener cannot either.

## Decision 2 — Participant removal is a guarded RPC, and the raw path closes

A raw `DELETE` on `participants` was **already permitted** for organizers
(00001:709 policy + 00003:22 grant) and is unsafe: `accounts.owner_id` is a soft
polymorphic link with no FK, so deleting a participant strands their account,
keeps the transaction ledger alive beneath an ownerless account, and makes
`get_leaderboard`'s LEFT JOIN emit a null-name ghost row.

`remove_event_participant(participant_id, reason, force)` replaces it:
authorized by `can_manage_event`, it records an audit row, deletes the
registration-created `event_members` row **only when its role is
`'participant'`** (an organizer who also registered keeps organizer standing),
deletes the participant, and deletes their **personal** account — never a team's.

Refusals, chosen for what each one destroys:

| State | Behaviour | Why |
|---|---|---|
| Submissions | **absolute refusal** | cascades the entry *and* every judge's evaluation of it |
| Certificates | refusal, overridable | cascade; issued verify codes stop resolving |
| Ledger activity | refusal, overridable | deleting the account cascades its transactions |
| Attendance | never blocks | a check-in for an event they left is meaningless |

The automatic `starting_balance` transaction is **not** counted as ledger
activity: every solo registrant in a points event has one, so counting it would
fire the override on every removal and train organizers to click through it.

Overriding requires `force` **and** a non-empty reason; both are recorded.
An emptied team is *reported*, never auto-deleted.

The raw path is then closed (`drop policy participants_delete`, `revoke delete`)
— the only existing policy 00021 removes. Without it the RPC is advisory. This
mirrors 00012:304-305, which revoked table-wide UPDATE on this same table. No
authority is reduced: the same people remove the same participants, through a
path that cleans up after itself.

## Decision 3 — Feedback carries a stored respondent category

`feedback_responses.respondent_category` ∈ `faculty | regular | anonymous`,
**nullable with no default**, stamped by a `BEFORE INSERT` trigger from the
respondent's role in the **event's own club**.

**Stored, not derived at read time.** `club_members_select` only returns rows to
members of that club, so an organizer who is not a club member would read zero
rows and silently classify *everyone* as regular — a systematic misclassification
with no error. Storing also freezes the fact at submission time, which is what
"who gave this feedback" actually means; deriving it would let a later promotion
retroactively rewrite history.

**Historical rows stay NULL.** A NULL says "recorded before segregation existed".
Backfilling `'regular'` would assert something about faculty feedback that nobody
ever measured, and the false rows would be indistinguishable from true ones.

**A trigger, not an edit to `submit_feedback`.** The trigger covers every insert
path including service_role imports, and needs no signature change — so no
`DROP FUNCTION`, no re-issued grants, and no PostgREST overload ambiguity
(PGRST203), which 00019 warns is a live hazard on this exact function. It
overwrites unconditionally, so a category cannot be self-declared.

It reads `club_members` **directly** and deliberately does not call
`is_club_admin()`: that predicate ORs `is_super_admin()` first, which would brand
every platform admin as faculty of every club.

`anonymous` is a third value, not a synonym for regular — an unattributable
respondent may well have been faculty, and the data should not pretend otherwise.
The organizer UI therefore filters **All / Faculty / Regular / Other**, with
counts, so the buckets sum to the total.

### Privacy

Unchanged. The response table shows `Signed-in` / `Anonymous` and now a Faculty
badge; it still never shows a name or email. Organizers could already read
`respondent_id` — `feedback_responses_select` grants them the whole row and the
client already fetches `select('*')` — so the category label widens no access.
Anonymous responses carry no club lookup at all.

## Consequences

- Adding a club role now requires updating `CLUB_ROLE_LABELS`, typed
  `Record<ClubRole, string>` so omitting one is a **compile error**.
- Frontend club-authority checks route through `isClubAuthority()`, the mirror of
  `is_club_admin()`. It is a UI convenience; the database re-decides everything.
- Removing a participant destroys their certificates and personal ledger. The
  `participant_removals` audit table is the only remaining record.
- A category is a snapshot: designate faculty **before** opening a form, or their
  earlier responses stay `regular`.
- Faculty of a *different* club responding to this event counts as regular.

## Known gaps, deliberately not addressed here

- **No last-authority guard.** A club admin can already demote the last admin;
   00021 does not change this either way. Pre-existing, out of scope.
- **`club_members_update` has `USING` but no `WITH CHECK`.** A club admin may
  therefore edit their own row. Pre-existing (00004:60); faculty and members
  cannot update any row, so no new escalation path is introduced.

## Rollback

Migration 00021 carries a rollback block. Reverting §1 requires every member to
hold `club_admin` or `member` first — otherwise the narrowed CHECK fails
validation. Reverting §2 restores the policy and grant verbatim. Reverting §3
drops the trigger, function and column; no data outside that column is touched.

## Verification

`tests/rls/00021_matrix.sql` — 12 cases run in the SQL editor, proving faculty
has no authority (1-4), convener has full authority (5-7), removal is
event-scoped and server-authorized (8-10), and the category is stamped
server-side rather than client-declared (11-12).
