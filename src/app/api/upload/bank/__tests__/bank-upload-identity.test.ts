import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Pure function under test
// ---------------------------------------------------------------------------

function computeStableTxHash(
    companyId: string,
    accountId: string,
    date: string,
    description: string,
    amount: number,
    ordinal: number
): string {
    const normalizedDate = date ? new Date(date).toISOString().slice(0, 10) : 'null';
    const normalizedDesc = (description || '').toLowerCase().trim().replace(/\s+/g, ' ');
    const normalizedAmount = amount.toFixed(2);
    const base = `${companyId}|||${accountId}|||${normalizedDate}|||${normalizedDesc}|||${normalizedAmount}`;
    return `${base}|||occ${ordinal}`;
}

// ---------------------------------------------------------------------------
// Batch helper
// ---------------------------------------------------------------------------

function computeHashesForBatch(
    companyId: string,
    accountId: string,
    rows: Array<{ date: string; description: string; amount: number }>
): string[] {
    const counters: Record<string, number> = {};
    return rows.map(row => {
        const sigKey = `${accountId}|||${row.date}|||${row.description}|||${row.amount.toFixed(2)}`;
        const ordinal = counters[sigKey] ?? 0;
        counters[sigKey] = ordinal + 1;
        return computeStableTxHash(companyId, accountId, row.date, row.description, row.amount, ordinal);
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('txHash stable identity – bank upload', () => {

    // -----------------------------------------------------------------------
    // 1. Legitimate repeated transactions remain distinct
    // -----------------------------------------------------------------------
    describe('legitimate repeated transactions remain distinct', () => {
        it('assigns occ0 to the first occurrence and occ1 to the second within the same batch', () => {
            const companyId = 'company-abc';
            const accountId = 'checking-001';

            const rows = [
                { date: '2024-03-15', description: 'Starbucks Coffee', amount: 5.75 },
                { date: '2024-03-15', description: 'Starbucks Coffee', amount: 5.75 }, // exact duplicate
            ];

            const hashes = computeHashesForBatch(companyId, accountId, rows);

            expect(hashes).toHaveLength(2);
            expect(hashes[0]).toContain('|||occ0');
            expect(hashes[1]).toContain('|||occ1');
            expect(hashes[0]).not.toEqual(hashes[1]);
        });

        it('tracks ordinals independently per distinct (date+desc+amount) signature', () => {
            const companyId = 'company-abc';
            const accountId = 'checking-001';

            const rows = [
                { date: '2024-03-15', description: 'Starbucks Coffee', amount: 5.75 },
                { date: '2024-03-15', description: 'Amazon Prime',     amount: 14.99 }, // different row
                { date: '2024-03-15', description: 'Starbucks Coffee', amount: 5.75 }, // 2nd Starbucks
            ];

            const hashes = computeHashesForBatch(companyId, accountId, rows);

            expect(hashes[0]).toContain('|||occ0'); // 1st Starbucks
            expect(hashes[1]).toContain('|||occ0'); // Amazon (unique)
            expect(hashes[2]).toContain('|||occ1'); // 2nd Starbucks
            // All three are distinct
            expect(new Set(hashes).size).toBe(3);
        });

        it('handles three identical rows with occ0, occ1, occ2', () => {
            const companyId = 'company-abc';
            const accountId = 'savings-002';

            const row = { date: '2024-04-01', description: 'Gym Membership', amount: 30.00 };
            const rows = [row, row, row];

            const hashes = computeHashesForBatch(companyId, accountId, rows);

            expect(hashes[0]).toContain('|||occ0');
            expect(hashes[1]).toContain('|||occ1');
            expect(hashes[2]).toContain('|||occ2');
            expect(new Set(hashes).size).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // 2. Identical rows from different accounts remain distinct
    // -----------------------------------------------------------------------
    describe('identical rows from different accounts remain distinct', () => {
        it('produces different hashes for the same row across two different accountIds', () => {
            const companyId = 'company-xyz';
            const accountA = 'account-A';
            const accountB = 'account-B';

            const row = { date: '2024-05-10', description: 'Netflix', amount: 15.49 };

            const hashA = computeStableTxHash(companyId, accountA, row.date, row.description, row.amount, 0);
            const hashB = computeStableTxHash(companyId, accountB, row.date, row.description, row.amount, 0);

            expect(hashA).not.toEqual(hashB);
            expect(hashA).toContain(accountA);
            expect(hashB).toContain(accountB);
        });

        it('embeds accountId in the hash so account context cannot be confused', () => {
            const companyId = 'company-xyz';

            const hashChecking = computeStableTxHash(companyId, 'checking', '2024-06-01', 'Rent', 1200.00, 0);
            const hashSavings  = computeStableTxHash(companyId, 'savings',  '2024-06-01', 'Rent', 1200.00, 0);

            expect(hashChecking).toContain('|||checking|||');
            expect(hashSavings).toContain('|||savings|||');
            expect(hashChecking).not.toEqual(hashSavings);
        });
    });

    // -----------------------------------------------------------------------
    // 3. Row reordering does not change identity for unique rows
    // -----------------------------------------------------------------------
    describe('row reordering does not change identity for unique rows', () => {
        it('a unique row has the same hash regardless of its position in the batch', () => {
            const companyId = 'company-abc';
            const accountId = 'checking-001';

            const targetRow = { date: '2024-07-04', description: 'Fireworks Store', amount: 42.00 };
            const otherRow1 = { date: '2024-07-03', description: 'Gas Station',     amount: 60.00 };
            const otherRow2 = { date: '2024-07-05', description: 'Grocery Store',   amount: 110.50 };

            // Target row at position 0
            const hashesFirst = computeHashesForBatch(companyId, accountId, [targetRow, otherRow1, otherRow2]);
            // Target row at position 1
            const hashesMiddle = computeHashesForBatch(companyId, accountId, [otherRow1, targetRow, otherRow2]);
            // Target row at position 2
            const hashesLast = computeHashesForBatch(companyId, accountId, [otherRow1, otherRow2, targetRow]);

            // The hash for the unique target row should always be occ0 and identical
            expect(hashesFirst[0]).toEqual(hashesMiddle[1]);
            expect(hashesFirst[0]).toEqual(hashesLast[2]);
        });

        it('reversing a list of entirely unique rows produces a matching reversed hash list', () => {
            const companyId = 'company-abc';
            const accountId = 'checking-001';

            const rows = [
                { date: '2024-01-01', description: 'Coffee Shop A', amount: 3.50 },
                { date: '2024-01-02', description: 'Coffee Shop B', amount: 4.00 },
                { date: '2024-01-03', description: 'Coffee Shop C', amount: 4.50 },
            ];

            const forwardHashes  = computeHashesForBatch(companyId, accountId, rows);
            const reversedHashes = computeHashesForBatch(companyId, accountId, [...rows].reverse());

            // Each reversed hash should match its forward counterpart (all unique → always occ0)
            expect(reversedHashes[0]).toEqual(forwardHashes[2]);
            expect(reversedHashes[1]).toEqual(forwardHashes[1]);
            expect(reversedHashes[2]).toEqual(forwardHashes[0]);
        });
    });

    // -----------------------------------------------------------------------
    // 4. Re-uploading same file with same fileHash is idempotent
    // -----------------------------------------------------------------------
    describe('re-uploading same file with same fileHash is idempotent', () => {
        it('same set of rows produces exactly the same set of txHashes on re-upload', () => {
            const companyId = 'company-abc';
            const accountId = 'checking-001';

            const rows = [
                { date: '2024-08-01', description: 'Spotify', amount: 9.99 },
                { date: '2024-08-01', description: 'Spotify', amount: 9.99 }, // duplicate
                { date: '2024-08-02', description: 'Hulu',    amount: 7.99 },
            ];

            const firstUploadHashes  = computeHashesForBatch(companyId, accountId, rows);
            const secondUploadHashes = computeHashesForBatch(companyId, accountId, rows);

            expect(firstUploadHashes).toEqual(secondUploadHashes);
        });

        it('all individual hash values are byte-for-byte stable across invocations', () => {
            const companyId = 'co-1';
            const accountId = 'acc-1';

            const hash1 = computeStableTxHash(companyId, accountId, '2024-09-15', 'Recurring Bill', 99.99, 0);
            const hash2 = computeStableTxHash(companyId, accountId, '2024-09-15', 'Recurring Bill', 99.99, 0);

            expect(hash1).toBe(hash2);
            expect(hash1).toBe('co-1|||acc-1|||2024-09-15|||recurring bill|||99.99|||occ0');
        });

        it('normalized form is deterministic regardless of description casing or extra spaces', () => {
            const companyId = 'co-1';
            const accountId = 'acc-1';

            // All three descriptions normalise to "amazon prime"
            const hashA = computeStableTxHash(companyId, accountId, '2024-09-01', 'AMAZON PRIME',    14.99, 0);
            const hashB = computeStableTxHash(companyId, accountId, '2024-09-01', 'amazon prime',    14.99, 0);
            const hashC = computeStableTxHash(companyId, accountId, '2024-09-01', '  Amazon  Prime ', 14.99, 0);

            expect(hashA).toEqual(hashB);
            expect(hashB).toEqual(hashC);
        });
    });

    // -----------------------------------------------------------------------
    // 5. Occurrence ordinal is per-account, not global
    // -----------------------------------------------------------------------
    describe('occurrence ordinal is per-account not global', () => {
        it('two accounts each with a repeated row get independent occ0/occ1 counters', () => {
            const companyId = 'company-multi';
            const accountA  = 'account-A';
            const accountB  = 'account-B';

            const repeatedRow = { date: '2024-10-05', description: 'Utility Bill', amount: 120.00 };

            // Account A uploads the row twice
            const hashesA = computeHashesForBatch(companyId, accountA, [repeatedRow, repeatedRow]);
            // Account B uploads the row twice (independent batch)
            const hashesB = computeHashesForBatch(companyId, accountB, [repeatedRow, repeatedRow]);

            // Each account starts its own ordinal counter from 0
            expect(hashesA[0]).toContain('|||occ0');
            expect(hashesA[1]).toContain('|||occ1');
            expect(hashesB[0]).toContain('|||occ0');
            expect(hashesB[1]).toContain('|||occ1');

            // But cross-account hashes are always different (accountId is embedded)
            expect(hashesA[0]).not.toEqual(hashesB[0]);
            expect(hashesA[1]).not.toEqual(hashesB[1]);
        });

        it('a global batch with rows interleaved across accounts assigns ordinals per-account via separate batch calls', () => {
            const companyId = 'company-multi';
            const accountA  = 'account-A';
            const accountB  = 'account-B';

            const row = { date: '2024-11-01', description: 'Insurance', amount: 200.00 };

            // Simulated: rows are split by account before ordinals are computed
            const rowsForA = [row, row]; // A sees this row twice
            const rowsForB = [row];      // B sees it once

            const hashesA = computeHashesForBatch(companyId, accountA, rowsForA);
            const hashesB = computeHashesForBatch(companyId, accountB, rowsForB);

            expect(hashesA[0]).toContain(`${accountA}|||`);
            expect(hashesA[0]).toContain('|||occ0');
            expect(hashesA[1]).toContain('|||occ1');

            expect(hashesB[0]).toContain(`${accountB}|||`);
            expect(hashesB[0]).toContain('|||occ0');
            // B only had one row, so occ1 should not exist
            expect(hashesB).toHaveLength(1);
        });

        it('ordinal counter resets to 0 between separate batch invocations for the same account', () => {
            const companyId = 'company-multi';
            const accountId = 'account-A';

            const row = { date: '2024-12-01', description: 'Subscription', amount: 9.99 };

            // First upload: one row
            const firstBatch  = computeHashesForBatch(companyId, accountId, [row]);
            // Second upload: same row again (re-upload)
            const secondBatch = computeHashesForBatch(companyId, accountId, [row]);

            // Both batches start fresh, so both should be occ0
            expect(firstBatch[0]).toContain('|||occ0');
            expect(secondBatch[0]).toContain('|||occ0');
            expect(firstBatch[0]).toEqual(secondBatch[0]);
        });
    });

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------
    describe('edge cases', () => {
        it('normalizes amount to two decimal places (toFixed(2))', () => {
            const hash1 = computeStableTxHash('c1', 'a1', '2024-01-01', 'desc', 10,    0);
            const hash2 = computeStableTxHash('c1', 'a1', '2024-01-01', 'desc', 10.0,  0);
            const hash3 = computeStableTxHash('c1', 'a1', '2024-01-01', 'desc', 10.00, 0);

            expect(hash1).toEqual(hash2);
            expect(hash2).toEqual(hash3);
            expect(hash1).toContain('|||10.00|||');
        });

        it('includes the correct ISO date segment in the hash', () => {
            const hash = computeStableTxHash('co', 'ac', '2024-06-15', 'Test', 1.00, 0);
            expect(hash).toContain('|||2024-06-15|||');
        });

        it('different ordinals always produce different hashes for otherwise identical inputs', () => {
            const hashes = [0, 1, 2, 3, 4].map(ord =>
                computeStableTxHash('co', 'ac', '2024-01-01', 'desc', 1.00, ord)
            );
            expect(new Set(hashes).size).toBe(5);
        });
    });
});
