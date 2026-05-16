const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const categories = [
    { name: 'Electrician', icon: '🔌' },
    { name: 'Plumber', icon: '🚿' },
    { name: 'Mason', icon: '🏗️' },
    { name: 'Mechanic', icon: '🔧' },
    { name: 'Welder', icon: '🔨' },
    { name: 'Carpenter', icon: '🪚' },
    { name: 'Painter', icon: '🖌️' },
  ];

  console.log('Seeding categories...');

  for (const cat of categories) {
    await prisma.category.upsert({
      where: { name: cat.name },
      update: {},
      create: cat,
    });
  }

  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
