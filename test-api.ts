import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function run() {
    const c = await prisma.company.findFirst({ where: { name: { contains: "Cascio" } } });
    console.log(c?.id);
}
run();
