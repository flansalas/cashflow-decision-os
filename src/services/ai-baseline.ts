import { GoogleGenAI, Type } from "@google/genai";
import prisma from "@/db/prisma";
import { BaselineVarianceLedger, Company } from "@prisma/client";
import { endOfWeek, startOfWeek, subWeeks } from "date-fns";

const ai = new GoogleGenAI({}); // Assumes GEMINI_API_KEY is in process.env

export interface AIBaselineResult {
    inflowFactors: number[];
    outflowFactors: number[];
    inflowExplanations: string[];
    outflowExplanations: string[];
    reasoningLog: string;
}

export async function computeAIBaseline(
    companyId: string, 
    baselineInflowWeekly: number,
    baselineOutflowWeekly: number
): Promise<AIBaselineResult | null> {
    try {
        if (!process.env.GEMINI_API_KEY) {
            console.warn("GEMINI_API_KEY not set. Skipping AI baseline accuracy layer.");
            return null;
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

        // Compute AR reliance
        const arRelianceInfo = varianceLedger.map(v => {
            const actualTotalInflow = v.actualInflow;
            const invoicedInflow = actualTotalInflow * (Math.random() * 0.2 + 0.8); // Mocking AR reliance for now until we add real fields
            return `Week ${v.weekStart.toISOString().split('T')[0]}: Total Variable Inflow $${actualTotalInflow}, Estimated AR Portion $${invoicedInflow.toFixed(2)}`;
        }).join("\n");

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
${arRelianceInfo}

### INSTRUCTIONS ###
1. **Accuracy Adjustments (Factors):** If the mathematical coverage gap-fill is contextually wrong, output a multiplier factor to override it. 
   - If the company relies heavily on AR (invoices), un-invoiced baseline in the near-term weeks is likely "ghost revenue" and should be suppressed (factor 0.0 to 0.5).
   - If coverage is 0 but historical memory shows they always get paid end of month, you might suppress weeks 1-3 and boost week 4.
   - If the math is fine, return 1.0.
   - Return exactly 13 numbers for inflows and 13 for outflows.

2. **Articulation (Explanations):** Write a concise, professional tooltip explanation for each week's baseline number. DO NOT be overly simplistic. Reference the AR/AP pipeline coverage AND your historical reasoning.
   - Example (AI Suppressed): "Projected inflow suppressed by AI; historical memory indicates 95% AR reliance, and current AR covers only 12% of baseline."
   - Example (Math Kept): "Projected inflow — AR covers 45% of historical baseline."

3. **Auditability (Reasoning Log):** Provide a dense, 2-3 sentence internal log explaining exactly which historical memory data points you used to justify any adjustments.

Respond strictly in the requested JSON format.
        `;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-pro",
            contents: prompt,
            config: {
                temperature: 0.1, // Keep it highly deterministic
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        inflowFactors: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "13 floats, default 1.0" },
                        outflowFactors: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "13 floats, default 1.0" },
                        inflowExplanations: { type: Type.ARRAY, items: { type: Type.STRING }, description: "13 strings" },
                        outflowExplanations: { type: Type.ARRAY, items: { type: Type.STRING }, description: "13 strings" },
                        reasoningLog: { type: Type.STRING, description: "Detailed audit log" }
                    },
                    required: ["inflowFactors", "outflowFactors", "inflowExplanations", "outflowExplanations", "reasoningLog"]
                }
            }
        });

        if (!response.text) return null;
        const parsed = JSON.parse(response.text) as AIBaselineResult;
        
        // Safety bounds
        if (parsed.inflowFactors.length !== 13) parsed.inflowFactors = new Array(13).fill(1.0);
        if (parsed.outflowFactors.length !== 13) parsed.outflowFactors = new Array(13).fill(1.0);
        
        return parsed;

    } catch (e) {
        console.error("AI Baseline Generation Failed:", e);
        return null;
    }
}
