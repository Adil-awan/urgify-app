const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const categories = await prisma.category.findMany();
  console.log('Categories:', categories);
  const users = await prisma.user.count();
  console.log('User count:', users);
  process.exit(0);
}
main();
