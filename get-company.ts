import prisma from "./src/db/prisma";
async function run() {
    const c = await prisma.company.findFirst({ where: { name: { contains: "Cascio" } } });
    console.log("COMPANY_ID=" + c?.id);
}
run();
