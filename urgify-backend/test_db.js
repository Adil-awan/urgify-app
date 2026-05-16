const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  console.time('query');
  await prisma.user.findFirst();
  console.timeEnd('query');
}
main().catch(console.error).finally(() => prisma.$disconnect());
