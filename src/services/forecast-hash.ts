import prisma from "@/db/prisma";
import { assembleForecastData } from "@/services/forecast-assembly";

/**
 * Synchronously computes the forecast hash after a mutation and updates the target ChangeLog.
 * 
 * If the computation fails, this function catches the error, logs it, and marks the 
 * forecastVersionHashAfter as "error". It does not throw, ensuring the primary 
 * business mutation is preserved.
 * 
 * @param companyId The tenant ID.
 * @param changeLogId The ID of the ChangeLog record to update.
 */
export async function resolveForecastHashAfter(companyId: string, changeLogId: string): Promise<boolean> {
    if (!changeLogId) return false;

    try {
        const assembly = await assembleForecastData(companyId);
        const newHash = assembly.forecastResult.forecastVersionHash;
        
        await prisma.changeLog.update({
            where: { id: changeLogId },
            data: { forecastVersionHashAfter: newHash }
        });
        
        return true;
    } catch (error) {
        console.error("Failed to generate true post-mutation forecast hash:", error);
        
        // Ensure we never leave it as "pending"
        await prisma.changeLog.update({
            where: { id: changeLogId },
            data: { forecastVersionHashAfter: "error" }
        });
        
        return false;
    }
}
