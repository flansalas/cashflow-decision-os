require('dotenv').config({path: '.env.vercel.preview'});
const fs = require('fs');

const dbUrl = process.env.DATABASE_URL || "";
let dbHost = "unknown";
try {
  if (dbUrl && dbUrl !== "[SENSITIVE]") {
    const url = new URL(dbUrl);
    dbHost = url.hostname;
  }
} catch (e) {
  dbHost = "invalid_url";
}

const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
const sk = process.env.CLERK_SECRET_KEY || "";

const summary = {
  dbHost,
  clerkPkPrefix: pk.substring(0, 15),
  clerkSkPrefix: sk.substring(0, 15),
  clerkEnvType: pk.includes("dev") || pk.includes("test") ? "Development/Test" : "Production",
};

fs.writeFileSync("summary.json", JSON.stringify(summary, null, 2));
