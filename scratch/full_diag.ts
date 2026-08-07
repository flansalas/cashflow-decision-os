console.log("\n=== 13 WEEK FORECAST ===");
result.weeks.forEach((w, i) => {
    console.log(`Week ${i+1}: Start: ${w.startCash.toFixed(2)} | In: ${w.inflowsExpected.toFixed(2)} | Out: ${w.outflowsExpected.toFixed(2)} | End: ${w.endCashExpected.toFixed(2)} | Best: ${w.bestCaseEnd?.toFixed(2)} | Worst: ${w.worstCaseEnd?.toFixed(2)}`);
});
    console.log("\n=== 13 WEEK FORECAST ===");
    result.weeks.forEach((w, i) => {
        console.log(`Week ${i+1}: Start: ${w.startCash.toFixed(2)} | In: ${w.inflowsExpected.toFixed(2)} | Out: ${w.outflowsExpected.toFixed(2)} | End: ${w.endCashExpected.toFixed(2)} | Best: ${w.bestCaseEnd.toFixed(2)} | Worst: ${w.worstCaseEnd.toFixed(2)}`);
    });
}
main().finally(() => prisma.$disconnect());
