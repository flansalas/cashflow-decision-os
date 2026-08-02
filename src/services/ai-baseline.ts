import OpenAI from "openai";
import prisma from "@/db/prisma";
import { BaselineVarianceLedger, Company } from "@prisma/client";
import { endOfWeek, startOfWeek, subWeeks } from "date-fns";

let openai: OpenAI | null = null;
try {
    openai = new OpenAI(); // Assumes OPENAI_API_KEY is in process.env
} catch (e) {
    console.warn("OPENAI_API_KEY not set. AI functions will fail gracefully.");
}
export interface AIBaselineResult {
    inflowFactors: number[];
    outflowFactors: number[];
    inflowExplanations: string[];
    outflowExplanations: string[];
    reasoningLog: string;
    weeklyInflowCoverage: number[];
    weeklyOutflowCoverage: number[];
    rawAiResponse: string;
    promptVersionHash: string;
    modelIdentifier: string;
}

export async function computeAIBaseline(
    companyId: string, 
    baselineInflowWeekly: number,
    baselineOutflowWeekly: number,
    paymentCurveJson: string,
    inflowDelayWeeks: number,
    outflowDelayWeeks: number
): Promise<AIBaselineResult | null> {
    try {
        if (!process.env.OPENAI_API_KEY) {
            console.warn("OPENAI_API_KEY not set. Skipping AI baseline accuracy layer.");
            return {
                inflowFactors: new Array(13).fill(1.0),
                outflowFactors: new Array(13).fill(1.0),
                inflowExplanations: new Array(13).fill("AI Error: OPENAI_API_KEY is not set in environment variables."),
                outflowExplanations: new Array(13).fill("AI Error: OPENAI_API_KEY is not set in environment variables."),
                reasoningLog: "AI Generation Failed: OPENAI_API_KEY is not set in environment variables.",
                weeklyInflowCoverage: new Array(13).fill(0),
                weeklyOutflowCoverage: new Array(13).fill(0),
                rawAiResponse: "{}",
                promptVersionHash: "v1.0.0-missing-key",
                modelIdentifier: "none"
            };
        }

        const company = await prisma.company.findUnique({ where: { id: companyId } });
        if (!company) return null;

        // 1. Fetch Pipeline context to calculate coverage 
        const currentMonday = startOfWeek(new Date(), { weekStartsOn: 1 });
        const endDate = endOfWeek(subWeeks(currentMonday, -12)); // 13 weeks out

        const invoices = await prisma.receivableInvoice.findMany({
            where: { companyId, dueDate: { gte: currentMonday, lte: endDate } }
        });
        
        const bills = await prisma.payableBill.findMany({
            where: { companyId, dueDate: { gte: currentMonday, lte: endDate } }
        });

        const weeklyInflowCoverage = new Array(13).fill(0);
        const weeklyOutflowCoverage = new Array(13).fill(0);

        for (let w = 0; w < 13; w++) {
            const wStart = subWeeks(currentMonday, -w);
            const wEnd = endOfWeek(wStart);
            
            const invSum = invoices
                .filter(i => i.dueDate && i.dueDate >= wStart && i.dueDate <= wEnd)
                .reduce((s, i) => s + i.amountOpen, 0);
                
            const billSum = bills
                .filter(b => b.dueDate && b.dueDate >= wStart && b.dueDate <= wEnd)
                .reduce((s, b) => s + b.amountOpen, 0);

            weeklyInflowCoverage[w] = baselineInflowWeekly > 0 ? Math.min(1.0, invSum / baselineInflowWeekly) : 0;
            weeklyOutflowCoverage[w] = baselineOutflowWeekly > 0 ? Math.min(1.0, billSum / baselineOutflowWeekly) : 0;
        }

        // 2. Assemble context: Last 8 weeks of variance memory
        const eightWeeksAgo = subWeeks(currentMonday, 8);
        
        const varianceLedger = await prisma.baselineVarianceLedger.findMany({
            where: {
                companyId,
                weekStart: { gte: eightWeeksAgo, lt: currentMonday }
            },
            orderBy: { weekStart: "desc" },
            take: 8
        });

        // Compute AR and AP reliance (Deterministic mock based on variance ledger rows)
        const varianceMemoryInfo = varianceLedger.map((v, i) => {
            // AR (Inflow)
            const actualTotalInflow = v.actualInflow ?? 0;
            const arRelianceFactor = 0.75 + ((i % 5) * 0.05); 
            const invoicedInflow = actualTotalInflow * arRelianceFactor;
            
            // AP (Outflow)
            const actualTotalOutflow = v.actualOutflow ?? 0;
            const apRelianceFactor = 0.80 + ((i % 3) * 0.05);
            const billedOutflow = actualTotalOutflow * apRelianceFactor;

            return `Week ${v.weekStart.toISOString().split('T')[0]}: 
- INFLOW: Total $${actualTotalInflow.toFixed(2)}, Estimated AR Portion $${invoicedInflow.toFixed(2)}
- OUTFLOW: Total $${actualTotalOutflow.toFixed(2)}, Estimated AP Portion $${billedOutflow.toFixed(2)}`;
        }).join("\n\n");

        const prompt = `
You are a quantitative AI agent acting as an expert financial controller for a cash flow forecasting application.
Your job is to review the deterministic mathematical forecast and correct its baseline assumptions based on historical context.

Company Name: ${company.name}
Historical Baseline Inflow (Weekly Average): $${baselineInflowWeekly.toFixed(2)}
Historical Baseline Outflow (Weekly Average): $${baselineOutflowWeekly.toFixed(2)}

The deterministic engine (Stage 1) has already reduced the baseline for each of the next 13 weeks based on Pipeline Coverage (how much of the historical baseline is already accounted for in known AR Invoices or AP Bills).

Here is the pipeline coverage ratio for the next 13 weeks (0 = no pipeline visibility, 1 = pipeline fully covers the baseline):
Inflow Coverage (AR): ${JSON.stringify(weeklyInflowCoverage)}
Outflow Coverage (AP): ${JSON.stringify(weeklyOutflowCoverage)}

Here is the company's "Variance Ledger" (memory) from the last 8 weeks:
${varianceMemoryInfo}

Company Payment Terms Context:
- Standard Payment Curve: ${paymentCurveJson}
- Average Inflow Collection Delay (DSO): ${inflowDelayWeeks} weeks
- Average Outflow Payment Delay (DPO): ${outflowDelayWeeks} weeks

### INSTRUCTIONS ###
1. **Accuracy Adjustments (Factors):** If the mathematical coverage gap-fill is contextually wrong, output a multiplier factor to override it (e.g. 0.0 to 1.5).
   - INFLOW NEAR-TERM (Weeks 1 to ${inflowDelayWeeks}): If AR coverage is very low for these upcoming weeks, it is highly likely that baseline revenue for those weeks is "ghost revenue" because it's too late to invoice and get paid due to their average ${inflowDelayWeeks}-week delay. Suppress it (factor 0.0 to 0.5).
   - INFLOW LONG-TERM (Weeks ${inflowDelayWeeks + 1} to 13): It is COMPLETELY NORMAL for there to be zero AR coverage in distant weeks. DO NOT suppress the baseline for distant weeks just because AR is missing. Keep the factor near 1.0.
   - OUTFLOW NEAR-TERM (Weeks 1 to ${outflowDelayWeeks}): If AP coverage is low, it is likely "ghost expenses" because they typically log bills ${outflowDelayWeeks} weeks in advance. Suppress it (factor 0.0 to 0.5).
   - OUTFLOW LONG-TERM (Weeks ${outflowDelayWeeks + 1} to 13): It is COMPLETELY NORMAL for there to be zero AP coverage in distant weeks. DO NOT suppress the baseline. Keep the factor near 1.0.
   - If the math is fine, return 1.0.
   - Return exactly 13 numbers for inflows and 13 for outflows.

2. **Articulation (Explanations):** Write a concise, professional tooltip explanation for each week's baseline number. DO NOT be overly simplistic. Reference the AR/AP pipeline coverage AND your historical reasoning.
   - Example (Near-Term Suppressed): "AI suppressed projected inflow: historical memory indicates 90% AR reliance, and current AR is completely empty for next week."
   - Example (Long-Term Kept): "AI maintained historical baseline average of $X to project long-term expected volume."

3. **Auditability (Reasoning Log):** Provide a dense, 2-3 sentence internal log explaining exactly which historical memory data points you used to justify any adjustments.

Respond strictly in the requested JSON format.
        `;

        const response = await openai!.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "baseline_result",
                    schema: {
                        type: "object",
                        properties: {
                            inflowFactors: { type: "array", items: { type: "number" } },
                            outflowFactors: { type: "array", items: { type: "number" } },
                            inflowExplanations: { type: "array", items: { type: "string" } },
                            outflowExplanations: { type: "array", items: { type: "string" } },
                            reasoningLog: { type: "string" }
                        },
                        required: ["inflowFactors", "outflowFactors", "inflowExplanations", "outflowExplanations", "reasoningLog"],
                        additionalProperties: false
                    },
                    strict: true
                }
            }
        });

        const rawText = response.choices[0].message.content;
        if (!rawText) return null;
        
        const parsed = JSON.parse(rawText) as AIBaselineResult;
        
        parsed.weeklyInflowCoverage = weeklyInflowCoverage;
        parsed.weeklyOutflowCoverage = weeklyOutflowCoverage;
        parsed.rawAiResponse = rawText;
        parsed.promptVersionHash = "v1.0.0"; // Placeholder versioning since prompt is inline
        parsed.modelIdentifier = "gpt-4o-mini";
        
        
        const ensureLength = <T,>(arr: T[], length: number, fillValue: T): T[] => {
            if (!arr || !Array.isArray(arr)) return new Array(length).fill(fillValue);
            if (arr.length > length) return arr.slice(0, length);
            if (arr.length < length) return [...arr, ...new Array(length - arr.length).fill(fillValue)];
            return arr;
        };

        // Safety bounds
        parsed.inflowFactors = ensureLength(parsed.inflowFactors, 13, 1.0);
        parsed.outflowFactors = ensureLength(parsed.outflowFactors, 13, 1.0);
        parsed.inflowExplanations = ensureLength(parsed.inflowExplanations, 13, "No explanation provided.");
        parsed.outflowExplanations = ensureLength(parsed.outflowExplanations, 13, "No explanation provided.");
        
        return parsed;

    } catch (e: any) {
        console.error("AI Baseline Generation Failed:", e);
        return null;
    }
}
