import { PrismaClient } from "@prisma/client";
import { computeForecast } from "./src/services/forecast";
const prisma = new PrismaClient();

async function run() {
    const cid = "some-company-id"; // need to get a real one
    const company = await prisma.company.findFirst();
    if(!company) return console.log("No company");
    console.log("Using company:", company.id);
    
    // duplicate the logic from route.ts to capture the exact error
    // ...
}
run();
