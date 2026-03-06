import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { runPrismaBootstrap } from '../scripts/prisma-bootstrap.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
runPrismaBootstrap(dirname(__dirname));

const prisma = new PrismaClient();

async function main() {
  const adminPassword = await bcrypt.hash('admin123', 10);
  const salesPassword = await bcrypt.hash('sales123', 10);
  const leadPassword = await bcrypt.hash('lead123', 10);

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

  const cairoTeam = await prisma.team.upsert({
    where: { tenantId_name: { tenantId: ediconTenant.id, name: 'Cairo Team' } },
    update: {},
    create: { name: 'Cairo Team', tenantId: ediconTenant.id },
  });
  const alexTeam = await prisma.team.upsert({
    where: { tenantId_name: { tenantId: crmTenant.id, name: 'Alex Team' } },
    update: {},
    create: { name: 'Alex Team', tenantId: crmTenant.id },
  });

  const seedUsers = [
    { email: 'admin@edicon.com', name: 'Edicon Admin', password: adminPassword, role: 'ADMIN', tenantId: ediconTenant.id },
    { email: 'lead.cairo@edicon.com', name: 'Cairo Team Lead', password: leadPassword, role: 'TEAM_LEAD', teamId: cairoTeam.id, tenantId: ediconTenant.id },
    { email: 'sales@edicon.com', name: 'Sales Agent', password: salesPassword, role: 'SALES', teamId: cairoTeam.id, tenantId: ediconTenant.id },
    { email: 'admin@crm.com', name: 'CRM Admin', password: adminPassword, role: 'ADMIN', tenantId: crmTenant.id },
    { email: 'lead.alex@crm.com', name: 'Alex Team Lead', password: leadPassword, role: 'TEAM_LEAD', teamId: alexTeam.id, tenantId: crmTenant.id },
    { email: 'sales@crm.com', name: 'Sales Agent', password: salesPassword, role: 'SALES', teamId: alexTeam.id, tenantId: crmTenant.id },
  ];

  const users = [];
  for (const userData of seedUsers) {
    const user = await prisma.user.upsert({
      where: { email: userData.email },
      update: {
        name: userData.name,
        password: userData.password,
        role: userData.role,
        teamId: userData.teamId || null,
        tenantId: userData.tenantId,
      },
      create: userData,
    });
    users.push(user);
  }

  const cairoLead = users.find((item) => item.email === 'lead.cairo@edicon.com');
  const alexLead = users.find((item) => item.email === 'lead.alex@crm.com');
  if (cairoLead) {
    await prisma.team.update({
      where: { id: cairoTeam.id },
      data: { leadId: cairoLead.id },
    });
  }
  if (alexLead) {
    await prisma.team.update({
      where: { id: alexTeam.id },
      data: { leadId: alexLead.id },
    });
  }

  for (const user of users.filter((item) => item.role === 'SALES')) {
    await prisma.employeeProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        department: 'Sales',
        jobTitle: 'Sales Agent',
        timezone: 'Africa/Cairo',
        dailyCallTarget: 30,
        isActive: true,
      },
    });
  }

  // Default Templates
  const defaultTemplates = [
    { status: 'AGREED', content: 'السلام عليكم {customer_title} {customer_name}، مع حضرتك {user_name} من إيديكون. تم تأكيد موافقتك، وبرجاء إرسال التفاصيل النهائية.' },
    { status: 'REJECTED', content: 'شكراً لوقتك {customer_title} {customer_name}، نتمنى لك التوفيق.' },
    { status: 'HESITANT', content: 'السلام عليكم {customer_title} {customer_name}، مع حضرتك {user_name}. حبيت أتابع مع حضرتك لو في أي استفسار.' },
    { status: 'SPONSOR', content: 'السلام عليكم {customer_title} {customer_name}، شكراً لاهتمامك بالرعاية. برجاء إرسال التفاصيل المطلوبة.' },
    { status: 'NO_ANSWER', content: 'السلام عليكم {customer_title} {customer_name}، حاولنا نتواصل مع حضرتك اليوم لكن ماكانش فيه رد. لو مناسب لحضرتك ابعتلنا وقت مناسب وهنكلمك فوراً.' },
  ];

  for (const t of defaultTemplates) {
    await prisma.messageTemplate.upsert({
      where: { tenantId_status: { tenantId: ediconTenant.id, status: t.status } },
      update: {},
      create: { ...t, tenantId: ediconTenant.id },
    });
    await prisma.messageTemplate.upsert({
      where: { tenantId_status: { tenantId: crmTenant.id, status: t.status } },
      update: {},
      create: { ...t, tenantId: crmTenant.id },
    });
  }

  console.log({ users });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
