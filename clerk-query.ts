import { clerkClient } from "@clerk/nextjs/server";

async function run() {
    try {
        const client = await clerkClient();
        const orgs = await client.organizations.getOrganizationList();
        console.log("All Organizations:");
        for (const org of orgs.data) {
            console.log(org.id, org.name);
        }
    } catch (e) {
        console.error(e);
    }
}
run();
