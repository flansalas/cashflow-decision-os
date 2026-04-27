import 'dotenv/config';
import { GET } from './src/app/api/dashboard/route';
import { NextRequest } from 'next/server';
import prisma from "./src/db/prisma";

async function run() {
    const cid = (await prisma.company.findFirst({ where: { name: { contains: "Cascio" } } }))?.id;
    const req = new NextRequest(`http://localhost:3000/api/dashboard?companyId=${cid}`);
    try {
        const res = await GET(req);
        const data = await res.json();
        console.log("CASCIO result length:", JSON.stringify(data).length);
        if (data.error) console.error("API ERROR:", data.error);
    } catch(err) {
        console.error("GET CRASHED", err);
    }
}
run();
