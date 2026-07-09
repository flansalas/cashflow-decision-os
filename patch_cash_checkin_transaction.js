const fs = require('fs');
let code = fs.readFileSync('src/app/api/cash-checkin/route.ts', 'utf8');

// The `coreResult` transaction currently looks like:
// const changeLog = await tx.changeLog.create({ ... });
// return { snapshot, changeLogId: changeLog.id };

code = code.replace(
    /return \{ snapshot, changeLogId: changeLog\.id \};\n        \}\);/m,
    `
            // ── Mark ExecutionPlan as Reviewed inside the atomic transaction ───────
            if (executionPlanId) {
                await tx.executionPlan.update({
                    where: { id: executionPlanId, companyId },
                    data: {
                        status: "executed",
                        reviewedAt: new Date(),
                        actualEndingCash: bankBalance // Fixed semantic: exactly the entered actual balance
                    }
                });
            } else if (priorWeekForecast?.weekStart) {
                // Fallback: find the latest plan for the rolled week
                const plans = await tx.executionPlan.findMany({
                    where: { companyId, weekStart: new Date(priorWeekForecast.weekStart) },
                    orderBy: { version: 'desc' },
                    take: 1
                });
                if (plans.length > 0) {
                    await tx.executionPlan.update({
                        where: { id: plans[0].id },
                        data: {
                            status: "executed",
                            reviewedAt: new Date(),
                            actualEndingCash: bankBalance // Fixed semantic
                        }
                    });
                }
            }

            return { snapshot, changeLogId: changeLog.id };
        });`
);

fs.writeFileSync('src/app/api/cash-checkin/route.ts', code);
