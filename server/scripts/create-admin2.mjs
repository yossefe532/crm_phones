import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const run = async () => {
  const hash = await bcrypt.hash('admin123', 10);
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'crm2' },
    update: { name: 'CRM 2' },
    create: { name: 'CRM 2', slug: 'crm2' },
  });

  const admin = await prisma.user.upsert({
    where: { email: 'admin2@crm.com' },
    update: {
      name: 'CRM2 Admin',
      role: 'ADMIN',
      password: hash,
      tenantId: tenant.id,
      teamId: null,
    },
    create: {
      name: 'CRM2 Admin',
      email: 'admin2@crm.com',
      password: hash,
      role: 'ADMIN',
      tenantId: tenant.id,
    },
  });

  const templates = [
    { status: 'AGREED', content: 'السلام عليكم {customer_title} {customer_name}، تم تأكيد الموافقة.' },
    { status: 'HESITANT', content: 'السلام عليكم {customer_title} {customer_name}، هل تحتاج تفاصيل إضافية؟' },
    { status: 'REJECTED', content: 'شكراً لوقتك {customer_title} {customer_name}.' },
    { status: 'SPONSOR', content: 'شكراً لاهتمامك بالرعاية {customer_title} {customer_name}.' },
    { status: 'NO_ANSWER', content: 'حاولنا التواصل ولم يتم الرد يا {customer_title} {customer_name}.' },
  ];

  for (const template of templates) {
    await prisma.messageTemplate.upsert({
      where: { tenantId_status: { tenantId: tenant.id, status: template.status } },
      update: {},
      create: { ...template, tenantId: tenant.id },
    });
  }

  console.log(`ADMIN2_READY ${admin.email} tenant ${tenant.slug}`);
};

run()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
