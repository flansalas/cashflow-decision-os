# Prisma Migration History and Baseline

This document explains the historical state of migrations in this repository and how to properly initialize new environments.

## The Ghost Migration

A historical migration named `20260701200739_add_execution_plan` exists in the repository but was **never applied** to the Neon production database (a "ghost" migration). It was likely committed by mistake during local development before production reached that state.

A later migration, `20260709011700_add_execution_plan_fields`, **was** successfully applied to Neon. This migration explicitly attempts to `CREATE TABLE` for the `ExecutionPlan` and `BaselineVarianceLedger` tables.

## The Existing Neon State

1. **Ghost Migration Absent**: `20260701200739_add_execution_plan` does not exist in Neon's `_prisma_migrations` table.
2. **Historical Checksum Intact**: The `20260709011700_add_execution_plan_fields` migration is recorded in Neon with its original, immutable checksum. Modifying its SQL in the repository would cause a checksum conflict.
3. **Current Schema Complete**: The Neon database already contains the required final `ExecutionPlan` tables.
4. **Future Changes**: Future schema changes on Neon must use **only forward-only migrations**. Do not attempt to rewrite historical migrations.

## Initializing a Clean Database

If you run `npx prisma migrate dev` on a completely clean database, Prisma will execute migrations lexicographically. It will execute the ghost migration (creating the tables), and then crash when it reaches `20260709011700_add_execution_plan_fields` because it will attempt to recreate them.

To safely initialize a new or clean database without altering immutable history, you must use the documented baseline procedure.

### The Baseline Procedure

Run the provided setup script:

```bash
./scripts/init-baselined-clean-db.sh
```

This script will:
1. Verify the target database is entirely empty.
2. Tell Prisma that the ghost migration is already resolved (`prisma migrate resolve --applied 20260701200739_add_execution_plan`), skipping its SQL.
3. Execute `prisma migrate deploy` to safely apply the remaining migrations (including the one that actually creates the tables).
4. Verify the resulting schema exactly matches the Prisma schema requirements.
