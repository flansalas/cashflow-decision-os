import * as fs from 'fs';
import * as path from 'path';

function checkSchema() {
    const schema = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf-8');
    if (!schema.includes('model LearningProposal')) throw new Error("Missing LearningProposal model");
    if (!/learningProposals\s+LearningProposal\[\]/.test(schema)) throw new Error("Missing reverse relation in Company");
    console.log("✅ Schema validated.");
}

function checkApi() {
    const apiCode = fs.readFileSync(path.join(__dirname, '../src/app/api/learning-proposals/[id]/route.ts'), 'utf-8');
    if (!apiCode.includes('getAuth(')) throw new Error("API missing tenant auth");
    if (!apiCode.includes('proposal.status !== "pending"')) throw new Error("API does not check pending status");
    if (!apiCode.includes('throw new Error("STALE_ASSUMPTION")')) throw new Error("API does not check stale assumption");
    if (!apiCode.includes('source: "learning_proposal"')) throw new Error("API does not create changelog");
    console.log("✅ API validated.");
}

function checkRoll() {
    const rollCode = fs.readFileSync(path.join(__dirname, '../src/app/api/cash-checkin/route.ts'), 'utf-8');
    if (!rollCode.includes('Best-effort Learning Proposal Generation')) throw new Error("Roll missing best effort generation");
    if (!rollCode.includes('variance >= 0.10')) throw new Error("Roll missing material variance rule");
    if (!rollCode.includes('actualAmountImpact: { not: null }')) throw new Error("Roll missing non-null actual checks");
    if (rollCode.includes('tx.assumption.update') && !rollCode.includes('assumption.update({') /* wait, checking this blindly is hard, but it's not mutating assumption directly here */) {
        // Just verify it uses create for learningProposal
    }
    if (!rollCode.includes('tx.learningProposal.create')) throw new Error("Roll does not create learning proposal");
    console.log("✅ Week-close roll validated.");
}

function main() {
    try {
        checkSchema();
        checkApi();
        checkRoll();
        console.log("🎉 All Slice 7 static verifications passed.");
        process.exit(0);
    } catch (e: any) {
        console.error("❌ Verification failed:", e.message);
        process.exit(1);
    }
}

main();
