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
  const assignTeamLeadSafely = async (teamId, leadId) => {
    if (!leadId) return;
    await prisma.$transaction(async (tx) => {
      await tx.team.updateMany({
        where: { leadId, id: { not: teamId } },
        data: { leadId: null },
      });
      await tx.team.update({
        where: { id: teamId },
        data: { leadId },
      });
    });
  };
  if (cairoLead) {
    await assignTeamLeadSafely(cairoTeam.id, cairoLead.id);
  }
  if (alexLead) {
    await assignTeamLeadSafely(alexTeam.id, alexLead.id);
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
        dailyInterestedTarget: 10,
        isActive: true,
      },
    });
  }

  // Default Templates
  const defaultTemplates = [
    { status: 'INTERESTED', content: 'شكراً يا {customer_title} {customer_name} على اهتمامك. مع حضرتك {user_name}، وهبعت لك التفاصيل كاملة وخطوة المتابعة القادمة.' },
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

  const defaultFaqs = [
    {
      type: 'CALL_SUPPORT',
      question: 'كيف أستخدم FAQ أثناء المكالمة؟',
      answer: 'ادخل صفحة "إضافة عميل جديد" وستجد قسم "FAQ سريع أثناء المكالمة" بأسئلة جاهزة. اختر السؤال المناسب لعرض الإجابة فورًا وتوجيه العميل بسرعة.',
      category: 'FAQ',
      sortOrder: 1,
    },
    {
      type: 'SYSTEM_GUIDE',
      question: 'من المسؤول عن تحديث الأسئلة الشائعة؟',
      answer: 'إدارة FAQ متاحة الآن لكل من ADMIN وTEAM_LEAD من شاشة "إدارة FAQ"، ويمكنهم إضافة سؤال جديد أو تعديل الإجابات أو إخفاء العناصر غير المناسبة.',
      category: 'FAQ',
      sortOrder: 2,
    },
    {
      type: 'CALL_SUPPORT',
      question: 'ما الفرق بين الحالة INTERESTED و AGREED؟',
      answer: 'INTERESTED تعني أن العميل مهتم ويحتاج متابعة، أما AGREED فتعني موافقة واضحة ونهائية على الخطوة المطلوبة.',
      category: 'الحالات',
      sortOrder: 3,
    },
    {
      type: 'SYSTEM_GUIDE',
      question: 'كيف أرسل اقتراحًا لتحسين النظام؟',
      answer: 'من صفحة "الاقتراحات" اكتب اقتراحك بشكل واضح وسيصل مباشرة للإدارة. يمكن متابعة حالة الرد من نفس الصفحة.',
      category: 'الاقتراحات',
      sortOrder: 4,
    },
    {
      type: 'SYSTEM_GUIDE',
      question: 'أين أجد الأهداف اليومية للمكالمات والمهتمين؟',
      answer: 'ستجد الأهداف اليومية في لوحة التحكم، وتشمل: المكالمات، المهتمين، والموافقات مع عرض المنجز والمتبقي لكل مؤشر.',
      category: 'التارجت',
      sortOrder: 5,
    },
  ];

  const tenants = [ediconTenant, crmTenant];
  for (const tenant of tenants) {
    for (const faq of defaultFaqs) {
      await prisma.fAQ.upsert({
        where: {
          id: (
            await prisma.fAQ.findFirst({
              where: { tenantId: tenant.id, question: faq.question },
              select: { id: true },
            })
          )?.id || -1,
        },
        update: {
          type: faq.type,
          answer: faq.answer,
          category: faq.category,
          sortOrder: faq.sortOrder,
          isPublished: true,
        },
        create: {
          tenantId: tenant.id,
          type: faq.type,
          question: faq.question,
          answer: faq.answer,
          category: faq.category,
          sortOrder: faq.sortOrder,
          isPublished: true,
        },
      });
    }
  }

  const defaultSalesTips = [
    {
      title: 'ابدأ بسؤال اكتشاف واضح',
      content: 'ابدأ المكالمة بسؤال مباشر: "إيه أهم نتيجة حضرتك عايز توصل لها؟" ثم اربط العرض بهذه النتيجة.',
      category: 'الافتتاح',
      sortOrder: 1,
      sourceType: 'MANUAL',
    },
    {
      title: 'اعرض خيارين بدل سؤال مفتوح',
      content: 'عند التردد، قدّم خيارين واضحين للخطوة التالية بدل ترك القرار مفتوحاً بالكامل.',
      category: 'التعامل مع الاعتراض',
      sortOrder: 2,
      sourceType: 'MANUAL',
    },
  ];

  for (const tenant of tenants) {
    for (const tip of defaultSalesTips) {
      const existing = await prisma.salesTip.findFirst({
        where: { tenantId: tenant.id, title: tip.title },
        select: { id: true },
      });
      if (existing) {
        await prisma.salesTip.update({
          where: { id: existing.id },
          data: {
            content: tip.content,
            category: tip.category,
            sortOrder: tip.sortOrder,
            sourceType: tip.sourceType,
            isPublished: true,
          },
        });
      } else {
        await prisma.salesTip.create({
          data: {
            tenantId: tenant.id,
            title: tip.title,
            content: tip.content,
            category: tip.category,
            sortOrder: tip.sortOrder,
            sourceType: tip.sourceType,
            isPublished: true,
          },
        });
      }
    }
  }

  const defaultReleaseNotes = [
    {
      title: 'تحديث جديد: إدارة FAQ والاقتراحات',
      version: 'v1.7.0',
      body: [
        'تم إضافة تحسينات مهمة لدعم الفريق أثناء العمل اليومي:',
        '',
        '• إدارة FAQ أصبحت أسهل، ويمكن لـ ADMIN وTEAM_LEAD إضافة/تعديل/حذف الأسئلة الشائعة.',
        '• قسم FAQ يظهر داخل شاشة إضافة العميل لمساعدة الموظف على الرد السريع أثناء المكالمة.',
        '• تم تفعيل تدفق الاقتراحات بحيث يقدر أي عضو يرسل اقتراحاته من صفحة "الاقتراحات" ومتابعة الرد عليها.',
        '',
        'هذه التحسينات تقلل وقت الرد على العملاء وترفع جودة التواصل داخل الفريق.',
      ].join('\n'),
    },
  ];

  for (const tenant of tenants) {
    for (const note of defaultReleaseNotes) {
      const existing = await prisma.releaseNote.findFirst({
        where: { tenantId: tenant.id, title: note.title },
        select: { id: true },
      });
      if (existing) {
        await prisma.releaseNote.update({
          where: { id: existing.id },
          data: {
            body: note.body,
            version: note.version,
            isPublished: true,
            publishedAt: new Date(),
          },
        });
      } else {
        await prisma.releaseNote.create({
          data: {
            tenantId: tenant.id,
            title: note.title,
            body: note.body,
            version: note.version,
            isPublished: true,
            publishedAt: new Date(),
          },
        });
      }
    }
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
