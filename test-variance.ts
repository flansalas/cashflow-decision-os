import prisma from "./src/db/prisma";

async function check() {
    const cid = "ep-lucky-salad-anvg05zg";
    const rows = await prisma.baselineVarianceLedger.findMany({
        where: { companyId: cid },
        orderBy: { weekStart: "desc" },
        take: 3
    });
    console.log(JSON.stringify(rows, null, 2));

    const checkpoints = await prisma.forecastCheckpoint.findMany({
        where: { companyId: cid },
        orderBy: { weekEnd: "desc" }, 
        take: 2
    });
    console.log("Checkpoints:");
    console.log(JSON.stringify(checkpoints, null, 2));
}

check().finally(() => prisma.$disconnect());
