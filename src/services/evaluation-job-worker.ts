import prisma from "@/db/prisma";
import { evaluateMaturedCheckpoints } from "./canonical-evaluator";

export async function processEvaluationJobs(companyIdFilter?: string) {
    let jobsProcessed = 0;
    while (true) {
        // Atomic claiming of a pending or expired running job
        const claimedJobs = companyIdFilter 
            ? await prisma.$queryRaw<{ id: string, companyId: string }[]>`
                UPDATE "EvaluationJob"
                SET 
                    status = 'running',
                    "claimedBy" = 'worker-node',
                    "claimExpiresAt" = NOW() + INTERVAL '10 minutes',
                    "startedAt" = NOW(),
                    "attemptCount" = "attemptCount" + 1
                WHERE id = (
                    SELECT id FROM "EvaluationJob"
                    WHERE "companyId" = ${companyIdFilter} 
                      AND (status = 'pending' OR (status = 'running' AND "claimExpiresAt" < NOW()))
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
                RETURNING id, "companyId";
            `
            : await prisma.$queryRaw<{ id: string, companyId: string }[]>`
                UPDATE "EvaluationJob"
                SET 
                    status = 'running',
                    "claimedBy" = 'worker-node',
                    "claimExpiresAt" = NOW() + INTERVAL '10 minutes',
                    "startedAt" = NOW(),
                    "attemptCount" = "attemptCount" + 1
                WHERE id = (
                    SELECT id FROM "EvaluationJob"
                    WHERE status = 'pending' 
                       OR (status = 'running' AND "claimExpiresAt" < NOW())
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
                RETURNING id, "companyId";
            `;

        if (!claimedJobs || claimedJobs.length === 0) {
            break; // No more jobs to process
        }

        const job = claimedJobs[0];
        
        try {
            // Process the evaluation for the specific company
            await evaluateMaturedCheckpoints(job.companyId);

            // Mark job as completed
            await prisma.evaluationJob.update({
                where: { id: job.id },
                data: {
                    status: 'completed',
                    completedAt: new Date(),
                    claimExpiresAt: null
                }
            });
        } catch (error) {
            console.error(`Error processing EvaluationJob ${job.id}:`, error);
            
            // Mark job as failed and allow retry if under limit
            const failedJob = await prisma.evaluationJob.findUnique({ where: { id: job.id } });
            if (failedJob && failedJob.attemptCount < 3) {
                await prisma.evaluationJob.update({
                    where: { id: job.id },
                    data: {
                        status: 'pending',
                        failureDetails: (error as Error).message,
                        retryAfter: new Date(Date.now() + 5 * 60 * 1000) // retry in 5 minutes
                    }
                });
            } else {
                await prisma.evaluationJob.update({
                    where: { id: job.id },
                    data: {
                        status: 'failed',
                        failedAt: new Date(),
                        failureDetails: (error as Error).message,
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
