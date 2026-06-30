import "dotenv/config";
import fs from "fs";
import path from "path";
import readline from "readline";
import { NextRequest } from "next/server";
import prisma from "../src/db/prisma";
import { POST } from "../src/app/api/cash-checkin/route";

// Argument parser helper
function parseArgs() {
    const args = process.argv.slice(2);
    const cmd = args[0];
    const opts: Record<string, string> = {};
    for (let i = 1; i < args.length; i++) {
        if (args[i].startsWith("--")) {
            const key = args[i].substring(2);
            const val = args[i+1];
            if (val && !val.startsWith("--")) {
                opts[key] = val;
                i++;
            } else {
                opts[key] = "true";
            }
        }
    }
    return { cmd, opts };
}

// Prod protection helper
function checkProdProtection(cmd: string) {
    if (cmd === "execute" || cmd === "rollback") {
        const dbUrl = process.env.DATABASE_URL || "";
        const isProd = dbUrl.includes("neon.tech") || dbUrl.includes("prod");
        if (isProd && process.env.ALLOW_PROD_ROLL_HARNESS !== "true") {
            console.error("ERROR: Production database detected. Aborting.");
            console.error("To override, set ALLOW_PROD_ROLL_HARNESS=true in your environment.");
            process.exit(1);
        }
    }
}

// Audit file helper
function writeAudit(companyId: string, cmd: string, data: any) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = path.join(process.cwd(), "roll-audits", companyId);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const filepath = path.join(dir, `${cmd}-${ts}.json`);
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    console.log(`Audit saved to: ${filepath}`);
}

async function preview(opts: any) {
    const { companyId, bankBalance, asOfDate } = opts;
    if (!companyId || !bankBalance || !asOfDate) {
        console.error("Usage: preview --companyId <id> --bankBalance <num> --asOfDate <date>");
        process.exit(1);
    }

    console.log(`=== PREVIEW WEEKLY ROLL for Company: ${companyId} ===`);

    const reqUrl = `http://localhost/api/dashboard?companyId=${companyId}`;
    const req = new NextRequest(reqUrl);
    const dashboardRoute = await import("../src/app/api/dashboard/route");
    const dashRes = await dashboardRoute.GET(req);
    if (!dashRes.ok) {
        console.error("Failed to load dashboard data:", await dashRes.text());
        process.exit(1);
    }
    const dashData = await dashRes.json();

    const priorWeekForecast = dashData.forecast?.weeks?.[0];
    if (!priorWeekForecast) {
        console.error("No prior week forecast found in dashboard data.");
        process.exit(1);
    }

    const snapshotDate = new Date(asOfDate);
    const isSaturday = snapshotDate.getUTCDay() === 6;
    const weekStart = new Date(priorWeekForecast.weekStart);
    const weekEnd = new Date(priorWeekForecast.weekEnd);

    const bankTxsCount = await prisma.bankTransaction.count({
        where: {
            companyId,
            txDate: { gte: weekStart, lte: weekEnd }
        }
    });

    const bankDataMissing = bankTxsCount === 0;
    
    let expectedSnapshotSource = "client_observed_v1";
    let warningMsg = null;

    if (!isSaturday) {
        warningMsg = "Rolling the week requires your bank balance as of Saturday night. Using today's balance will skew your variance analysis.";
        expectedSnapshotSource = "client_observed_unverified";
    }
    if (bankDataMissing) {
        expectedSnapshotSource = "client_observed_unverified";
    }

    const auditData = {
        companyId,
        command: "preview",
        timestamp: new Date().toISOString(),
        weekEnding: weekEnd.toISOString(),
        bankBalance: Number(bankBalance),
        asOfDate,
        expectedCheckpointSource: expectedSnapshotSource,
        bankDataMissing,
        warning: warningMsg,
        priorWeekForecast: priorWeekForecast,
        expectedLedgerCreation: !bankDataMissing
    };

    console.log(JSON.stringify(auditData, null, 2));
    writeAudit(companyId, "preview", auditData);
}

async function execute(opts: any) {
    const { companyId, bankBalance, asOfDate } = opts;
    if (!companyId || !bankBalance || !asOfDate) {
        console.error("Usage: execute --companyId <id> --bankBalance <num> --asOfDate <date>");
        process.exit(1);
    }

    console.log(`=== EXECUTE WEEKLY ROLL for Company: ${companyId} ===`);
    const executionStartedAt = new Date();

    const reqUrl = `http://localhost/api/dashboard?companyId=${companyId}`;
    const reqGet = new NextRequest(reqUrl);
    const dashboardRoute = await import("../src/app/api/dashboard/route");
    const dashRes = await dashboardRoute.GET(reqGet);
    const dashData = await dashRes.json();

    const priorWeekForecast = dashData.forecast?.weeks?.[0];

    const body = {
        companyId,
        bankBalance: Number(bankBalance),
        asOfDate,
        priorWeekForecast
    };

    const reqPost = new NextRequest("http://localhost/api/cash-checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    const checkinRes = await POST(reqPost);
    const checkinData = await checkinRes.json();

    console.log("Check-in Result:", JSON.stringify(checkinData, null, 2));

    // Inspect records created
    const createdSnapshot = await prisma.cashSnapshot.findFirst({
        where: { companyId, createdAt: { gte: executionStartedAt } },
        orderBy: { createdAt: "desc" }
    });

    const createdCheckpoint = createdSnapshot ? await prisma.forecastCheckpoint.findFirst({
        where: { companyId, cashSnapshotId: createdSnapshot.id, createdAt: { gte: executionStartedAt } }
    }) : null;

    const createdLedger = await prisma.baselineVarianceLedger.findFirst({
        where: { companyId, createdAt: { gte: executionStartedAt } },
        orderBy: { createdAt: "desc" }
    });

    const createdChangeLog = await prisma.changeLog.findFirst({
        where: { companyId, timestamp: { gte: executionStartedAt } },
        orderBy: { timestamp: "desc" }
    });

    const auditData = {
        companyId,
        command: "execute",
        timestamp: new Date().toISOString(),
        executionStartedAt: executionStartedAt.toISOString(),
        apiResult: checkinData,
        createdRecords: {
            snapshotId: createdSnapshot?.id,
            checkpointId: createdCheckpoint?.id,
            ledgerId: createdLedger?.id,
            changeLogId: createdChangeLog?.id
        }
    };

    writeAudit(companyId, "execute", auditData);
}

async function inspect(opts: any) {
    const { companyId } = opts;
    if (!companyId) {
        console.error("Usage: inspect --companyId <id>");
        process.exit(1);
    }

    console.log(`=== INSPECT LATEST WEEKLY ROLL for Company: ${companyId} ===`);

    const latestSnapshot = await prisma.cashSnapshot.findFirst({
        where: { companyId },
        orderBy: { createdAt: "desc" }
    });

    let latestCheckpoint = null;
    if (latestSnapshot) {
        latestCheckpoint = await prisma.forecastCheckpoint.findFirst({
            where: { companyId, cashSnapshotId: latestSnapshot.id }
        });
    }

    const latestLedger = await prisma.baselineVarianceLedger.findFirst({
        where: { companyId },
        orderBy: { createdAt: "desc" }
    });

    const latestChangeLog = await prisma.changeLog.findFirst({
        where: { companyId },
        orderBy: { timestamp: "desc" }
    });

    const auditData = {
        companyId,
        command: "inspect",
        timestamp: new Date().toISOString(),
        latestRecords: {
            snapshot: latestSnapshot,
            checkpoint: latestCheckpoint,
            ledger: latestLedger,
            changeLog: latestChangeLog
        }
    };

    console.log(JSON.stringify(auditData, null, 2));
    writeAudit(companyId, "inspect", auditData);
}

async function rollback(opts: any) {
    const { companyId, snapshotId, ledgerId, changeLogId } = opts;
    if (!companyId || !snapshotId) {
        console.error("Usage: rollback --companyId <id> --snapshotId <id> [--ledgerId <id>] [--changeLogId <id>]");
        process.exit(1);
    }

    console.log(`=== ROLLBACK PREPARATION for Company: ${companyId} ===`);

    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
        console.error("ERROR: Company not found.");
        process.exit(1);
    }

    const recordsToDelete: any = {};

    const snapshot = await prisma.cashSnapshot.findUnique({ where: { id: snapshotId } });
    if (!snapshot || snapshot.companyId !== companyId) {
        console.error(`ERROR: snapshotId ${snapshotId} not found or belongs to another company.`);
        process.exit(1);
    }
    recordsToDelete.snapshot = snapshot;

    // --- ORPHAN PREVENTION ---
    const checkpoint = await prisma.forecastCheckpoint.findUnique({ where: { cashSnapshotId: snapshotId } });
    if (checkpoint) {
        const relatedLedgers = await prisma.baselineVarianceLedger.findMany({
            where: { companyId, weekStart: checkpoint.weekStart }
        });
        const missingLedgers = relatedLedgers.filter((l: any) => l.id !== ledgerId);
        if (missingLedgers.length > 0) {
            console.error("ERROR: Possible orphaned BaselineVarianceLedger records detected for this weekStart.");
            console.error("You must include these ledger IDs in your command:");
            missingLedgers.forEach((l: any) => console.error(`  --ledgerId ${l.id}`));
            process.exit(1);
        }
    }

    const snapshotCreatedAt = snapshot.createdAt.getTime();
    const relatedLogs = await prisma.changeLog.findMany({
        where: {
            companyId,
            timestamp: {
                gte: new Date(snapshotCreatedAt - 5000),
                lte: new Date(snapshotCreatedAt + 5000)
            }
        }
    });
    const missingLogs = relatedLogs.filter((l: any) => l.id !== changeLogId);
    if (missingLogs.length > 0) {
        console.error("ERROR: Possible orphaned ChangeLog records detected near this snapshot's creation time.");
        console.error("You must include these changeLog IDs in your command:");
        missingLogs.forEach((l: any) => console.error(`  --changeLogId ${l.id}`));
        process.exit(1);
    }
    // --- END ORPHAN PREVENTION ---

    if (ledgerId) {
        const ledger = await prisma.baselineVarianceLedger.findUnique({ where: { id: ledgerId } });
        if (!ledger || ledger.companyId !== companyId) {
            console.error(`ERROR: ledgerId ${ledgerId} not found or belongs to another company.`);
            process.exit(1);
        }
        recordsToDelete.ledger = ledger;
    }

    if (changeLogId) {
        const changeLog = await prisma.changeLog.findUnique({ where: { id: changeLogId } });
        if (!changeLog || changeLog.companyId !== companyId) {
            console.error(`ERROR: changeLogId ${changeLogId} not found or belongs to another company.`);
            process.exit(1);
        }
        recordsToDelete.changeLog = changeLog;
    }

    console.log("Records to delete:", JSON.stringify(recordsToDelete, null, 2));

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const confirmText = `ROLLBACK WEEK ${companyId}`;
    rl.question(`To confirm, type exactly: '${confirmText}': `, async (answer) => {
        if (answer.trim() !== confirmText) {
            console.log("Aborting rollback.");
            rl.close();
            process.exit(1);
        }

        console.log("Executing rollback...");

        // Order is important
        if (ledgerId) await prisma.baselineVarianceLedger.delete({ where: { id: ledgerId } });
        if (changeLogId) await prisma.changeLog.delete({ where: { id: changeLogId } });
        // Deleting CashSnapshot cascades to ForecastCheckpoint
        await prisma.cashSnapshot.delete({ where: { id: snapshotId } });

        console.log("Rollback successful.");
        
        const auditData = {
            companyId,
            command: "rollback",
            timestamp: new Date().toISOString(),
            deletedRecords: recordsToDelete
        };
        writeAudit(companyId, "rollback", auditData);

        rl.close();
    });
}

async function main() {
    const { cmd, opts } = parseArgs();
    checkProdProtection(cmd);

    try {
        if (cmd === "preview") await preview(opts);
        else if (cmd === "execute") await execute(opts);
        else if (cmd === "inspect") await inspect(opts);
        else if (cmd === "rollback") await rollback(opts);
        else {
            console.log("Unknown command. Valid commands: preview, execute, inspect, rollback");
        }
    } catch (e) {
        console.error("Error:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
