import 'dotenv/config';
import { GET } from './src/app/api/dashboard/route';
import { NextRequest } from 'next/server';

async function run() {
    // Fake the incoming request
    const req = new NextRequest("http://localhost:3000/api/dashboard?companyId=4feb3d21-eede-4b1e-a32b-b62a3ba92d9f");
    try {
        const res = await GET(req);
        const data = await res.json();
        console.log(data);
    } catch(err) {
        console.error("GET CRASHED", err);
    }
}
run();
