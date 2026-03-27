import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
    console.log('Clearing database...')

    // The order matters for foreign key constraints if not using CASCADE, 
    // but since we have onDelete: Cascade on almost everything, 
    // deleting Companies should take out most of it.
    // However, it's safer to delete everything explicitly or use a raw query.

    // SQLite doesn't support TRUNCATE, so we use DELETE.
    const tables = [
        'CompanyNote', 'CashSnapshot', 'CashAdjustment', 'CustomerProfile',
        'VendorProfile', 'ReceivableInvoice', 'PayableBill', 'Assumption',
        'BankAccount', 'BankTransaction', 'RecurringPattern', 'MappingProfile',
        'Override', 'ChangeLog', 'ForecastWeek', 'ActionItem', 'ScenarioItem',
        'Company'
    ]

    for (const table of tables) {
        // @ts-ignore
        await prisma[table.charAt(0).toLowerCase() + table.slice(1)].deleteMany({})
        console.log(`Cleared ${table}`)
    }

    console.log('Database cleared successfully.')
}

main()
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
