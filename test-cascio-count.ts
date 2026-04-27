import 'dotenv/config';
import prisma from "./src/db/prisma";
async function run() {
    const companies = await prisma.company.findMany({ where: { name: { contains: "Cascio" } } });
    console.log(`Found ${companies.length} Cascio companies`);
    for (const c of companies) {
        console.log(c.id, c.name);
    }
}
run();
