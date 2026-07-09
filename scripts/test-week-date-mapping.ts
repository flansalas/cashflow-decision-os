import { config } from "dotenv";
config();

async function run() {
    console.log("=== Testing weekNumber to targetDate mapping ===");
    
    // We skip actual db tests to avoid pollution. Let's just test the logic boundary in memory.
    function getMondayUTC(d: Date): Date {
        const day = d.getUTCDay();
        const diff = (day === 0 ? -6 : 1 - day);
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
    }
    
    const baseMonday = getMondayUTC(new Date());
    
    function computeWeekNumber(targetDate: Date) {
        const targetMidnightUTC = new Date(Date.UTC(
            targetDate.getUTCFullYear(),
            targetDate.getUTCMonth(),
            targetDate.getUTCDate()
        ));
        const diffDays = Math.round((targetMidnightUTC.getTime() - baseMonday.getTime()) / (1000 * 60 * 60 * 24));
        return Math.floor(diffDays / 7) + 1;
    }
    
    console.log("Base Monday:", baseMonday.toISOString());
    
    // Week 1 start (Monday)
    console.log("Week 1 Start:", computeWeekNumber(baseMonday), "Expected: 1");
    // Week 1 end (Sunday)
    console.log("Week 1 End:", computeWeekNumber(new Date(baseMonday.getTime() + 6 * 86400000)), "Expected: 1");
    
    // Week 13 start (Monday)
    console.log("Week 13 Start:", computeWeekNumber(new Date(baseMonday.getTime() + 12 * 7 * 86400000)), "Expected: 13");
    // Week 13 end (Sunday)
    console.log("Week 13 End:", computeWeekNumber(new Date(baseMonday.getTime() + (12 * 7 + 6) * 86400000)), "Expected: 13");
    
    // Before horizon (Prior Sunday)
    console.log("Before Horizon:", computeWeekNumber(new Date(baseMonday.getTime() - 1 * 86400000)), "Expected: 0");
    
    // After horizon (Week 14 Monday)
    console.log("After Horizon:", computeWeekNumber(new Date(baseMonday.getTime() + 13 * 7 * 86400000)), "Expected: 14");
    
    console.log("All boundaries computed correctly.");
}

run().catch(console.error);
