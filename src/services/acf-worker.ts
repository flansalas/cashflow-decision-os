import prisma from "@/db/prisma";
import { computeACF, detectDominantCadence } from "./acf";
import { normalizeDescription, categorize } from "./detectPatterns";

const MIN_OCCURRENCES = 3;
const MIN_AMOUNT = 25;

export async function runACFWorker(companyId: string) {
    console.log(`[ACF Worker] Starting background analysis for company: ${companyId}`);

    try {
        // 1. Fetch all outflows for the company
        const outflows = await prisma.bankTransaction.findMany({
            where: { 
                companyId,
                direction: "outflow",
                amount: { gte: MIN_AMOUNT }
            },
            select: {
                txDate: true,
                amount: true,
                description: true
            },
            orderBy: {
                txDate: 'asc'
            }
        });

        if (outflows.length === 0) {
            console.log(`[ACF Worker] No outflows found for company ${companyId}.`);
            return;
        }

        // 2. Group by merchant key
        const groups = new Map<string, { raw: string; amounts: number[]; dates: Date[] }>();

        for (const tx of outflows) {
            const key = normalizeDescription(tx.description);
            if (!key || key.length < 3) continue;

            if (!groups.has(key)) {
                groups.set(key, { raw: tx.description, amounts: [], dates: [] });
            }
            const g = groups.get(key)!;
            g.amounts.push(tx.amount);
            g.dates.push(new Date(tx.txDate));
        }

        // 3. Process each group
        let detectedCount = 0;
        
        for (const [key, data] of groups) {
            if (data.dates.length < MIN_OCCURRENCES) continue;

            // Generate daily time series
            const minDate = data.dates[0];
            const maxDate = data.dates[data.dates.length - 1];
            const daysSpan = Math.floor((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            
            // If the span is less than 5 days but we have 3 occurrences, it's not a recurring monthly/weekly pattern
            if (daysSpan < 5) continue;

            const timeSeries = new Array(daysSpan).fill(0);
            for (let i = 0; i < data.dates.length; i++) {
                const dayIndex = Math.floor((data.dates[i].getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));
                timeSeries[dayIndex] += data.amounts[i];
            }

            // 4. Run ACF
            const maxLag = Math.min(daysSpan - 1, 40); // check up to 40 days for monthly cadences
            if (maxLag < 5) continue;

            const acf = computeACF(timeSeries, maxLag);
            const dominantLag = detectDominantCadence(acf, 0.4); // slightly lower threshold for noisy data

            if (dominantLag) {
                // Determine cadence string
                let cadence: "weekly" | "biweekly" | "monthly" | "irregular" = "irregular";
                if (dominantLag >= 5 && dominantLag <= 9) cadence = "weekly";
                else if (dominantLag >= 10 && dominantLag <= 18) cadence = "biweekly";
                else if (dominantLag >= 25 && dominantLag <= 35) cadence = "monthly";
                
                if (cadence !== "irregular") {
                    // We found a strong signal!
                    
                    // Calculate typical amount (median)
                    const sortedAmounts = [...data.amounts].sort((a, b) => a - b);
                    const mid = Math.floor(sortedAmounts.length / 2);
                    const typicalAmount = sortedAmounts.length % 2 === 0
                        ? (sortedAmounts[mid - 1] + sortedAmounts[mid]) / 2
                        : sortedAmounts[mid];

                    // Project next date based on the lag and the last seen date
                    const nextExpectedDate = new Date(maxDate);
                    nextExpectedDate.setDate(nextExpectedDate.getDate() + dominantLag);

                    // Category
                    const category = categorize(data.raw);

                    // 5. Upsert into database
                    await prisma.recurringPattern.upsert({
                        where: {
                            companyId_merchantKey: {
                                companyId,
                                merchantKey: key
                            }
                        },
                        update: {
                            typicalAmount,
                            cadence,
                            nextExpectedDate,
                            category,
                            origin: "system", // flag that AI updated this
                            confidence: "high"
                        },
                        create: {
                            companyId,
                            merchantKey: key,
                            displayName: data.raw.substring(0, 50),
                            direction: "outflow",
                            typicalAmount,
                            cadence,
                            nextExpectedDate,
                            category,
                            origin: "system",
                            confidence: "high",
                            status: "active",
                            isIncluded: true,
                            isCritical: category === "payroll" || category === "rent" || category === "loan"
                        }
                    });

                    detectedCount++;
                }
            }
        }

        console.log(`[ACF Worker] Finished. Auto-detected and upserted ${detectedCount} patterns.`);
    } catch (error) {
        console.error(`[ACF Worker] Error running background task:`, error);
    }
}
