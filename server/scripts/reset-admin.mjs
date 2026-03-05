import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const hash = await bcrypt.hash('admin123', 10);
const ediconTenant = await prisma.tenant.upsert({
  where: { slug: 'edicon' },
  update: { name: 'Edicon' },
  create: { name: 'Edicon', slug: 'edicon' },
});
const crmTenant = await prisma.tenant.upsert({
  where: { slug: 'crm' },
  update: { name: 'CRM' },
  create: { name: 'CRM', slug: 'crm' },
});
const users = [
  { email: 'admin@edicon.com', name: 'Edicon Admin', role: 'ADMIN', tenantId: ediconTenant.id },
  { email: 'admin@crm.com', name: 'CRM Admin', role: 'ADMIN', tenantId: crmTenant.id },
];

for (const user of users) {
  await prisma.user.upsert({
    where: { email: user.email },
    update: {
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
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
