import * as fs from 'fs';
const schemaPath = 'prisma/schema.prisma';
let schema = fs.readFileSync(schemaPath, 'utf8');

schema = schema.replace(
  'matchMethod    String   @default("manual")',
  'matchMethod    String   @default("manual")\n  deductFrom     String?'
);

fs.writeFileSync(schemaPath, schema);
console.log('Updated schema.prisma');
