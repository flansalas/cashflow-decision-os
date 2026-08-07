import prisma from "../src/db/prisma";

async function main() {
    const cid = "1a7b36f5-8fe0-4c2b-9336-8420846270b5";
    const snaps = await prisma.cashSnapshot.findMany({
        where: { companyId: cid },
        orderBy: [{ asOfDate: "desc" }]
    });
    console.log(snaps.map(s => ({ id: s.id, asOfDate: s.asOfDate })));
}
main().catch(console.error).finally(() => process.exit(0));
