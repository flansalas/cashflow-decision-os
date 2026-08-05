import prisma from "./src/db/prisma";

async function run() {
    const company = await prisma.company.findUnique({
        where: { id: "bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb" }
    });
    console.log("Current company:", company);
}

run().catch(console.error).finally(() => prisma.$disconnect());
