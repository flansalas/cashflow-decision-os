// services/columnMapper.ts – Auto-detect column mappings and apply them
// Pure logic — no React, no DB.

// ─── Field definitions ────────────────────────────────────────────────────────

export interface FieldDef {
    key: string;
    label: string;
    required: boolean;
    aliases: string[];   // normalized (lowercase, no spaces/underscores) aliases to match against
}

export const AR_FIELDS: FieldDef[] = [
    {
        key: "customerName",
        label: "Customer Name",
        required: true,
        aliases: ["customername", "customer", "client", "clientname", "billto", "company", "accountname", "name"],
    },
    {
        key: "invoiceNo",
        label: "Invoice #",
        required: false,
        aliases: ["invoiceno", "invoicenumber", "invoice", "invno", "inv#", "invoiceid", "number", "id", "refno", "ref"],
    },
    {
        key: "amountOpen",
        label: "Amount Open ($)",
        required: true,
        aliases: ["amountopen", "openbalance", "balance", "amount", "outstanding", "amountdue", "balancedue", "openamount", "total", "totaldue"],
    },
    {
        key: "invoiceDate",
        label: "Invoice Date",
        required: false,
        aliases: ["invoicedate", "date", "issuedate", "created", "invdate", "documentdate", "txdate"],
    },
    {
        key: "dueDate",
        label: "Due Date",
        required: false,
        aliases: ["duedate", "due", "paymentdue", "payby", "paymentdate", "dueon"],
    },
    {
        key: "status",
        label: "Status",
        required: false,
        aliases: ["status", "state", "paymentstatus", "invoicestatus"],
    },
    {
        key: "daysPastDue",
        label: "Days Past Due",
        required: false,
        aliases: ["dayspastdue", "pastdue", "agingdays", "days", "overdue", "daysoverdue", "aging"],
    },
];

export const AP_FIELDS: FieldDef[] = [
    {
        key: "vendorName",
        label: "Vendor Name",
        required: true,
        aliases: ["vendorname", "vendor", "supplier", "suppliername", "payee", "company", "name"],
    },
    {
        key: "billNo",
        label: "Bill #",
        required: false,
        aliases: ["billno", "billnumber", "bill", "billid", "refno", "ref", "invoiceno", "invoicenumber", "number", "id", "purchaseorderno"],
    },
    {
        key: "amountOpen",
        label: "Amount Open ($)",
        required: true,
        aliases: ["amountopen", "openbalance", "balance", "amount", "outstanding", "amountdue", "balancedue", "openamount", "total", "totaldue", "unpaid"],
    },
    {
        key: "billDate",
        label: "Bill Date",
        required: false,
        aliases: ["billdate", "date", "issuedate", "created", "invoicedate", "documentdate", "txdate"],
    },
    {
        key: "dueDate",
        label: "Due Date",
        required: false,
        aliases: ["duedate", "due", "paymentdue", "payby", "paymentdate", "dueon"],
    },
    {
        key: "status",
        label: "Status",
        required: false,
        aliases: ["status", "state", "paymentstatus", "billstatus"],
    },
    {
        key: "daysPastDue",
        label: "Days Past Due",
        required: false,
        aliases: ["dayspastdue", "pastdue", "agingdays", "days", "overdue", "daysoverdue", "aging"],
    },
];

export const BANK_FIELDS: FieldDef[] = [
    {
        key: "date",
        label: "Date",
        required: true,
        aliases: ["date", "posteddate", "transactiondate", "txdate", "postdate", "cleardate"],
    },
    {
        key: "description",
        label: "Description",
        required: true,
        aliases: ["description", "desc", "memo", "payee", "merchant", "name", "transaction", "details", "merchantname", "merchantdescription", "accountdescription", "narrative"],
    },
    {
        key: "amount",
        label: "Amount / Inflow ($)",
        required: true,
        aliases: ["amount", "value", "deposit", "credit", "transactionamount", "amounts", "total", "advances", "inflow", "credits", "deposits"],
    },
    {
        key: "amountOut",
        label: "Outflow ($) (Optional)",
        required: false,
        aliases: ["payment", "debit", "withdrawals", "payments", "outflow", "debits", "charges", "withdrawal"],
    },
];

// ─── Normalize a header string for comparison ─────────────────────────────────

function normalize(s: string): string {
    return s.toLowerCase().replace(/[\s_\-./()#$%]/g, "");
}

// ─── Auto-detect: headers → { targetField: headerName } ──────────────────────

export function autoDetect(
    headers: string[],
    fields: FieldDef[]
): Record<string, string> {
    const mapping: Record<string, string> = {};
    const usedHeaders = new Set<string>();

    for (const field of fields) {
        for (const header of headers) {
            if (usedHeaders.has(header)) continue;
            const norm = normalize(header);
            if (field.aliases.includes(norm)) {
                mapping[field.key] = header;
                usedHeaders.add(header);
                break;
            }
        }
    }

    return mapping;
}

// ─── Normalized output types ──────────────────────────────────────────────────

export interface NormalizedARRow {
    customerName: string;
    invoiceNo: string;
    amountOpen: number;
    invoiceDate: string | null;
    dueDate: string | null;
    status: string;
    daysPastDue: number | null;
}

export interface NormalizedAPRow {
    vendorName: string;
    billNo: string;
    amountOpen: number;
    billDate: string | null;
    dueDate: string | null;
    status: string;
    daysPastDue: number | null;
}

export interface NormalizedBankRow {
    date: string | null;
    description: string;
    amount: number;
}


// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDate(val: string | undefined): string | null {
    if (!val || !val.trim()) return null;
    const d = new Date(val.trim());
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
}

function parseAmount(val: string | undefined): number {
    if (!val) return 0;
    // Clean currency symbols, commas, spaces
    let cleaned = val.replace(/[$,\s]/g, "");
    // Handle (100) as -100
    if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
        cleaned = "-" + cleaned.slice(1, -1);
    }
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
}

function parseInt2(val: string | undefined): number | null {
    if (!val || !val.trim()) return null;
    const n = parseInt(val.trim(), 10);
    return isNaN(n) ? null : n;
}

/**
 * Identify summary/total rows commonly found in accounting exports.
 * Only returns true if the string IS exactly a summary label, not if it just contains it (to avoid false positives like "Total Gym LLC").
 */
const SUMMARY_LABELS = new Set([
    "total",
    "grandtotal",
    "subtotal",
    "totali",
    "totalo",
    "summary",
    "all",
    "totalreceivables",
    "totalpayables"
]);

function isSummaryRow(name: string): boolean {
    if (!name) return false;
    const norm = normalize(name);
    return SUMMARY_LABELS.has(norm);
}

// ─── Apply mapping ────────────────────────────────────────────────────────────

export function applyARMapping(
    rows: Record<string, string>[],
    mapping: Record<string, string>
): NormalizedARRow[] {
    return rows.map((row, i) => {
        const name = row[mapping.customerName ?? ""] ?? "";
        const invNo = row[mapping.invoiceNo ?? ""] ?? "";
        return {
            customerName: name,
            invoiceNo: invNo || `INV-REF-${name.slice(0, 3).toUpperCase()}-${i}`,
            amountOpen: parseAmount(row[mapping.amountOpen ?? ""]),
            invoiceDate: parseDate(row[mapping.invoiceDate ?? ""]),
            dueDate: parseDate(row[mapping.dueDate ?? ""]),
            status: (row[mapping.status ?? ""] || "open").toLowerCase(),
            daysPastDue: parseInt2(row[mapping.daysPastDue ?? ""]),
        };
    }).filter(r => r.customerName && r.amountOpen > 0 && !isSummaryRow(r.customerName));
}

export function applyAPMapping(
    rows: Record<string, string>[],
    mapping: Record<string, string>
): NormalizedAPRow[] {
    return rows.map((row, i) => {
        const name = row[mapping.vendorName ?? ""] ?? "";
        const billNo = row[mapping.billNo ?? ""] ?? "";
        return {
            vendorName: name,
            billNo: billNo || `BILL-REF-${name.slice(0, 3).toUpperCase()}-${i}`,
            amountOpen: parseAmount(row[mapping.amountOpen ?? ""]),
            billDate: parseDate(row[mapping.billDate ?? ""]),
            dueDate: parseDate(row[mapping.dueDate ?? ""]),
            status: (row[mapping.status ?? ""] || "open").toLowerCase(),
            daysPastDue: parseInt2(row[mapping.daysPastDue ?? ""]),
        };
    }).filter(r => r.vendorName && r.amountOpen > 0 && !isSummaryRow(r.vendorName));
}

export function applyBankMapping(
    rows: Record<string, string>[],
    mapping: Record<string, string>
): NormalizedBankRow[] {
    return rows.map((row) => {
        let amt1 = parseAmount(row[mapping.amount ?? ""]);
        let amt2 = parseAmount(row[mapping.amountOut ?? ""]);

        // If there's an explicit outflow column, assume amt1 is strictly inflow and amt2 is outflow
        if (mapping.amountOut) {
            amt1 = Math.abs(amt1);
            amt2 = -Math.abs(amt2);
            // Result is whichever is non-zero
            amt1 = amt1 !== 0 ? amt1 : amt2;
        }

        return {
            date: parseDate(row[mapping.date ?? ""]),
            description: row[mapping.description ?? ""] ?? "",
            amount: amt1,
        };
    }).filter(r => r.date && r.description && r.amount !== 0);
}

// ─── Preview summary ──────────────────────────────────────────────────────────

export function arSummary(rows: NormalizedARRow[]) {
    const open = rows.filter(r => r.status === "open" || !r.status);
    const totalOpen = open.reduce((s, r) => s + r.amountOpen, 0);
    const missingDates = rows.filter(r => !r.dueDate && !r.invoiceDate).length;
    return { open: open.length, totalOpen, missingDates, total: rows.length };
}

export function apSummary(rows: NormalizedAPRow[]) {
    const open = rows.filter(r => r.status === "open" || !r.status);
    const totalOpen = open.reduce((s, r) => s + r.amountOpen, 0);
    const missingDates = rows.filter(r => !r.dueDate && !r.billDate).length;
    return { open: open.length, totalOpen, missingDates, total: rows.length };
}

export function bankSummary(rows: NormalizedBankRow[]) {
    let inflows = 0;
    let outflows = 0;
    rows.forEach(r => {
        if (r.amount > 0) inflows++;
        else if (r.amount < 0) outflows++;
    });
    return { inflows, outflows, total: rows.length };
}
