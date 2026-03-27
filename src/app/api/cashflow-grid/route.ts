// api/cashflow-grid/route.ts — returns invoices, bills, recurring, and week metadata for the grid
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import {
    getMonday, addWeeks, addDays, isInWeek,
    computeExpectedPaymentDate, parsePaymentCurve,
    type ForecastInvoice, type ForecastBill,
} from "@/services/forecast";

export async function GET(req: NextRequest) {
    const companyId = req.nextUrl.searchParams.get("companyId");

    let company;
    if (companyId) {
        company = await prisma.company.findUnique({ where: { id: companyId } });
    } else {
        company = await prisma.company.findFirst({ where: { isDemo: true } });
    }
    if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

    const cid = company.id;

    const [
        cashSnapshot,
        cashAdjustments,
        invoicesRaw,
        billsRaw,
        customerProfiles,
        vendorProfiles,
        assumptionRaw,
        overrides,
        recurringPatternsRaw,
    ] = await Promise.all([
        prisma.cashSnapshot.findFirst({ where: { companyId: cid }, orderBy: { asOfDate: "desc" } }),
        prisma.cashAdjustment.findMany({ where: { companyId: cid } }),
        prisma.receivableInvoice.findMany({ where: { companyId: cid } }),
        prisma.payableBill.findMany({ where: { companyId: cid } }),
        prisma.customerProfile.findMany({ where: { companyId: cid } }),
        prisma.vendorProfile.findMany({ where: { companyId: cid } }),
        prisma.assumption.findFirst({ where: { companyId: cid } }),
        prisma.override.findMany({ where: { companyId: cid, status: "active" } }),
        prisma.recurringPattern.findMany({ where: { companyId: cid } }),
    ]);

    if (!cashSnapshot) {
        return NextResponse.json({ error: "No cash snapshot found" }, { status: 400 });
    }


    const assumptions = assumptionRaw ?? {
        paymentCurveJson: '{"current":0,"1-14":1,"15-30":2,"31-60":3,"61+":4}',
        highRiskAgingDays: 61,
        payrollAllInAmount: null as number | null,
        payrollNextDate: null as Date | null,
        payrollCadence: "biweekly",
        rentMonthlyAmount: null as number | null,
        rentDayOfMonth: null as number | null,
    };


    const today = cashSnapshot.asOfDate;
    const currentMonday = getMonday(today);
    const paymentCurve = parsePaymentCurve(assumptions.paymentCurveJson);

    // Build 13-week timeline
    const weeks = Array.from({ length: 13 }, (_, w) => {
        const weekStart = addWeeks(currentMonday, w);
        const weekEnd = addDays(weekStart, 6);
        return {
            weekNumber: w + 1,
            weekStart: weekStart.toISOString(),
            weekEnd: weekEnd.toISOString(),
        };
    });

    // Override lookup
    const overridesByTarget = new Map<string, typeof overrides>();
    for (const ov of overrides) {
        if (ov.targetId) {
            if (!overridesByTarget.has(ov.targetId)) overridesByTarget.set(ov.targetId, []);
            overridesByTarget.get(ov.targetId)!.push(ov);
        }
    }

    // Customer/vendor lookup
    const customerMap = new Map(customerProfiles.map(c => [c.customerName, c]));
    const vendorMap = new Map(vendorProfiles.map(v => [v.vendorName, v]));

    // ─── Enrich invoices ──────────────────────────────────────────────────
    const enrichedInvoices = invoicesRaw
        .filter(inv => inv.status === "open")
        .map(inv => {
            const cp = customerMap.get(inv.customerName);
            const ovs = overridesByTarget.get(inv.id) || [];

            let markedPaid = false;
            let overrideExpectedDate: Date | null = null;
            let overrideAmount: number | null = null;
            let partialPayment: number | null = null;

            for (const ov of ovs) {
                if (ov.type === "mark_paid") markedPaid = true;
                if (ov.type === "set_expected_payment_date" && ov.effectiveDate) overrideExpectedDate = ov.effectiveDate;
                if (ov.type === "adjust_amount" && ov.amount != null) overrideAmount = ov.amount;
                if (ov.type === "partial_payment" && ov.amount != null) partialPayment = ov.amount;
            }

            if (markedPaid) return null;

            const forecastInv: ForecastInvoice = {
                id: inv.id,
                customerName: inv.customerName,
                invoiceNo: inv.invoiceNo,
                amountOpen: inv.amountOpen,
                invoiceDate: inv.invoiceDate,
                dueDate: inv.dueDate,
                daysPastDue: inv.daysPastDue,
                status: inv.status,
                metaJson: inv.metaJson,
                typicalDelayWeeks: cp?.typicalDelayWeeks,
                riskTag: cp?.riskTag,
                overrideExpectedDate,
                overrideAmount,
                markedPaid,
                partialPayment,
            };

            let amount = inv.amountOpen;
            if (overrideAmount != null) amount = overrideAmount;
            if (partialPayment != null) amount = Math.max(0, amount - partialPayment);
            if (amount <= 0) return null;

            const { date: expectedDate, confidence } = computeExpectedPaymentDate(forecastInv, today, paymentCurve);

            // Find effective week
            let effectiveWeek: number | null = null;
            for (let w = 0; w < 13; w++) {
                const weekStart = addWeeks(currentMonday, w);
                const weekEnd = addDays(weekStart, 6);
                if (isInWeek(expectedDate, weekStart, weekEnd)) {
                    effectiveWeek = w + 1;
                    break;
                }
            }

            // Count how many times this item has been moved (number of override records)
            const moveCount = ovs.filter(o => o.type === "set_expected_payment_date").length;

            // Days past due relative to today
            const dueDaysAgo = inv.dueDate
                ? Math.floor((today.getTime() - new Date(inv.dueDate).getTime()) / 86400000)
                : null;

            return {
                id: inv.id,
                customerName: inv.customerName,
                invoiceNo: inv.invoiceNo,
                amountOpen: amount,
                originalAmount: inv.amountOpen,
                invoiceDate: inv.invoiceDate?.toISOString() ?? null,
                dueDate: inv.dueDate?.toISOString() ?? null,
                daysPastDue: dueDaysAgo,
                expectedDate: expectedDate.toISOString(),
                effectiveWeek,
                overrideDate: overrideExpectedDate?.toISOString() ?? null,
                riskTag: cp?.riskTag ?? "low",
                confidence,
                moveCount,
                kind: "ar" as const,
            };
        })
        .filter(Boolean);

    // ─── Enrich bills ─────────────────────────────────────────────────────
    const enrichedBills = billsRaw
        .filter(bill => bill.status === "open")
        .map(bill => {
            const vp = vendorMap.get(bill.vendorName);
            const ovs = overridesByTarget.get(bill.id) || [];

            let markedPaid = false;
            let overrideDueDate: Date | null = null;
            let overrideAmount: number | null = null;

            for (const ov of ovs) {
                if (ov.type === "mark_paid") markedPaid = true;
                if (ov.type === "delay_due_date" && ov.effectiveDate) overrideDueDate = ov.effectiveDate;
                if (ov.type === "set_bill_due_date" && ov.effectiveDate) overrideDueDate = ov.effectiveDate;
                if (ov.type === "adjust_amount" && ov.amount != null) overrideAmount = ov.amount;
            }

            if (markedPaid) return null;

            let amount = bill.amountOpen;
            if (overrideAmount != null) amount = overrideAmount;
            if (amount <= 0) return null;

            let billDueDate: Date;
            if (overrideDueDate) {
                billDueDate = new Date(overrideDueDate);
            } else if (bill.dueDate) {
                billDueDate = new Date(bill.dueDate);
            } else if (bill.billDate) {
                billDueDate = addDays(new Date(bill.billDate), 30);
            } else {
                billDueDate = addDays(today, 7);
            }

            let effectiveWeek: number | null = null;
            for (let w = 0; w < 13; w++) {
                const weekStart = addWeeks(currentMonday, w);
                const weekEnd = addDays(weekStart, 6);
                if (isInWeek(billDueDate, weekStart, weekEnd)) {
                    effectiveWeek = w + 1;
                    break;
                }
            }

            // Count how many times this bill has been moved
            const moveCount = ovs.filter(o => o.type === "set_bill_due_date" || o.type === "delay_due_date").length;

            // Days past due relative to today
            const originalDue = bill.dueDate ? new Date(bill.dueDate) : null;
            const dueDaysAgo = originalDue
                ? Math.floor((today.getTime() - originalDue.getTime()) / 86400000)
                : null;

            return {
                id: bill.id,
                vendorName: bill.vendorName,
                billNo: bill.billNo,
                amountOpen: amount,
                originalAmount: bill.amountOpen,
                billDate: bill.billDate?.toISOString() ?? null,
                dueDate: bill.dueDate?.toISOString() ?? null,
                daysPastDue: dueDaysAgo,
                effectiveDate: billDueDate.toISOString(),
                effectiveWeek,
                overrideDate: overrideDueDate?.toISOString() ?? null,
                criticality: vp?.criticality ?? "normal",
                moveCount,
                kind: "ap" as const,
            };
        })
        .filter(Boolean);

    // ─── Recurring patterns → weekly sums ─────────────────────────────────
    const weeklyRecurringOutflows: number[] = new Array(13).fill(0);
    const weeklyRecurringInflows: number[] = new Array(13).fill(0);

    for (const rec of recurringPatternsRaw) {
        if (!rec.isIncluded) continue;
        if (!rec.nextExpectedDate) continue;

        let d = new Date(rec.nextExpectedDate);
        const endDate = addWeeks(currentMonday, 13);

        while (d <= endDate) {
            for (let w = 0; w < 13; w++) {
                const weekStart = addWeeks(currentMonday, w);
                const weekEnd = addDays(weekStart, 6);
                if (isInWeek(d, weekStart, weekEnd)) {
                    if (rec.direction === "outflow") weeklyRecurringOutflows[w] += rec.typicalAmount;
                    else weeklyRecurringInflows[w] += rec.typicalAmount;
                    break;
                }
            }
            if (rec.cadence === "weekly") d = addDays(d, 7);
            else if (rec.cadence === "biweekly") d = addDays(d, 14);
            else if (rec.cadence === "monthly") {
                const next = new Date(d);
                next.setMonth(next.getMonth() + 1);
                d = next;
            } else break;
        }
    }

    // ─── Payroll assumption (synthetic) → matches computeForecast logic ───
    // Only add if there is no detected payroll pattern already included
    const hasPayrollPattern = recurringPatternsRaw.some(rp => rp.category === "payroll" && rp.isIncluded);
    if (!hasPayrollPattern && assumptions.payrollAllInAmount && assumptions.payrollNextDate) {
        let d = new Date(assumptions.payrollNextDate);
        const cadence = assumptions.payrollCadence || "biweekly";
        const endDate = addWeeks(currentMonday, 13);
        while (d <= endDate) {
            for (let w = 0; w < 13; w++) {
                const weekStart = addWeeks(currentMonday, w);
                const weekEnd = addDays(weekStart, 6);
                if (isInWeek(d, weekStart, weekEnd)) {
                    weeklyRecurringOutflows[w] += assumptions.payrollAllInAmount!;
                    break;
                }
            }
            if (cadence === "weekly") d = addDays(d, 7);
            else if (cadence === "biweekly") d = addDays(d, 14);
            else if (cadence === "monthly") { const n = new Date(d); n.setMonth(n.getMonth() + 1); d = n; }
            else break;
        }
    }

    // ─── Rent assumption (synthetic) → matches computeForecast logic ──────
    if (assumptions.rentMonthlyAmount && assumptions.rentDayOfMonth) {
        const day = assumptions.rentDayOfMonth;
        const endDate = addWeeks(currentMonday, 13);
        let d = new Date(currentMonday);
        d.setDate(day);
        if (d < currentMonday) d.setMonth(d.getMonth() + 1);
        while (d <= endDate) {
            for (let w = 0; w < 13; w++) {
                const weekStart = addWeeks(currentMonday, w);
                const weekEnd = addDays(weekStart, 6);
                if (isInWeek(d, weekStart, weekEnd)) {
                    weeklyRecurringOutflows[w] += assumptions.rentMonthlyAmount!;
                    break;
                }
            }
            const next = new Date(d);
            next.setMonth(next.getMonth() + 1);
            d = next;
        }
    }

    const bankBalance = cashSnapshot.bankBalance;
    const adjustmentsTotal = cashAdjustments.reduce((s, a) => s + a.amount, 0);
    const openingCash = bankBalance + adjustmentsTotal;

    return NextResponse.json({
        companyId: cid,
        openingCash,
        weeks,
        invoices: enrichedInvoices,
        bills: enrichedBills,
        weeklyRecurringOutflows: weeklyRecurringOutflows.map((total, i) => ({ weekNumber: i + 1, total })),
        weeklyRecurringInflows: weeklyRecurringInflows.map((total, i) => ({ weekNumber: i + 1, total })),
    });
}
