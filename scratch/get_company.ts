import "dotenv/config";
import prisma from "@/db/prisma";
async function run() {
    const companies = await prisma.company.findMany({ include: { baselineSnapshot: true, cashSnapshots: true } });
    console.log(companies.map(c => ({ id: c.id, name: c.name, hasBaseline: c.baselineSnapshot !== null, hasCash: c.cashSnapshots.length > 0 })));
}
run().catch(console.error);
