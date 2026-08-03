/* =====================================================================
   DUPLICATE.JS
   Duplicate detection engine for coupon claims.

   Compares every claim against every other claim using weighted
   field matching, and produces a Map of unique duplicate findings.

   Depends on: common.js (Utils)
===================================================================== */

class DuplicateEngine {

    constructor() {

        // Weighted scoring model. Total = 100.
        this.WEIGHTS = {
            BILL_NUMBER: 40,        // Invoice Number  (primary)
            CUSTOMER_NAME: 20,      // Customer Name   (primary)
            CUSTOMER_MOBILE: 15,    // Customer Mobile (primary)
            CUSTOMER_EMAIL: 10,     // Customer Email  (primary)
            STOCKIST_NAME: 5,       // Stockist        (secondary)
            BILL_AMOUNT: 4,         // Bill Amount     (secondary)
            NUMBER_OF_COUPONS: 3,   // Coupons         (secondary)
            BILL_DATE: 2,           // Bill Date       (secondary)
            CUSTOMER_CITY: 1        // Customer City   (secondary)
        };

        this.PRIMARY_FIELDS = ['BILL_NUMBER', 'CUSTOMER_NAME', 'CUSTOMER_MOBILE', 'CUSTOMER_EMAIL'];
        this.SECONDARY_FIELDS = ['STOCKIST_NAME', 'BILL_AMOUNT', 'NUMBER_OF_COUPONS', 'BILL_DATE', 'CUSTOMER_CITY'];

        this.LABELS = {
            BILL_NUMBER: 'Invoice Number',
            CUSTOMER_NAME: 'Customer Name',
            CUSTOMER_MOBILE: 'Mobile Number',
            CUSTOMER_EMAIL: 'Customer Email',
            STOCKIST_NAME: 'Stockist Name',
            BILL_AMOUNT: 'Bill Amount',
            NUMBER_OF_COUPONS: 'Coupon Count',
            BILL_DATE: 'Bill Date',
            CUSTOMER_CITY: 'Customer City'
        };

        this._resultCache = null; // Map<recordId, DuplicateFinding>
        this._lastDataRef = null;
    }

    // Return a normalized comparison value for a given field on a record.
    _fieldValue(record, field) {
        const f = record.fields || {};

        switch (field) {
            case 'CUSTOMER_MOBILE':
                return Utils.normalizeString(String(f.CUSTOMER_MOBILE || '').replace(/[^0-9]/g, ''));
            case 'CUSTOMER_EMAIL':
                return Utils.normalizeString(f.CUSTOMER_EMAIL);
            case 'BILL_NUMBER':
                return Utils.normalizeString(f.BILL_NUMBER);
            case 'CUSTOMER_NAME':
                return Utils.normalizeString(f.CUSTOMER_NAME);
            case 'STOCKIST_NAME':
                return Utils.normalizeString(f.STOCKIST_NAME);
            case 'CUSTOMER_CITY':
                return Utils.normalizeString(f.CUSTOMER_CITY);
            case 'BILL_AMOUNT':
                return Utils.safeNumber(f.BILL_AMOUNT, null);
            case 'NUMBER_OF_COUPONS':
                return Utils.safeNumber(f.NUMBER_OF_COUPONS, null);
            case 'BILL_DATE': {
                const d = Utils.parseDate(f.BILL_DATE);
                return d ? d.getTime() : null;
            }
            default:
                return Utils.normalizeString(f[field]);
        }
    }

    // Compare two records field by field. Returns { score, reasons[], primaryHit }.
    _compareRecords(a, b) {

        let primaryHit = false;
        let primaryScore = 0;
        let secondaryScore = 0;
        const reasons = [];

        this.PRIMARY_FIELDS.forEach(field => {
            const va = this._fieldValue(a, field);
            const vb = this._fieldValue(b, field);

            if (va !== '' && va !== null && vb !== '' && vb !== null && va === vb) {
                primaryHit = true;
                primaryScore += this.WEIGHTS[field];
                reasons.push(this.LABELS[field]);
            }
        });

        // Secondary fields only count toward the score if at least one
        // primary field already matched. This prevents amount/date/count
        // coincidences from independently inflating the risk level.
        if (primaryHit) {
            this.SECONDARY_FIELDS.forEach(field => {
                const va = this._fieldValue(a, field);
                const vb = this._fieldValue(b, field);

                if (va !== '' && va !== null && vb !== '' && vb !== null && va === vb) {
                    secondaryScore += this.WEIGHTS[field];
                    reasons.push(this.LABELS[field]);
                }
            });
        }

        return {
            score: primaryHit ? Math.min(100, primaryScore + secondaryScore) : 0,
            reasons,
            primaryHit
        };
    }

    // Convert a numeric score into a risk level bucket.
    static riskLevel(score) {
        if (score >= 81) return { label: 'Exact Duplicate', tier: 'exact', color: 'danger' };
        if (score >= 61) return { label: 'High Risk', tier: 'high', color: 'danger' };
        if (score >= 41) return { label: 'Medium Risk', tier: 'medium', color: 'warning' };
        if (score >= 21) return { label: 'Possible Duplicate', tier: 'possible', color: 'info' };
        return { label: 'No Duplicate', tier: 'none', color: 'success' };
    }

    // Run the full O(n^2) comparison across a claims dataset and build
    // a Map keyed by record id containing the strongest duplicate finding
    // for that record (never stores the same target twice).
    analyzeAll(claimsData) {

        // Return cached results if the dataset reference hasn't changed.
        if (this._lastDataRef === claimsData && this._resultCache) {
            return this._resultCache;
        }

        const findings = new Map();
        const n = claimsData.length;

        for (let i = 0; i < n; i++) {
            const recA = claimsData[i];

            for (let j = i + 1; j < n; j++) {
                const recB = claimsData[j];

                const result = this._compareRecords(recA, recB);
                if (result.score <= 0) continue;

                this._recordFinding(findings, recA, recB, result);
                this._recordFinding(findings, recB, recA, result);
            }
        }

        this._resultCache = findings;
        this._lastDataRef = claimsData;
        return findings;
    }

    // Merge a match result into the findings map for `record`, referencing `matchedWith`.
    //
    // Business rule: a matching claim that has already been rejected (RSM or
    // HO) must never contribute to `record`'s duplicate score or count. It
    // is still tracked, separately, under `rejectedMatches` so it stays
    // visible for audit purposes.
    _recordFinding(findings, record, matchedWith, result) {
        const id = record.id;

        if (!findings.has(id)) {
            findings.set(id, {
                record,
                maxScore: 0,
                reasons: new Set(),
                matches: [],          // { id, certNo, score, reasons } - ACTIVE matches only
                rejectedMatches: []   // { id, certNo, reasons, rejectedBy, reason } - info only
            });
        }

        const entry = findings.get(id);
        const matchCertNo = (matchedWith.fields && matchedWith.fields.CERT_NO) || matchedWith.id;

        // A pair is excluded from active scoring if EITHER side has already
        // been rejected -- not just the "matchedWith" side. Without this,
        // a record that is itself rejected could still surface as someone
        // else's active duplicate finding.
        const matchedRejection = Utils.rejectionInfo(matchedWith);
        const selfRejection = Utils.rejectionInfo(record);

        if (matchedRejection || selfRejection) {
            // Only file it under "Previously Rejected" (with rejectedBy /
            // reason) when the OTHER record in the pair is the one that was
            // rejected -- that's the audit-worthy case from `record`'s point
            // of view. If only `record` itself was rejected, `matchedWith`
            // is perfectly clean; silently exclude the pair from scoring
            // rather than mislabeling matchedWith as rejected.
            if (matchedRejection && !entry.rejectedMatches.some(m => m.id === matchedWith.id)) {
                entry.rejectedMatches.push({
                    id: matchedWith.id,
                    certNo: matchCertNo,
                    record: matchedWith, // full record -- lets callers read any field (e.g. for the invoice viewer) without a second lookup
                    reasons: result.reasons,
                    rejectedBy: matchedRejection.rejectedBy,
                    reason: matchedRejection.reason
                });
            }
            return; // Never contributes to score, reasons, or active match count.
        }

        // Avoid storing the same matched record twice.
        if (!entry.matches.some(m => m.id === matchedWith.id)) {
            entry.matches.push({
                id: matchedWith.id,
                certNo: matchCertNo,
                record: matchedWith, // full record -- lets callers read any field (e.g. for the invoice viewer) without a second lookup
                score: result.score,
                reasons: result.reasons
            });
        }

        result.reasons.forEach(r => entry.reasons.add(r));
        entry.maxScore = Math.max(entry.maxScore, result.score);
    }

    // Analyze a single record against the full dataset on demand
    // (used by the HO approval screen). Does not require analyzeAll first.
    // Same rejected-match exclusion rule as analyzeAll/_recordFinding.
    analyzeRecord(record, claimsData) {
        const finding = {
            record,
            maxScore: 0,
            reasons: new Set(),
            matches: [],
            rejectedMatches: []
        };

        const selfRejection = Utils.rejectionInfo(record);

        claimsData.forEach(other => {
            if (other.id === record.id) return;

            const result = this._compareRecords(record, other);
            if (result.score <= 0) return;

            const certNo = (other.fields && other.fields.CERT_NO) || other.id;
            const otherRejection = Utils.rejectionInfo(other);

            if (otherRejection || selfRejection) {
                // Same rule as _recordFinding: only surface it as a
                // "Previously Rejected" match when `other` is the side that
                // was actually rejected.
                if (otherRejection) {
                    finding.rejectedMatches.push({
                        id: other.id,
                        certNo,
                        record: other, // full record -- lets callers read any field (e.g. for the invoice viewer) without a second lookup
                        reasons: result.reasons,
                        rejectedBy: otherRejection.rejectedBy,
                        reason: otherRejection.reason
                    });
                }
                return; // Excluded from score/count either way.
            }

            finding.matches.push({
                id: other.id,
                certNo,
                record: other, // full record -- lets callers read any field (e.g. for the invoice viewer) without a second lookup
                score: result.score,
                reasons: result.reasons
            });

            result.reasons.forEach(r => finding.reasons.add(r));
            finding.maxScore = Math.max(finding.maxScore, result.score);
        });

        finding.matches.sort((a, b) => b.score - a.score);
        return finding;
    }

    // Convenience: all findings above a minimum score, sorted descending.
    getRankedFindings(claimsData, minScore = 21) {
        const findings = this.analyzeAll(claimsData);
        return Array.from(findings.values())
            .filter(f => f.maxScore >= minScore)
            .sort((a, b) => b.maxScore - a.maxScore);
    }

    // Invalidate the cache (call after loadData refreshes claimsData).
    reset() {
        this._resultCache = null;
        this._lastDataRef = null;
    }
}

// Single shared instance used across the app.
const duplicateEngine = new DuplicateEngine();
