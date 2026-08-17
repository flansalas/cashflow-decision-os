import prisma from "@/db/prisma";
import { evaluateMaturedCheckpoints } from "./canonical-evaluator";

export async function processEvaluationJobs(companyId: string) {
    if (!companyId) throw new Error("Evaluation worker requires a companyId");

    let jobsProcessed = 0;
    while (true) {
        const claimedJobs = await prisma.$queryRaw<{ id: string, companyId: string }[]>`
            UPDATE "EvaluationJob"
            SET
                status = 'running',
                "claimedBy" = 'worker-node',
                "claimExpiresAt" = NOW() + INTERVAL '10 minutes',
                "startedAt" = NOW(),
                "retryAfter" = NULL,
                "attemptCount" = "attemptCount" + 1
            WHERE id = (
                SELECT id FROM "EvaluationJob"
                WHERE "companyId" = ${companyId}
                  AND (
                    (status = 'pending' AND ("retryAfter" IS NULL OR "retryAfter" <= NOW()))
                    OR (status = 'running' AND "claimExpiresAt" < NOW())
                  )
                ORDER BY "createdAt" ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            RETURNING id, "companyId";
        `;

        if (!claimedJobs || claimedJobs.length === 0) {
            break;
        }

        const job = claimedJobs[0];
        
        try {
            await evaluateMaturedCheckpoints(job.companyId);

            await prisma.evaluationJob.update({
                where: { id: job.id },
                data: {
                    status: 'completed',
                    completedAt: new Date(),
                    claimedBy: null,
                    claimExpiresAt: null,
                    retryAfter: null,
                    failureDetails: null
                }
            });
        } catch (error) {
            console.error(`Error processing EvaluationJob ${job.id}:`, error);

            const failureDetails = error instanceof Error ? error.message : String(error);
            const failedJob = await prisma.evaluationJob.findUnique({ where: { id: job.id } });
            if (failedJob && failedJob.attemptCount < 3) {
                await prisma.evaluationJob.update({
                    where: { id: job.id },
                    data: {
                        status: 'pending',
                        claimedBy: null,
                        claimExpiresAt: null,
                        failureDetails,
                        retryAfter: new Date(Date.now() + 5 * 60 * 1000)
                    }
                });
            } else {
                await prisma.evaluationJob.update({
                    where: { id: job.id },
                    data: {
                        status: 'failed',
                        failedAt: new Date(),
                        claimedBy: null,
                        failureDetails,
                        claimExpiresAt: null
                    }
                });
            }
        }
        
        jobsProcessed++;
    }
    return jobsProcessed;
}

export async function triggerEvaluation(companyId: string, source: string, sourceId?: string, txClient?: any) {
    // Generate a stable integer from the uuid for the advisory lock
    // For test purposes, we'll just use a generic lock ID based on the first few chars
    const lockId = parseInt(companyId.replace(/-/g, '').substring(0, 8), 16);

    const runLogic = async (tx: any) => {
        // Acquire transaction-level advisory lock
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockId})`;

        let job = await tx.evaluationJob.findFirst({
            where: {
                companyId,
                status: 'pending'
            }
        });

        if (!job) {
            job = await tx.evaluationJob.create({
                data: {
                    companyId,
                    status: 'pending'
                }
            });
        }

        // Always preserve the trigger event
        await tx.evaluationJobTrigger.create({
            data: {
                evaluationJobId: job.id,
                companyId,
                source,
                sourceId
            }
        });

        return job;
    };

    if (txClient) {
        return await runLogic(txClient);
    }
    return await prisma.$transaction(runLogic);
}
