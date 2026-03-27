import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";

const globalForPrisma = globalThis as unknown as {
    prisma?: PrismaClient;
};

function createPrismaClient() {
    const dbUrl = process.env.DATABASE_URL ?? "file:./dev.db";
    // Resolve "file:./dev.db" to absolute path from project root
    const filePath = dbUrl.replace(/^file:/, "");
    const absPath = path.resolve(process.cwd(), filePath);
    const adapter = new PrismaBetterSqlite3({ url: absPath });
    return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
}

export default prisma;
