import 'dotenv/config';
import { GET } from './src/app/api/dashboard/route';
import { NextRequest } from 'next/server';
import prisma from "./src/db/prisma";

async function run() {
    const companies = await prisma.company.findMany();
    for (const c of companies) {
        const req = new NextRequest(`http://localhost:3000/api/dashboard?companyId=${c.id}`);
        try {
            const res = await GET(req);
            const data = await res.json();
            if (data.error) {
                console.error("FAILED Company:", c.name, "Error:", data.error);
            } else {
                console.log("SUCCESS Company:", c.name);
            }
        } catch(err) {
            console.error("CRASH Company:", c.name, err);
        }
    }
}
run();
