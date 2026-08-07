import prisma from "../src/db/prisma";
import { mondayBefore } from "../src/services/baseline-shared";

async function main() {
    const adj = await prisma.cashAdjustment.findUnique({
        where: { id: "632e8043-f7f0-4328-92fc-25cb65b1f448" }
    });

    const now = new Date();
    const currentWeekStart = mondayBefore(now, 0);

    console.log(JSON.stringify({
        adjustment: adj,
        currentWeekStart: currentWeekStart.toISOString(),
    }, null, 2));
}

main().catch(console.error).finally(() => process.exit(0));
