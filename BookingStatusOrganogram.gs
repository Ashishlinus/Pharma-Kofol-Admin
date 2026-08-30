/* =====================================================================
   BOOKINGSTATUSORGANOGRAM.GS  (new, isolated file -- Booking Status
   Organogram Wise feature)

   Strictly read-only. Never creates, updates, or deletes any Airtable
   record, and never touches Claims/Coupons Generated/AdminUsers/
   ApprovalLog logic -- it only calls the existing getClaims_() and
   getGeneratedCoupons_() (Claims.gs / Coupons.gs, unmodified) plus one
   new read of the Master/Login ("RegisterUser") base, and returns one
   aggregated array. All Excel building and formatting happens in the
   browser (booking-status-organogram.js) -- this file never touches
   spreadsheets.

   ---- Hierarchy model ---------------------------------------------
   Every row in all three source tables (Master/Login, Claims, Coupons
   Generated) carries the same shape: a DESIGNATION ('DSA'/'ASM'/'RSM')
   plus DSA_NAME/DSA_HQ, ASM_NAME/ASM_HQ, RSM_NAME/RSM_HQ. Which of
   those three name/HQ pairs is a Master/Login row's own identity
   depends on its own DESIGNATION:
     DESIGNATION='DSA' -> identity is (DSA_NAME, DSA_HQ)
     DESIGNATION='ASM' -> identity is (ASM_NAME, ASM_HQ)
     DESIGNATION='RSM' -> identity is (RSM_NAME, RSM_HQ)
   deriveIdentity_() below is the single place this branch happens.

   ---- Report-building strategy --------------------------------------
   1. The Master/Login table (one row per HQ+Designation slot) is the
      STRUCTURAL skeleton. Every slot's ZONE/RSM_HQ/ASM_HQ/HQ/
      DESIGNATION comes from here, in this table's own row order, so
      the output always matches the template's hierarchy exactly --
      historical records never relocate a slot to a different
      zone/RSM/ASM even if an old record happens to disagree.
   2. Each slot is seeded with its CURRENT name from Master/Login (even
      a "VACANT-..." name -- that is a real name here, not an empty
      slot).
   3. Coupons Generated / Claims records add historical names +
      Coupons Done / Pending counts onto matching slots -- see point 6
      below for exactly how.
   4. "Pending" mirrors the exact definition already used by
      approval.js's _isDecidable(): Pending at HO = RSM_APPROVAL
      Approved AND HO_APPROVAL Pending; Pending at RSM = RSM_APPROVAL
      Pending. (See normalizeApprovalStatus_() below -- same
      normalization approval.js's Utils.normalizeString() does.)
   5. If a Claims/Generated record's HQ+DESIGNATION doesn't match any
      Master slot, it is NEVER silently dropped or blended into the
      normal hierarchy. It's placed in its own trailing list, using
      that record's own ZONE/RSM_HQ/ASM_HQ (the only hierarchy info
      actually available for it), and returned separately as
      `unmappedRows` -- booking-status-organogram.js renders these
      under a clearly labeled "Historical / Unmapped HQ Records"
      section, only if any exist.
   6. ASM and RSM rows are NOT computed as a single team lump sum
      copied onto every historical Name. Every Coupons Generated/
      Claims record carries a full snapshot -- DSA_NAME/DSA_HQ,
      ASM_NAME/ASM_HQ, RSM_NAME/RSM_HQ -- as it stood at the moment
      that record was created, so each record independently
      contributes to all three levels using each level's OWN recorded
      Name+HQ pair (see applyGeneratedCoupons_() / applyClaims_() /
      bsoIncrementIdentity_() below). This naturally satisfies "ASM row
      = ASM's own transactions + all subordinate DSA transactions"
      (and the same for RSM): if an ASM/RSM position never changed
      hands, every record under that HQ still carries the one name, so
      it all rolls up together; if it did change, each record already
      carries whichever name was correct AT THE TIME it was created,
      so each historical Name naturally receives only its own share --
      with no date logic needed, and nothing double counted, since
      every record is read once per level, never rolled up from a
      child level's already-aggregated total.
   7. Within a slot, rows are emitted: all non-current historical names
      first (alphabetical, for a stable/reproducible export), then the
      current name last.
===================================================================== */

const BSO_DESIGNATIONS_ = ['DSA', 'ASM', 'RSM'];

function bsoTrim_(v) {
    return (v === null || v === undefined) ? '' : String(v).trim();
}

// Collapse whitespace variants (regular space, non-breaking space
// \u00A0, tabs, newlines) AND the Unicode replacement character
// \uFFFD -- which shows up when an Airtable export mangles a
// non-ASCII/invisible character differently than another export of the
// very same value -- into a single ordinary space, for MATCHING
// purposes only. This is deliberately narrow: it only smooths over
// whitespace/encoding noise, never merges two genuinely different
// names. The name actually written into the report always uses the
// original, un-normalized spelling -- this key is only ever used to
// decide whether two records refer to the same person.
function bsoNormalizeNameKey_(v) {
    return bsoTrim_(v)
        .replace(/[\s\u00A0\uFFFD]+/g, ' ')
        .trim();
}

// Same normalization as the browser's Utils.normalizeString() (common.js)
// -- lower-case, punctuation/whitespace collapsed -- so 'Pending', ' pending ',
// etc. all match the same way approval.js's _isDecidable() already does.
function bsoNormalizeApprovalStatus_(v) {
    return bsoTrim_(v)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

// Given a Master/Login row's fields, return its own
// {designation, name, hq} based on its own DESIGNATION field, or null
// if DESIGNATION isn't one of DSA/ASM/RSM (defensive -- e.g. a stray
// corrupted export row).
function bsoDeriveIdentity_(f) {
    const designation = bsoTrim_(f.DESIGNATION).toUpperCase();
    if (BSO_DESIGNATIONS_.indexOf(designation) === -1) return null;

    if (designation === 'DSA') {
        return { designation: designation, name: bsoTrim_(f.DSA_NAME), hq: bsoTrim_(f.DSA_HQ) };
    }
    if (designation === 'ASM') {
        return { designation: designation, name: bsoTrim_(f.ASM_NAME), hq: bsoTrim_(f.ASM_HQ) };
    }
    // RSM
    return { designation: designation, name: bsoTrim_(f.RSM_NAME), hq: bsoTrim_(f.RSM_HQ) };
}

function bsoSlotKey_(hq, designation) {
    return hq + '||' + designation;
}

// Fetch the Master/Login ("RegisterUser") table. Separate from
// getClaims_() / getGeneratedCoupons_() -- this base isn't used
// anywhere else in the portal.
function getMasterLoginData_() {
    const cfg = getMasterLoginConfig_();
    return airtableFetchAll_(cfg.baseId, cfg.table, cfg.view);
}

// Build the structural skeleton from Master/Login: one slot per unique
// HQ+DESIGNATION, in the table's own row order, each seeded with its
// current name (zeroed counts).
function buildBookingStatusSkeleton_(masterRecords) {
    const slots = {};       // key -> slot object
    const slotOrder = [];   // keys, in first-seen order

    masterRecords.forEach(function (rec) {
        const f = rec.fields || {};
        const identity = bsoDeriveIdentity_(f);
        if (!identity || !identity.hq) return; // skip malformed rows defensively

        const key = bsoSlotKey_(identity.hq, identity.designation);
        if (slots[key]) return; // Master/Login is expected to have exactly one row per slot; ignore any stray duplicate rather than erroring

        const zone = bsoTrim_(f.ZONE);
        const rsmHq = bsoTrim_(f.RSM_HQ);
        // ASM_HQ mirrors RSM_HQ for an RSM's own row, and mirrors its own
        // HQ for an ASM's own row -- exactly the pattern already present
        // in both the Excel template and the Master/Login data itself.
        const asmHq = identity.designation === 'RSM' ? rsmHq
                    : identity.designation === 'ASM' ? identity.hq
                    : bsoTrim_(f.ASM_HQ);

        const nameKey = bsoNormalizeNameKey_(identity.name);

        slots[key] = {
            zone: zone,
            rsmHq: rsmHq,
            asmHq: asmHq,
            hq: identity.hq,
            designation: identity.designation,
            currentNameKey: nameKey,
            names: {} // normalizedNameKey -> { displayName, couponsDone, pendingRSM, pendingHO }
        };
        slotOrder.push(key);

        // Seed the current name (including "VACANT-..." names) with
        // zeroed counts so a zero-activity current employee is still
        // satisfied even before any Claims/Generated record is
        // processed.
        slots[key].names[nameKey] = { displayName: identity.name, couponsDone: 0, pendingRSM: 0, pendingHO: 0 };
    });

    return { slots: slots, slotOrder: slotOrder, unmappedSlots: {}, unmappedSlotOrder: [] };
}

// Find-or-create the slot for a Claims/Generated record whose
// HQ+DESIGNATION doesn't already exist in the Master-derived skeleton.
// Placed in its OWN trailing list (skeleton.unmappedSlotOrder), never
// mixed into the normal slotOrder -- booking-status-organogram.js
// renders these under a clearly labeled "Historical / Unmapped HQ
// Records" section instead of silently blending them into the regular
// hierarchy. Uses the record's own ZONE/RSM_HQ/ASM_HQ (the only
// hierarchy information actually available for an HQ that isn't in
// Master/Login) rather than inventing or guessing a position in the
// tree.
function bsoEnsureSlot_(skeleton, identity, fallbackZone, fallbackRsmHq, fallbackAsmHq) {
    const key = bsoSlotKey_(identity.hq, identity.designation);
    if (skeleton.slots[key]) return skeleton.slots[key];

    if (!skeleton.unmappedSlots[key]) {
        skeleton.unmappedSlots[key] = {
            zone: fallbackZone,
            rsmHq: fallbackRsmHq,
            asmHq: fallbackAsmHq,
            hq: identity.hq,
            designation: identity.designation,
            currentNameKey: null, // no Master/Login row for this slot -- nothing to treat as "current"
            names: {}
        };
        skeleton.unmappedSlotOrder.push(key);
    }
    return skeleton.unmappedSlots[key];
}

// Finds-or-creates by normalized key, but keeps the FIRST display
// spelling seen for that key (Master/Login is always processed first,
// so whenever a Master row exists, its spelling wins).
function bsoEnsureName_(slot, rawName) {
    const nameKey = bsoNormalizeNameKey_(rawName);
    if (!slot.names[nameKey]) {
        slot.names[nameKey] = { displayName: rawName, couponsDone: 0, pendingRSM: 0, pendingHO: 0 };
    }
    return slot.names[nameKey];
}

// Increments one counter ('couponsDone', 'pendingRSM', or 'pendingHO')
// by 1 for the exact (designation, hq, name) identity given -- creating
// the slot/name entry first if needed. Used identically for all three
// hierarchy levels; the only thing that differs between call sites is
// which of a record's own field pairs gets passed in.
function bsoIncrementIdentity_(skeleton, designation, rawName, rawHq, zone, rsmHq, asmHq, field) {
    const name = bsoTrim_(rawName);
    const hq = bsoTrim_(rawHq);
    if (!hq || !name) return;

    const slot = bsoEnsureSlot_(skeleton, { designation: designation, hq: hq }, zone, rsmHq, asmHq);
    bsoEnsureName_(slot, name)[field] += 1;
}

// Layer Coupons Generated records onto the skeleton: +1 Coupons Done,
// attributed INDEPENDENTLY at all three levels using each level's own
// recorded Name+HQ snapshot on that record -- never a computed lump
// sum. DSA-level attribution is gated on the record's own DESIGNATION
// being 'DSA' (matching how a coupon's "owner" is otherwise treated
// throughout this portal); ASM/RSM attribution reads that record's own
// ASM_NAME/ASM_HQ and RSM_NAME/RSM_HQ regardless of DESIGNATION, since
// every record always carries that full snapshot as it stood at the
// moment it was created.
function applyGeneratedCoupons_(skeleton, generatedRecords) {
    generatedRecords.forEach(function (rec) {
        const f = rec.fields || {};
        const zone = bsoTrim_(f.ZONE), rsmHq = bsoTrim_(f.RSM_HQ), asmHq = bsoTrim_(f.ASM_HQ);

        const dsaIdentity = bsoDeriveIdentity_(f);
        if (dsaIdentity && dsaIdentity.designation === 'DSA') {
            bsoIncrementIdentity_(skeleton, 'DSA', dsaIdentity.name, dsaIdentity.hq, zone, rsmHq, asmHq, 'couponsDone');
        }

        bsoIncrementIdentity_(skeleton, 'ASM', f.ASM_NAME, f.ASM_HQ, zone, rsmHq, asmHq, 'couponsDone');
        bsoIncrementIdentity_(skeleton, 'RSM', f.RSM_NAME, f.RSM_HQ, zone, rsmHq, asmHq, 'couponsDone');
    });
}

// Layer Claims records onto the skeleton: Pending at RSM / Pending at
// HO, using the exact same status definitions as approval.js's
// _isDecidable(), attributed at all three levels the same independent,
// per-record way as applyGeneratedCoupons_ above.
function applyClaims_(skeleton, claimRecords) {
    claimRecords.forEach(function (rec) {
        const f = rec.fields || {};

        const rsmStatus = bsoNormalizeApprovalStatus_(f.RSM_APPROVAL);
        const hoStatus = bsoNormalizeApprovalStatus_(f.HO_APPROVAL);

        const isPendingAtRsm = rsmStatus === 'pending';
        const isPendingAtHo = rsmStatus === 'approved' && hoStatus === 'pending';

        if (!isPendingAtRsm && !isPendingAtHo) return; // fully resolved (approved/rejected) -- not counted in either pending bucket

        const zone = bsoTrim_(f.ZONE), rsmHq = bsoTrim_(f.RSM_HQ), asmHq = bsoTrim_(f.ASM_HQ);
        const field = isPendingAtRsm ? 'pendingRSM' : 'pendingHO'; // mutually exclusive by construction

        const dsaIdentity = bsoDeriveIdentity_(f);
        if (dsaIdentity && dsaIdentity.designation === 'DSA') {
            bsoIncrementIdentity_(skeleton, 'DSA', dsaIdentity.name, dsaIdentity.hq, zone, rsmHq, asmHq, field);
        }
        bsoIncrementIdentity_(skeleton, 'ASM', f.ASM_NAME, f.ASM_HQ, zone, rsmHq, asmHq, field);
        bsoIncrementIdentity_(skeleton, 'RSM', f.RSM_NAME, f.RSM_HQ, zone, rsmHq, asmHq, field);
    });
}

function bsoFlattenSlotList_(slotsByKey, orderedKeys) {
    const rows = [];

    orderedKeys.forEach(function (key) {
        const slot = slotsByKey[key];
        const allKeys = Object.keys(slot.names);

        const historicalKeys = allKeys
            .filter(function (k) { return k !== slot.currentNameKey; })
            .sort(function (a, b) { return slot.names[a].displayName.localeCompare(slot.names[b].displayName); });

        const nameOrder = slot.currentNameKey !== null && slot.names[slot.currentNameKey]
            ? historicalKeys.concat([slot.currentNameKey])
            : historicalKeys;

        nameOrder.forEach(function (nameKey) {
            const counts = slot.names[nameKey];
            rows.push({
                ZONE: slot.zone,
                RSM_HQ: slot.rsmHq,
                ASM_HQ: slot.asmHq,
                HQ: slot.hq,
                DESIGNATION: slot.designation,
                NAME: counts.displayName,
                COUPONS_DONE: counts.couponsDone,
                PENDING_AT_RSM: counts.pendingRSM,
                PENDING_AT_HO: counts.pendingHO,
                TOTAL: counts.pendingRSM + counts.pendingHO
            });
        });
    });

    return rows;
}

// Total = Pending at RSM + Pending at HO only (Coupons Done is
// deliberately excluded, per spec). Returns the normal, Master-mapped
// hierarchy and any genuinely-unmapped historical HQ+Designation
// combos as two separate arrays.
function flattenBookingStatus_(skeleton) {
    return {
        rows: bsoFlattenSlotList_(skeleton.slots, skeleton.slotOrder),
        unmappedRows: bsoFlattenSlotList_(skeleton.unmappedSlots, skeleton.unmappedSlotOrder)
    };
}

// Entry point called from Code.gs. Read-only session gate only (any
// authenticated role) since this never mutates anything.
function getBookingStatusOrganogramWise_(session) {
    const masterRecords = getMasterLoginData_();
    const claims = getClaims_().records;
    const generatedCoupons = getGeneratedCoupons_().records;

    const skeleton = buildBookingStatusSkeleton_(masterRecords);
    applyGeneratedCoupons_(skeleton, generatedCoupons);
    applyClaims_(skeleton, claims);

    return flattenBookingStatus_(skeleton);
}
