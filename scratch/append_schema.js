const fs = require('fs');
let schema = fs.readFileSync('prisma/schema.prisma', 'utf8');

const additional = `
model DataReadinessAttestation {
  id              String    @id @default(uuid())
  companyId       String
  scopeType       String
  scopeKey        String?
  asOfDate        DateTime
  controlCount    Int?
  controlAmount   Float?
  sourceStateHash String
  evidenceJson    String
  certifiedBy     String
  certifiedAt     DateTime  @default(now())
  revokedAt       DateTime?
  status          String    @default("active")
  createdAt       DateTime  @default(now())
  company         Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@index([companyId, scopeType])
  @@index([companyId, status])
}

model CompanyDataReadinessCertification {
  id                   String              @id @default(uuid())
  companyId            String
  forecastCheckpointId String?
  evaluatedAt          DateTime            @default(now())
  asOfDate             DateTime
  expiresAt            DateTime?
  status               String
  schemaVersion        Int                 @default(1)
  evidenceJson         String
  blockingReasonsJson  String?
  certifiedBy          String?
  createdAt            DateTime            @default(now())
  company              Company             @relation(fields: [companyId], references: [id], onDelete: Cascade)
  forecastCheckpoint   ForecastCheckpoint? @relation(fields: [forecastCheckpointId], references: [id], onDelete: Cascade)

  @@index([companyId, status])
  @@index([forecastCheckpointId])
}
`;

if (!schema.includes('model CompanyDataReadinessCertification')) {
  fs.writeFileSync('prisma/schema.prisma', schema + '\n' + additional);
  console.log('Appended to schema.prisma');
} else {
  console.log('Already exists');
}
