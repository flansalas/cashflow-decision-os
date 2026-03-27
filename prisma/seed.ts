// prisma/seed.ts – Demo company seeder
// Run: npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed.ts
// Or via the package.json prisma.seed script

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";

const dbUrl = process.env.DATABASE_URL ?? "file:./dev.db";
const filePath = dbUrl.replace(/^file:/, "");
const absPath = path.resolve(process.cwd(), filePath);
const adapter = new PrismaBetterSqlite3({ url: absPath });
const prisma = new PrismaClient({ adapter });

function d(iso: string): Date {
    return new Date(iso);
}

/** Helper: date N days from today */
function daysFromNow(n: number): Date {
    const dt = new Date();
    dt.setDate(dt.getDate() + n);
    dt.setHours(0, 0, 0, 0);
    return dt;
}

/** Helper: date N weeks from today (Monday-aligned) */
function weeksFromNow(n: number): Date {
    const dt = new Date();
    dt.setDate(dt.getDate() + n * 7);
    // align to Monday
    const day = dt.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    dt.setDate(dt.getDate() + diff);
    dt.setHours(0, 0, 0, 0);
    return dt;
}

/** Helper: get today aligned to midnight */
function today(): Date {
    const dt = new Date();
    dt.setHours(0, 0, 0, 0);
    return dt;
}

async function main() {
    // ── Clean existing demo data ──────────────────────────────────────
    const existing = await prisma.company.findFirst({ where: { isDemo: true } });
    if (existing) {
        await prisma.company.delete({ where: { id: existing.id } });
    }

    // ── Create Demo Company ───────────────────────────────────────────
    const company = await prisma.company.create({
        data: {
            name: "Apex Mechanical Services",
            isDemo: true,
        },
    });
    const cid = company.id;

    // ── Cash Snapshot ──────────────────────────────────────────────────
    await prisma.cashSnapshot.create({
        data: {
            companyId: cid,
            asOfDate: today(),
            bankBalance: 87500,
        },
    });

    // ── Cash Adjustments ──────────────────────────────────────────────
    await prisma.cashAdjustment.createMany({
        data: [
            {
                companyId: cid,
                type: "pending_deposit",
                amount: 4200,
                effectiveDate: today(),
                note: "Customer check deposited yesterday, clearing tomorrow",
            },
            {
                companyId: cid,
                type: "uncleared_check",
                amount: -2800,
                effectiveDate: today(),
                note: "Check #4501 to supplier not yet cleared",
            },
        ],
    });

    // ── Customer Profiles ─────────────────────────────────────────────
    await prisma.customerProfile.createMany({
        data: [
            { companyId: cid, customerName: "Metro Construction Group", riskTag: "low", typicalDelayWeeks: 0 },
            { companyId: cid, customerName: "Sunrise Property Mgmt", riskTag: "med", typicalDelayWeeks: 2 },
            { companyId: cid, customerName: "Delta Industrial Corp", riskTag: "high", typicalDelayWeeks: 4 },
            { companyId: cid, customerName: "Citywide Renovations", riskTag: "low", typicalDelayWeeks: 1 },
            { companyId: cid, customerName: "Harbor View Condos HOA", riskTag: "med", typicalDelayWeeks: 3 },
        ],
    });

    // ── Vendor Profiles ───────────────────────────────────────────────
    await prisma.vendorProfile.createMany({
        data: [
            { companyId: cid, vendorName: "National HVAC Supply", criticality: "critical" },
            { companyId: cid, vendorName: "ProParts Wholesale", criticality: "critical" },
            { companyId: cid, vendorName: "City Fleet Fuel Services", criticality: "normal" },
            { companyId: cid, vendorName: "SafeGuard Insurance Co", criticality: "critical" },
            { companyId: cid, vendorName: "QuickPrint Office Supply", criticality: "normal" },
        ],
    });

    // ── Receivable Invoices (AR) ──────────────────────────────────────
    await prisma.receivableInvoice.createMany({
        data: [
            // Current / near-term
            { companyId: cid, customerName: "Metro Construction Group", invoiceNo: "INV-1001", invoiceDate: daysFromNow(-25), dueDate: daysFromNow(5), amountOpen: 18500, status: "open" },
            { companyId: cid, customerName: "Metro Construction Group", invoiceNo: "INV-1002", invoiceDate: daysFromNow(-10), dueDate: daysFromNow(20), amountOpen: 12000, status: "open" },
            { companyId: cid, customerName: "Sunrise Property Mgmt", invoiceNo: "INV-1003", invoiceDate: daysFromNow(-40), dueDate: daysFromNow(-10), amountOpen: 9200, daysPastDue: 10, status: "open" },
            { companyId: cid, customerName: "Sunrise Property Mgmt", invoiceNo: "INV-1004", invoiceDate: daysFromNow(-15), dueDate: daysFromNow(15), amountOpen: 6800, status: "open" },
            { companyId: cid, customerName: "Citywide Renovations", invoiceNo: "INV-1005", invoiceDate: daysFromNow(-5), dueDate: daysFromNow(25), amountOpen: 22000, status: "open" },
            // Overdue / high-risk
            { companyId: cid, customerName: "Delta Industrial Corp", invoiceNo: "INV-1006", invoiceDate: daysFromNow(-75), dueDate: daysFromNow(-45), amountOpen: 31500, daysPastDue: 45, status: "open", metaJson: JSON.stringify({ disputed: false, retainage: false, partialLikely: true }) },
            { companyId: cid, customerName: "Delta Industrial Corp", invoiceNo: "INV-1007", invoiceDate: daysFromNow(-90), dueDate: daysFromNow(-60), amountOpen: 14800, daysPastDue: 60, status: "open" },
            { companyId: cid, customerName: "Harbor View Condos HOA", invoiceNo: "INV-1008", invoiceDate: daysFromNow(-50), dueDate: daysFromNow(-20), amountOpen: 7600, daysPastDue: 20, status: "open", metaJson: JSON.stringify({ disputed: true, retainage: false, partialLikely: false }) },
            // Future
            { companyId: cid, customerName: "Citywide Renovations", invoiceNo: "INV-1009", invoiceDate: daysFromNow(-2), dueDate: daysFromNow(28), amountOpen: 15400, status: "open" },
            { companyId: cid, customerName: "Metro Construction Group", invoiceNo: "INV-1010", invoiceDate: daysFromNow(0), dueDate: daysFromNow(30), amountOpen: 8900, status: "open" },
            // Missing date edge case
            { companyId: cid, customerName: "Harbor View Condos HOA", invoiceNo: "INV-1011", amountOpen: 5200, status: "open" },
            // Paid (for history)
            { companyId: cid, customerName: "Metro Construction Group", invoiceNo: "INV-0990", invoiceDate: daysFromNow(-60), dueDate: daysFromNow(-30), amountOpen: 0, status: "paid" },
        ],
    });

    // ── Payable Bills (AP) ─────────────────────────────────────────────
    await prisma.payableBill.createMany({
        data: [
            { companyId: cid, vendorName: "National HVAC Supply", billNo: "BILL-2001", billDate: daysFromNow(-20), dueDate: daysFromNow(3), amountOpen: 11200, status: "open" },
            { companyId: cid, vendorName: "National HVAC Supply", billNo: "BILL-2002", billDate: daysFromNow(-5), dueDate: daysFromNow(25), amountOpen: 8400, status: "open" },
            { companyId: cid, vendorName: "ProParts Wholesale", billNo: "BILL-2003", billDate: daysFromNow(-15), dueDate: daysFromNow(15), amountOpen: 6300, status: "open" },
            { companyId: cid, vendorName: "City Fleet Fuel Services", billNo: "BILL-2004", billDate: daysFromNow(-10), dueDate: daysFromNow(20), amountOpen: 3200, status: "open" },
            { companyId: cid, vendorName: "SafeGuard Insurance Co", billNo: "BILL-2005", billDate: daysFromNow(-30), dueDate: daysFromNow(0), amountOpen: 4800, status: "open" },
            { companyId: cid, vendorName: "QuickPrint Office Supply", billNo: "BILL-2006", billDate: daysFromNow(-8), dueDate: daysFromNow(22), amountOpen: 950, status: "open" },
            { companyId: cid, vendorName: "National HVAC Supply", billNo: "BILL-2007", billDate: daysFromNow(0), dueDate: daysFromNow(30), amountOpen: 14500, status: "open" },
            { companyId: cid, vendorName: "ProParts Wholesale", billNo: "BILL-2008", billDate: daysFromNow(5), dueDate: daysFromNow(35), amountOpen: 7800, status: "open" },
            // Overdue
            { companyId: cid, vendorName: "City Fleet Fuel Services", billNo: "BILL-2009", billDate: daysFromNow(-45), dueDate: daysFromNow(-15), amountOpen: 2100, daysPastDue: 15, status: "open" },
        ],
    });

    // ── Assumptions ───────────────────────────────────────────────────
    await prisma.assumption.create({
        data: {
            companyId: cid,
            bufferMin: 15000,
            fixedWeeklyOutflow: 3200,
            payrollCadence: "biweekly",
            payrollAllInAmount: 24000,
            payrollNextDate: weeksFromNow(1),
            rentMonthlyAmount: 4500,
            rentDayOfMonth: 1,
            paymentCurveJson: JSON.stringify({ current: 0, "1-14": 1, "15-30": 2, "31-60": 3, "61+": 4 }),
            highRiskAgingDays: 61,
        },
    });

    // ── Bank Account & Transactions ───────────────────────────────────
    const bankAccount = await prisma.bankAccount.create({
        data: { companyId: cid, name: "Main Checking" },
    });

    // Generate ~6 months of realistic bank transactions
    const bankTxs: Array<{
        companyId: string;
        accountId: string;
        txDate: Date;
        amount: number;
        description: string;
        direction: string;
        txHash: string;
    }> = [];

    function txHash(date: Date, amount: number, desc: string): string {
        const normalized = desc.toUpperCase().replace(/[^A-Z ]/g, "").replace(/\s+/g, " ").trim();
        return `${date.toISOString().slice(0, 10)}|${amount}|${normalized}`;
    }

    // Payroll pattern (biweekly, ~$24k)
    for (let w = 0; w < 12; w++) {
        const dt = daysFromNow(-14 * w - 7);
        const amt = 23500 + Math.round(Math.random() * 1000);
        const desc = "ADP PAYROLL";
        bankTxs.push({ companyId: cid, accountId: bankAccount.id, txDate: dt, amount: amt, description: desc, direction: "outflow", txHash: txHash(dt, amt, desc) });
    }

    // Rent pattern (monthly, ~$4500)
    for (let m = 0; m < 6; m++) {
        const dt = new Date();
        dt.setMonth(dt.getMonth() - m);
        dt.setDate(1);
        dt.setHours(0, 0, 0, 0);
        const amt = 4500;
        const desc = "ACH DEBIT APEX PROPERTY MGMT RENT";
        bankTxs.push({ companyId: cid, accountId: bankAccount.id, txDate: dt, amount: amt, description: desc, direction: "outflow", txHash: txHash(dt, amt, desc) });
    }

    // Amex card payment (monthly, ~$3200)
    for (let m = 0; m < 6; m++) {
        const dt = new Date();
        dt.setMonth(dt.getMonth() - m);
        dt.setDate(15);
        dt.setHours(0, 0, 0, 0);
        const amt = 2800 + Math.round(Math.random() * 800);
        const desc = "AMEX EPAYMENT ACH PMT";
        bankTxs.push({ companyId: cid, accountId: bankAccount.id, txDate: dt, amount: amt, description: desc, direction: "outflow", txHash: txHash(dt, amt, desc) });
    }

    // Insurance (monthly)
    for (let m = 0; m < 6; m++) {
        const dt = new Date();
        dt.setMonth(dt.getMonth() - m);
        dt.setDate(10);
        dt.setHours(0, 0, 0, 0);
        const amt = 1850;
        const desc = "SAFEGUARD INS CO PREMIUM";
        bankTxs.push({ companyId: cid, accountId: bankAccount.id, txDate: dt, amount: amt, description: desc, direction: "outflow", txHash: txHash(dt, amt, desc) });
    }

    // Variable fuel (weekly-ish)
    for (let w = 0; w < 24; w++) {
        const dt = daysFromNow(-7 * w - Math.floor(Math.random() * 3));
        const amt = 350 + Math.round(Math.random() * 200);
        const desc = w % 2 === 0 ? "SHELL OIL 12345" : "EXXON STATION 678";
        bankTxs.push({ companyId: cid, accountId: bankAccount.id, txDate: dt, amount: amt, description: desc, direction: "outflow", txHash: txHash(dt, amt, desc) });
    }

    // Inflow patterns (customer payments, semi-regular)
    for (let w = 0; w < 12; w++) {
        const dt = daysFromNow(-7 * w - Math.floor(Math.random() * 5));
        const amt = 8000 + Math.round(Math.random() * 15000);
        const desc = ["METRO CONST DEP", "SUNRISE PMT", "CITYWIDE REN DEP", "DELTA IND PMT"][w % 4];
        bankTxs.push({ companyId: cid, accountId: bankAccount.id, txDate: dt, amount: amt, description: desc, direction: "inflow", txHash: txHash(dt, amt, desc) });
    }

    await prisma.bankTransaction.createMany({ data: bankTxs });

    // ── Recurring Patterns (pre-detected from bank data) ──────────────
    await prisma.recurringPattern.createMany({
        data: [
            {
                companyId: cid,
                direction: "outflow",
                merchantKey: "ADP PAYROLL",
                displayName: "Payroll (ADP)",
                typicalAmount: 24000,
                amountStdDev: 500,
                cadence: "biweekly",
                nextExpectedDate: weeksFromNow(1),
                confidence: "high",
                category: "payroll",
                isIncluded: true,
                isCritical: true,
            },
            {
                companyId: cid,
                direction: "outflow",
                merchantKey: "APEX PROPERTY MGMT RENT",
                displayName: "Office Rent",
                typicalAmount: 4500,
                amountStdDev: 0,
                cadence: "monthly",
                nextExpectedDate: (() => { const dt = new Date(); dt.setMonth(dt.getMonth() + 1); dt.setDate(1); dt.setHours(0, 0, 0, 0); return dt; })(),
                confidence: "high",
                category: "rent",
                isIncluded: true,
                isCritical: true,
            },
            {
                companyId: cid,
                direction: "outflow",
                merchantKey: "AMEX EPAYMENT ACH PMT",
                displayName: "Amex Card Payment",
                typicalAmount: 3200,
                amountStdDev: 400,
                cadence: "monthly",
                nextExpectedDate: (() => { const dt = new Date(); dt.setMonth(dt.getMonth() + 1); dt.setDate(15); dt.setHours(0, 0, 0, 0); return dt; })(),
                confidence: "med",
                category: "card_payment",
                isIncluded: true,
                isCritical: false,
            },
            {
                companyId: cid,
                direction: "outflow",
                merchantKey: "SAFEGUARD INS CO PREMIUM",
                displayName: "Insurance Premium",
                typicalAmount: 1850,
                amountStdDev: 0,
                cadence: "monthly",
                nextExpectedDate: (() => { const dt = new Date(); dt.setMonth(dt.getMonth() + 1); dt.setDate(10); dt.setHours(0, 0, 0, 0); return dt; })(),
                confidence: "high",
                category: "subscription",
                isIncluded: true,
                isCritical: false,
            },
        ],
    });

    console.log(`✅ Demo company "${company.name}" seeded (id: ${cid})`);
    console.log(`   AR: 12 invoices, AP: 9 bills`);
    console.log(`   Bank: ${bankTxs.length} transactions`);
    console.log(`   Recurring patterns: 4 detected`);
}

main()
    .catch((e) => {
        console.error("Seed failed:", e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
