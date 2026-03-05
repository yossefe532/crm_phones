import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const hash = await bcrypt.hash('admin123', 10);
const users = [
  { email: 'admin@edicon.com', name: 'Admin User', role: 'ADMIN' },
  { email: 'admin@crm.com', name: 'Admin User', role: 'ADMIN' },
];

for (const user of users) {
  await prisma.user.upsert({
    where: { email: user.email },
    update: {
      name: user.name,
      role: user.role,
      password: hash,
    },
    create: {
      ...user,
      password: hash,
    },
  });
}

await prisma.$disconnect();
console.log('ADMIN_RESET_OK');
