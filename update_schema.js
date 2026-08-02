const fs = require('fs');
let schema = fs.readFileSync('prisma/schema.prisma', 'utf8');

// 1. Add fields and replace constraint in ForecastEvaluationObservation
const observationRegex = /(model ForecastEvaluationObservation \{[^}]+)(@@unique\(\[companyId, forecastCheckpointId, maturedWeekStart, horizonWeeks, model, direction, stage\]\))([^}]*\})/s;

if (observationRegex.test(schema)) {
  schema = schema.replace(observationRegex, `$1version              Int       @default(1)
  isLatest             Boolean   @default(true)
  supersededAt         DateTime?
  @@unique([companyId, forecastCheckpointId, maturedWeekStart, horizonWeeks, model, direction, stage, version])
  @@index([companyId, forecastCheckpointId, maturedWeekStart, horizonWeeks, model, direction, stage, isLatest], name: "idx_latest_observation")$3`);
} else {
  console.error("ForecastEvaluationObservation not found or couldn't match!");
}

// 2. Add models
const newModels = `
model EvaluationJob {
  id              String                 @id @default(uuid())
  companyId       String
  status          String                 @default("pending")
  claimedBy       String?
  claimExpiresAt  DateTime?
  attemptCount    Int                    @default(0)
  createdAt       DateTime               @default(now())
  startedAt       DateTime?
  completedAt     DateTime?
  failedAt        DateTime?
  failureDetails  String?
  retryAfter      DateTime?

  Company         Company                @relation(fields: [companyId], references: [id], onDelete: Cascade)
  EvaluationJobTrigger EvaluationJobTrigger[]

  @@index([companyId, status])
  @@index([status, claimExpiresAt])
}

model EvaluationJobTrigger {
  id              String        @id @default(uuid())
  evaluationJobId String
  companyId       String
  source          String
  sourceId        String?
  createdAt       DateTime      @default(now())

  EvaluationJob   EvaluationJob @relation(fields: [evaluationJobId], references: [id], onDelete: Cascade)
  Company         Company       @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@index([evaluationJobId])
}
`;
schema += newModels;

// 3. Add relations to Company model
// The Prisma pull might have capitalized things. Let's just let Prisma format it later if we need to.
const companyRegex = /(model Company \{[^\}]+)(^\})/m;
if (companyRegex.test(schema)) {
   schema = schema.replace(companyRegex, `$1  EvaluationJob EvaluationJob[]\n  EvaluationJobTrigger EvaluationJobTrigger[]\n$2`);
}

fs.writeFileSync('prisma/schema.prisma', schema);
console.log('Schema updated successfully');
