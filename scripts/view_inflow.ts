import prisma from '../src/db/prisma'

async function check() {
   const rows = await prisma.recurringPattern.findMany({ 
       select: { id: true, displayName: true, direction: true, typicalAmount: true, isIncluded: true } 
   });
   console.log(JSON.stringify(rows, null, 2));
}
check().finally(() => prisma.$disconnect());
