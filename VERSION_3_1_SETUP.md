# KCJ Admin Portal — Version 3.1 Setup Guide

Version 3.1 adds secure individual administrator login, a permanent
approval audit trail, and a per-administrator "till date" effort
summary on top of Version 3.0's Airtable-behind-Apps-Script
architecture. Nothing about Version 3.0's Dashboard, Duplicate Engine,
Approval Assistant, Invoice Viewer, Reports, or Excel downloads
changed.

```
Browser                          Google Apps Script (Web App)
  │  fetch() + Web App URL only     │  Airtable PAT + all Base IDs live here
  │  + opaque session token           │  Passwords verified here (never in browser)
  ▼                                  ▼
                                    Airtable
                                      ├─ Claims base
                                      ├─ Coupons Generated base
                                      └─ Admin/Audit base (NEW) — AdminUsers, ApprovalLog
```

---

## 1. New Admin/Audit Airtable base configuration

Both new tables live in the **same** Airtable base:

| | Base ID | Table Name | View Name |
|---|---|---|---|
| AdminUsers | `appQ8s1dFUSygcUF3` | `AdminUsers` | `Grid view` |
| ApprovalLog | `appQ8s1dFUSygcUF3` | `ApprovalLog` | `Grid view` |

This base must be accessible with the **same Airtable PAT** already used for Claims/Coupons Generated — make sure that token's access scope includes this base too, or login will fail with an Airtable permission error the moment it tries to read AdminUsers.

## 2. AdminUsers table structure

| Field | Type | Notes |
|---|---|---|
| `USERNAME` | Single line text | Case-sensitive exact match on login |
| `ADMIN_NAME` | Single line text | Displayed in the topbar and stored on every ApprovalLog row |
| `ADMIN_EMAIL` | Single line text | Stored on every ApprovalLog row and every Claims/Coupons Generated `HO_EMAIL` this admin writes |
| `PASSWORD_HASH` | Single line text | `"<saltHex>$<sha256Hex>"` — see §4 below. **Never** store a plaintext password here |
| `ROLE` | Single select | `Admin`, `Super Admin`, or `Viewer` |
| `ACTIVE` | Checkbox (or text/number `true`/`1`) | Unchecked/false/missing = cannot log in |
| `CREATED_DATE` | Date | Informational only, not touched by the app |
| `LAST_LOGIN` | Date | Written by Apps Script on every successful login |
| `LOGIN_COUNT` | Number | Incremented by Apps Script on every successful login |

> Your exported CSV also shows an empty `NewTable` column. That's an unused Airtable artifact, not a real field — the backend never reads or writes it. Delete it if you'd like, or leave it; either is fine.

## 3. ApprovalLog table structure

One record is created per completed approve/reject decision — append-only, no edit/delete path exists anywhere in the portal.

| Field | Written by | Notes |
|---|---|---|
| `LOG_ID` | Airtable (assumed Autonumber) | **Assumption, please confirm** — never sent by the backend, matching the `AUTO_NO`/`CERT_NO` pattern used elsewhere. If this isn't an Autonumber field, the create will simply leave it blank; tell me and I'll adjust. |
| `CLAIM_RECORD_ID` | Browser (approval.js) | The Claims record's Airtable id |
| `TXN_ID` | Browser (approval.js) | **Currently always blank** — there's no field named `TXN_ID` anywhere in the existing Claims schema (`CLAIMS_COLUMN_ORDER` in `config.js`). Tell me which Claims field this should come from and I'll wire it up. |
| `CUSTOMER_NAME`, `DSA_NAME`, `DSA_HQ`, `ASM_HQ`, `RSM_HQ` | Browser (approval.js) | Copied from the Claims record already in memory |
| `DECISION` | Browser | `Approved` or `Rejected` |
| `ADMIN_NAME`, `ADMIN_EMAIL` | **Apps Script, from the session** | Never trusted from the browser, even if sent |
| `DECISION_DATE`, `DECISION_TIME` | **Apps Script, server clock** | Never trusted from the browser |
| `ORIGINAL_COUPONS` | Browser | The DSA's original `NUMBER_OF_COUPONS` |
| `APPROVED_COUPONS` | Browser | HO's final approved count (`0` on reject) |
| `COUPON_RECORDS_CREATED` | Browser | Actual rows successfully created (`0` on reject) |
| `REJECT_REASON`, `HO_REMARKS` | Browser | Reject-only |
| `SKU_EDITED`, `COUPON_COUNT_EDITED` | Browser | Computed by comparing HO's final values against the original claim |
| `STATUS` | Apps Script | Always `Completed` — this action is only ever called after approval.js's own approve/reject sequence has already succeeded (see §12, Option A) |
| `ERROR_MESSAGE` | Apps Script | Always blank under the current design |
| `SESSION_ID` | Apps Script | The session token, for audit correlation |

## 4. How to create a password hash

Apps Script has no built-in bcrypt, so `PASSWORD_HASH` is a single self-contained string: `saltHex$sha256Hex`, where `sha256Hex = SHA-256(saltHex + plaintextPassword)`.

1. Open the Apps Script project → `AdminUsers.gs`.
2. Find `generateAdminPasswordHash_()` and edit the line `const plaintextPassword = 'CHANGE_ME';` to the real password.
3. Select **generateAdminPasswordHash_** in the function dropdown at the top → **Run**.
4. Open **View → Logs** (or **Executions**) and copy the logged hash string.
5. Paste that string into the administrator's `PASSWORD_HASH` cell in Airtable.
6. **Revert step 2** back to `'CHANGE_ME'` so no real password is left sitting in the script source.

The plaintext password is never logged — only the final hash string is.

## 5. How to add an administrator

1. Add a new row in `AdminUsers`: `USERNAME`, `ADMIN_NAME`, `ADMIN_EMAIL`, `ROLE` (`Admin`, `Super Admin`, or `Viewer`), `ACTIVE` = checked.
2. Generate their `PASSWORD_HASH` per §4 and paste it in.
3. Leave `CREATED_DATE`/`LAST_LOGIN`/`LOGIN_COUNT` — the app manages the latter two automatically from here on.

## 6. How to disable an administrator

Uncheck `ACTIVE` on their `AdminUsers` row. Their next login attempt (or next authenticated request, once their current session's 30-minute window expires) gets: *"Your account is inactive. Please contact the administrator."* Existing `ApprovalLog` history for them is untouched.

## 7. How to change a password

Generate a new hash per §4 and overwrite the `PASSWORD_HASH` cell. No separate "change password" flow exists in the portal itself for this version.

## 8. Apps Script Script Properties

**Project Settings → Script Properties**, all ten:

| Property | Value |
|---|---|
| `AIRTABLE_TOKEN` | *(leave as a placeholder for now — you'll add the real PAT later)* |
| `CLAIMS_BASE_ID` | your real Claims base id |
| `CLAIMS_TABLE` | your real Claims table name |
| `CLAIMS_VIEW` | your real Claims view name |
| `GENERATED_BASE_ID` | your real Coupons Generated base id |
| `GENERATED_TABLE` | your real Coupons Generated table name |
| `GENERATED_VIEW` | your real Coupons Generated view name |
| `ADMIN_BASE_ID` | `appQ8s1dFUSygcUF3` |
| `ADMIN_USERS_TABLE` | `AdminUsers` |
| `APPROVAL_LOG_TABLE` | `ApprovalLog` |

Optional (safe to leave unset — `airtableFetchAll_` fetches without a view filter if blank):

| Property | Value |
|---|---|
| `ADMIN_USERS_VIEW` | `Grid view` |
| `APPROVAL_LOG_VIEW` | `Grid view` |

## 9. Apps Script deployment

Same as Version 3.0 — add the three new files (`Auth.gs`, `AdminUsers.gs`, `ApprovalLog.gs`) and paste the updated contents into `Code.gs`, `Config.gs`, `Utils.gs`, `Approval.gs`. `Claims.gs`, `Coupons.gs`, and `Reports.gs` are unchanged from Version 3.0 — no need to touch them.

If this is a code change to an **already-deployed** Web App: **Deploy → Manage deployments → (pencil icon) → Version: New version → Deploy**. This keeps the same URL, so `config.js`'s `GAS_WEBAPP_URL` doesn't need to change.

## 10. Web App deployment settings

Unchanged from Version 3.0 — Execute as: *Me*, Who has access: *Anyone*. Sessions (not Google identity) are what authenticate individual administrators now.

## 11. Frontend configuration

`config.js` no longer has a `USERS` array — there is nothing to configure for login on the frontend at all. `GAS_WEBAPP_URL` stays exactly as it was for Version 3.0.

## 12. Session behavior

- A session token is issued by the `login` action and stored client-side only in `sessionStorage` (not `localStorage`) — cleared on logout, tab close, or expiry.
- Server-side, sessions live in `CacheService` with a 30-minute TTL, refreshed on every authenticated request.
- Any authenticated call made with a missing/expired token gets `{success:false, authenticated:false, message}`; `api.js` catches that shape centrally and hands off to `auth.js`, which clears the session and shows the login screen with a toast — no page you're on needs to check for this itself.
- **Design note (the "Option A" you confirmed):** approve/reject is still driven by the browser's existing step-by-step sequence (update Claims → generate coupons one at a time → read back `CERT_NO`), exactly as in Version 3.0. A new `logApprovalDecision` action is called once, as the very last step, only after that whole sequence has already succeeded — rather than Apps Script owning the entire sequence as one atomic server-side action. This kept `approval.js`'s working control flow intact instead of rewriting it; the trade-off is that `STATUS`/`ERROR_MESSAGE` in `ApprovalLog` don't currently represent partial mid-sequence failures (since logging only ever happens after success) — flag if you'd rather have the fully server-orchestrated version instead.

## 13. ApprovalLog behavior

Written once per completed decision, from `approval.js`, after the decision has already been saved to Airtable. Never edited or deleted through the portal. See §3 for the two flagged field-mapping assumptions (`LOG_ID`, `TXN_ID`).

## 14. HO_EMAIL behavior

`Approval.gs`'s `approvalUpdateClaim_()` and `approvalCreateGeneratedCoupon_()` **always overwrite** `HO_EMAIL` with the authenticated session's `ADMIN_EMAIL`, regardless of what (if anything) the browser sent — the frontend never controls this value.

## 15. Login effort summary behavior

`getAdminEffortSummary` reads `ApprovalLog`, filters to the *authenticated* session's `ADMIN_EMAIL` (never a browser-supplied email) and `STATUS = 'Completed'`, and returns four cumulative numbers: total resolved, approved, rejected, coupons generated. No percentage, ranking, or date segmentation — exactly per spec.

## 16. Testing procedure

Use the checklist from the original request in full:

- **Login:** valid creds, invalid creds, inactive user, wrong password, empty username, empty password.
- **Session:** valid session, expired session (wait 30 min or shorten `SESSION_TTL_SECONDS_` temporarily to test faster), logout, refresh, new tab.
- **Authorization:** log in as a `Viewer` and confirm the Approve/Reject buttons' underlying calls (`updateClaim`/`createGeneratedCoupon`) are rejected server-side even if attempted; confirm an invalid/missing session can't reach any gated action.
- **Approval:** plain approve, approve with edited coupon count, approve with edited SKU quantities, approve with no edits, multi-coupon generation, confirm `CERT_NO` is never sent and is read back correctly, confirm `HO_EMAIL` on the generated rows matches the logged-in admin, confirm the original Claims quantities are untouched.
- **Rejection:** reason only, reason + remarks, confirm `COUPONS_PART` format, confirm `HO_EMAIL`, confirm the `ApprovalLog` row.
- **ApprovalLog:** one row per completed decision, correct admin identity, correct claim id, correct decision, correct date/time, correct coupon counts, correct edited flags, `STATUS = Completed`.
- **Login snapshot:** correct counts, only the logged-in admin's own records, cumulative till-date, no rate/ranking/date segmentation, OK button works, and works gracefully if the summary call fails.

## 17. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Invalid username or password" even with correct credentials | `PASSWORD_HASH` wasn't generated with the current `generateAdminPasswordHash_()`, or has a typo | Regenerate per §4 and re-paste |
| "Your account is inactive..." | `ACTIVE` unchecked/false/blank | Check the box in Airtable |
| Login succeeds but effort snapshot shows all zeros for someone with history | `ADMIN_EMAIL` on their `AdminUsers` row doesn't exactly match the `ADMIN_EMAIL` values already sitting in their old `ApprovalLog` rows | Make sure the two match exactly (case-sensitive) |
| Everything works, then suddenly "Your session has expired" mid-task | Normal — 30 minutes of inactivity | Log in again; consider raising `SESSION_TTL_SECONDS_` in `Auth.gs` if 30 minutes is too short for your reviewers |
| Approve/Reject silently fails only for one admin | Their `ROLE` isn't exactly `Admin` or `Super Admin` (case-sensitive, e.g. stray whitespace) | Check the `ROLE` cell |
| `TXN_ID` / `LOG_ID` look wrong or blank | See the flagged assumptions in §3 | Confirm the correct mapping and I'll update `ApprovalLog.gs` / `approval.js` |
