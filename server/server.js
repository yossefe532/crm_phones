import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { runPrismaBootstrap } from './scripts/prisma-bootstrap.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });
runPrismaBootstrap(__dirname);

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-this';
const LEAD_STATUSES = new Set(['NEW', 'INTERESTED', 'AGREED', 'REJECTED', 'HESITANT', 'SPONSOR', 'NO_ANSWER', 'RECONTACT']);
const LEAD_SOURCES = new Set(['CALL', 'SEND', 'POOL']);
const LEAD_GENDERS = new Set(['MALE', 'FEMALE', 'UNKNOWN']);
const USER_ROLES = new Set(['ADMIN', 'TEAM_LEAD', 'SALES']);
const MANAGEABLE_ROLES = new Set(['TEAM_LEAD', 'SALES']);
const POOL_SOURCE = 'POOL';
const POOL_STATUS = 'NEW';
const MAX_TEAM_LEADS_PER_TEAM = 2;
const DEFAULT_TEMPLATES = [
  { status: 'AGREED', content: 'السلام عليكم {customer_title} {customer_name}، مع حضرتك {user_name} من إيديكون. تم تأكيد موافقتك، وبرجاء إرسال التفاصيل النهائية.' },
  { status: 'REJECTED', content: 'شكراً لوقتك {customer_title} {customer_name}، نتمنى لك التوفيق.' },
  { status: 'HESITANT', content: 'السلام عليكم {customer_title} {customer_name}، مع حضرتك {user_name}. حبيت أتابع مع حضرتك لو في أي استفسار.' },
  { status: 'SPONSOR', content: 'السلام عليكم {customer_title} {customer_name}، شكراً لاهتمامك بالرعاية. برجاء إرسال التفاصيل المطلوبة.' },
  { status: 'NO_ANSWER', content: 'السلام عليكم {customer_title} {customer_name}، حاولنا نتواصل مع حضرتك اليوم لكن ماكانش فيه رد. لو مناسب لحضرتك ابعتلنا وقت مناسب وهنكلمك فوراً.' },
];
const CORS_ORIGIN = process.env.CORS_ORIGIN || '';
const allowedOrigins = CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);
const ASSISTANT_TRAINING_FILE = join(__dirname, 'assistant-training.json');

app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : true,
}));
app.use(express.json({ limit: '10mb' }));

console.log('Initializing Prisma Client...');
const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

// Auth Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access denied' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

const authorizeRole = (roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

const normalizeSingleQueryValue = (value) => {
  if (Array.isArray(value)) return value[0];
  return value;
};

const buildPoolWhere = (extra = {}) => ({
  agentId: null,
  source: POOL_SOURCE,
  status: POOL_STATUS,
  ...extra,
});

const parseInteger = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const parseDateTime = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeGender = (value) => {
  if (typeof value !== 'string') return 'UNKNOWN';
  const normalized = value.trim().toUpperCase();
  return LEAD_GENDERS.has(normalized) ? normalized : null;
};

const normalizeEgyptMobile = (value) => {
  if (typeof value !== 'string') return null;
  let digits = value.trim().replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^20[1235][0-9]{9}$/.test(digits)) return `0${digits.slice(2)}`;
  if (/^01[0125][0-9]{8}$/.test(digits)) return digits;
  return null;
};

const normalizeTeamName = (value) => normalizeNullableString(value, 120);
const generateManagedPassword = () => randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);

const assertTeamScopedUser = (user) => {
  if (!user?.teamId) {
    return 'User is not assigned to a team';
  }
  return null;
};

const parseOptionalTeamId = (value) => {
  if (typeof value === 'undefined' || value === null || value === '') return null;
  const parsed = parseInteger(value);
  return parsed && parsed > 0 ? parsed : null;
};

const assertTenantScopedUser = (user) => {
  if (!user?.tenantId) {
    return 'User is not assigned to a tenant';
  }
  return null;
};

const getCurrentUserScope = async (userId) => prisma.user.findUnique({
  where: { id: userId },
  select: {
    id: true,
    role: true,
    tenantId: true,
    tenant: { select: { id: true, name: true, slug: true } },
    teamId: true,
    team: { select: { id: true, name: true } },
  },
});

const normalizeNullableString = (value, maxLength = 120) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
};

const readAssistantTraining = () => {
  try {
    if (!existsSync(ASSISTANT_TRAINING_FILE)) return {};
    const parsed = JSON.parse(readFileSync(ASSISTANT_TRAINING_FILE, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
};

const writeAssistantTraining = (payload) => {
  try {
    writeFileSync(ASSISTANT_TRAINING_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  } catch {
    return null;
  }
  return true;
};

const extractNameFromTranscript = (transcript) => {
  if (typeof transcript !== 'string') return null;
  const text = transcript.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const patterns = [
    /(?:اسمي|انا اسمي|أنا اسمي|معاك|مع حضرتك)\s+([ء-يA-Za-z]{2,}(?:\s+[ء-يA-Za-z]{2,}){0,2})/i,
    /(?:my name is|this is|i am)\s+([A-Za-z]{2,}(?:\s+[A-Za-z]{2,}){0,2})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  const words = text.split(/[.,،!?]/)[0]?.trim().split(' ').filter(Boolean) || [];
  if (words.length >= 2 && words.length <= 3) {
    const candidate = words.join(' ');
    if (!/[0-9]/.test(candidate) && candidate.length >= 5) return candidate;
  }
  return null;
};

const buildFollowUpQuestions = ({ occupation, age, education, goals }) => {
  const questions = [];
  if (!occupation) questions.push('الشخص ده شغال في ايه حالياً؟');
  if (!age) questions.push('عمره كام تقريباً؟');
  if (!education) questions.push('بيدرس ايه أو مؤهله الدراسي ايه؟');
  if (!goals) questions.push('ايه أهم هدف عايز يوصله من الخدمة؟');
  questions.push('إيه أكبر مشكلة حالياً وعايز يحلها بسرعة؟');
  questions.push('الوقت المناسب للمتابعة امتى؟');
  return questions.slice(0, 6);
};

const fetchJsonWithTimeout = async (url, options = {}, timeoutMs = 3000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const fetchWebInsights = async (query) => {
  const normalizedQuery = normalizeNullableString(query, 180);
  if (!normalizedQuery) return [];
  const encoded = encodeURIComponent(normalizedQuery);
  const result = await fetchJsonWithTimeout(`https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`, {}, 2500);
  if (!result) return [];
  const insights = [];
  if (typeof result.AbstractText === 'string' && result.AbstractText.trim()) {
    insights.push(result.AbstractText.trim());
  }
  if (Array.isArray(result.RelatedTopics)) {
    for (const topic of result.RelatedTopics) {
      if (insights.length >= 3) break;
      if (typeof topic?.Text === 'string' && topic.Text.trim()) {
        insights.push(topic.Text.trim());
      }
    }
  }
  return insights.slice(0, 3);
};

const buildFallbackScript = ({ leadName, trainingTopic, trainingContext, occupation, age, education, goals, notes, webInsights }) => {
  const customerName = leadName || 'أستاذ العميل';
  const intro = `السلام عليكم ${customerName}، معاك فريق المبيعات.`;
  const profileLine = [
    occupation ? `طبيعة الشغل: ${occupation}` : null,
    age ? `السن: ${age}` : null,
    education ? `الخلفية التعليمية: ${education}` : null,
  ].filter(Boolean).join(' | ');
  const trainingLine = [trainingTopic, trainingContext].filter(Boolean).join(' - ');
  const goalLine = goals ? `الهدف الأساسي للعميل: ${goals}.` : 'هنحدد الهدف الرئيسي مع العميل في بداية المكالمة.';
  const notesLine = notes ? `ملاحظات من السيلز: ${notes}.` : 'لا توجد ملاحظات إضافية حالياً.';
  const webLine = webInsights.length
    ? `معلومة سريعة من البحث: ${webInsights[0]}`
    : 'مفيش نتائج بحث مؤكدة حالياً، اسأل العميل عن التفاصيل المباشرة.';
  const profileSection = profileLine ? `\n- ${profileLine}` : '';
  const trainingSection = trainingLine ? `\n- سياق التدريب: ${trainingLine}` : '';
  return `${intro}
ابدأ بالسؤال عن احتياجه الحالي ثم استخدم الخطوات التالية:
- كسر الجليد: ممكن تحكيلي بسرعة عن هدفك الأساسي الفترة دي؟
${goalLine}
${notesLine}
${webLine}${profileSection}${trainingSection}
- اقترح الحل المناسب حسب مستوى العميل ووقته.
- انهي المكالمة بخطوة واضحة: تحديد متابعة أو إرسال عرض مختصر على واتساب.`;
};

const generateScriptWithModel = async ({ leadName, trainingTopic, trainingContext, occupation, age, education, goals, notes, webInsights }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return buildFallbackScript({ leadName, trainingTopic, trainingContext, occupation, age, education, goals, notes, webInsights });
  }

  const prompt = `انت مساعد مبيعات عربي محترف. اكتب سكريبت مكالمة سريع وواضح باللهجة المصرية.
الاسم: ${leadName || 'غير متاح'}
المجال العام: ${trainingTopic || 'عام'}
سياق التدريب: ${trainingContext || 'غير متاح'}
الوظيفة: ${occupation || 'غير معروفة'}
السن: ${age || 'غير معروف'}
الدراسة: ${education || 'غير معروفة'}
الهدف: ${goals || 'غير معروف'}
ملاحظات: ${notes || 'لا يوجد'}
نتائج بحث: ${webInsights.join(' | ') || 'لا يوجد'}
المطلوب:
1) افتتاحية.
2) 5 اسئلة استكشاف.
3) طريقة عرض الحل.
4) اغلاق المكالمة بخطوة متابعة واضحة.
اكتب بالعربية فقط وبشكل عملي.`;

  const response = await fetchJsonWithTimeout(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.4,
        messages: [
          { role: 'system', content: 'You are a practical Arabic sales call script writer.' },
          { role: 'user', content: prompt },
        ],
      }),
    },
    8000,
  );

  const script = response?.choices?.[0]?.message?.content;
  if (typeof script === 'string' && script.trim()) return script.trim();
  return buildFallbackScript({ leadName, trainingTopic, trainingContext, occupation, age, education, goals, notes, webInsights });
};

const buildEmployeeProfilePayload = (input = {}, { strictTarget = false } = {}) => {
  const errors = [];
  const payload = {};

  if (Object.prototype.hasOwnProperty.call(input, 'department')) {
    const department = normalizeNullableString(input.department, 80);
    if (!department) {
      errors.push('Department must be a non-empty string');
    } else {
      payload.department = department;
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'jobTitle')) {
    payload.jobTitle = normalizeNullableString(input.jobTitle, 120);
  }

  if (Object.prototype.hasOwnProperty.call(input, 'phone')) {
    const phone = normalizeNullableString(input.phone, 25);
    if (phone && !/^[0-9+\-\s()]{7,25}$/.test(phone)) {
      errors.push('Invalid employee phone format');
    } else {
      payload.phone = phone;
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'timezone')) {
    const timezone = normalizeNullableString(input.timezone, 80);
    if (!timezone) {
      errors.push('Timezone must be a non-empty string');
    } else {
      payload.timezone = timezone;
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'isActive')) {
    if (typeof input.isActive !== 'boolean') {
      errors.push('isActive must be boolean');
    } else {
      payload.isActive = input.isActive;
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'dailyCallTarget')) {
    const target = parseInteger(input.dailyCallTarget);
    if (target === null || target < 1 || target > 500) {
      errors.push('dailyCallTarget must be an integer between 1 and 500');
    } else {
      payload.dailyCallTarget = target;
    }
  } else if (strictTarget) {
    errors.push('dailyCallTarget is required');
  }

  return { payload, errors };
};

const buildDayRange = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

const safeCount = (value) => (Number.isFinite(value) && value >= 0 ? value : 0);

const canAccessLeadByScope = ({ actor, lead, userId }) => {
  if (!actor || !lead) return false;
  if (!actor.tenantId || lead.tenantId !== actor.tenantId) return false;
  if (actor.role === 'ADMIN') return true;
  if (actor.role === 'TEAM_LEAD') return lead.teamId === actor.teamId;
  if (actor.role === 'SALES') return lead.teamId === actor.teamId && lead.agentId === userId;
  return false;
};

const ensureEmployeeProfile = async (userId) => prisma.employeeProfile.upsert({
  where: { userId },
  update: {},
  create: { userId },
});

const countTeamLeads = async (teamId, { excludeUserId } = {}) => prisma.user.count({
  where: {
    role: 'TEAM_LEAD',
    teamId,
    ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
  },
});

const assertTeamLeadCapacity = async (teamId, { excludeUserId } = {}) => {
  const leadersCount = await countTeamLeads(teamId, { excludeUserId });
  if (leadersCount >= MAX_TEAM_LEADS_PER_TEAM) {
    return `Each team can have only ${MAX_TEAM_LEADS_PER_TEAM} team leads`;
  }
  return null;
};

async function startServer() {
  console.log('Connecting to database...');
  try {
    await prisma.$connect();
    console.log('Database connected successfully');
  } catch (e) {
    console.error('Database connection failed:', e);
    process.exit(1);
  }
  
  // --- Auth Routes ---

  // POST /api/auth/login
  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (!user) return res.status(400).json({ error: 'Invalid credentials' });

      const storedPassword = user.password || '';
      const isBcryptHash = /^\$2[aby]\$\d{2}\$/.test(storedPassword);
      let validPassword = false;

      if (isBcryptHash) {
        validPassword = await bcrypt.compare(password, storedPassword);
      } else {
        // Backward compatibility with legacy plaintext passwords.
        validPassword = password === storedPassword;
        if (validPassword) {
          const hashedPassword = await bcrypt.hash(password, 10);
          await prisma.user.update({
            where: { id: user.id },
            data: { password: hashedPassword },
          });
        }
      }

      if (!validPassword) return res.status(400).json({ error: 'Invalid credentials' });

      const token = jwt.sign({
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        tenantId: user.tenantId || null,
        teamId: user.teamId || null,
      }, JWT_SECRET, { expiresIn: '8h' });
      res.json({
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          tenantId: user.tenantId || null,
          teamId: user.teamId || null,
        },
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  // POST /api/users (Admin + Team Lead)
  app.post('/api/users', authenticateToken, authorizeRole(['ADMIN', 'TEAM_LEAD']), async (req, res) => {
    const actor = await getCurrentUserScope(req.user.id);
    if (!actor) {
      return res.status(401).json({ error: 'Invalid user context' });
    }
    const actorTenantError = assertTenantScopedUser(actor);
    if (actorTenantError) {
      return res.status(400).json({ error: actorTenantError });
    }

    const { name, email, password, role, employeeProfile, teamId: rawTeamId } = req.body;
    const normalizedName = normalizeNullableString(name, 120);
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const normalizedRole = typeof role === 'string' ? role.trim().toUpperCase() : 'SALES';
    const requestedTeamId = parseOptionalTeamId(rawTeamId);

    if (!normalizedName) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!USER_ROLES.has(normalizedRole)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    if (actor.role === 'TEAM_LEAD' && normalizedRole !== 'SALES') {
      return res.status(403).json({ error: 'Team lead can only create sales users' });
    }

    if (normalizedRole === 'TEAM_LEAD' && actor.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only admin can create team leads' });
    }

    const actorTeamError = actor.role === 'TEAM_LEAD' ? assertTeamScopedUser(actor) : null;
    if (actorTeamError) {
      return res.status(400).json({ error: actorTeamError });
    }

    const profileInput = employeeProfile && typeof employeeProfile === 'object' ? employeeProfile : {};
    const { payload: profilePayload, errors: profileErrors } = buildEmployeeProfilePayload(profileInput);
    if (profileErrors.length) {
      return res.status(400).json({ error: profileErrors[0] });
    }

    try {
      let effectiveTeamId = null;
      if (normalizedRole === 'ADMIN') {
        effectiveTeamId = null;
      } else if (actor.role === 'TEAM_LEAD') {
        effectiveTeamId = actor.teamId;
      } else if (requestedTeamId) {
        effectiveTeamId = requestedTeamId;
      }

      if (normalizedRole !== 'ADMIN' && !effectiveTeamId) {
        return res.status(400).json({ error: 'Team is required for non-admin users' });
      }

      if (effectiveTeamId) {
        const team = await prisma.team.findFirst({
          where: { id: effectiveTeamId, tenantId: actor.tenantId },
          select: { id: true },
        });
        if (!team) {
          return res.status(404).json({ error: 'Team not found' });
        }
        if (normalizedRole === 'TEAM_LEAD') {
          const leadCapacityError = await assertTeamLeadCapacity(effectiveTeamId);
          if (leadCapacityError) {
            return res.status(409).json({ error: leadCapacityError });
          }
        }
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await prisma.user.create({
        data: {
          name: normalizedName,
          email: normalizedEmail,
          password: hashedPassword,
          role: normalizedRole,
          tenantId: actor.tenantId,
          teamId: effectiveTeamId,
          ...(normalizedRole === 'SALES'
            ? {
                employeeProfile: {
                  create: {
                    dailyCallTarget: 30,
                    ...profilePayload,
                  },
                },
              }
            : {}),
        },
        include: {
          employeeProfile: true,
          team: true,
        },
      });

      res.status(201).json({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        teamId: user.teamId,
        team: user.team,
        employeeProfile: user.employeeProfile,
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        return res.status(409).json({ error: 'Email already exists' });
      }
      res.status(500).json({ error: 'Failed to create user' });
    }
  });

  // POST /api/teams (Admin only)
  app.post('/api/teams', authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    const teamName = normalizeTeamName(req.body?.name);
    if (!teamName) {
      return res.status(400).json({ error: 'Team name is required' });
    }

    try {
      const actor = await getCurrentUserScope(req.user.id);
      if (!actor) {
        return res.status(401).json({ error: 'Invalid user context' });
      }
      const actorTenantError = assertTenantScopedUser(actor);
      if (actorTenantError) {
        return res.status(400).json({ error: actorTenantError });
      }
      const team = await prisma.team.create({
        data: {
          name: teamName,
          tenantId: actor.tenantId,
        },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
      });

      return res.status(201).json(team);
    } catch (error) {
      if (error?.code === 'P2002') {
        return res.status(409).json({ error: 'Team name already exists or lead already assigned' });
      }
      console.error(error);
      return res.status(500).json({ error: 'Failed to create team' });
    }
  });

  // GET /api/teams (Scoped list)
  app.get('/api/teams', authenticateToken, async (req, res) => {
    try {
      const actor = await getCurrentUserScope(req.user.id);
      if (!actor) {
        return res.status(401).json({ error: 'Invalid user context' });
      }
      const actorTenantError = assertTenantScopedUser(actor);
      if (actorTenantError) {
        return res.status(400).json({ error: actorTenantError });
      }

      const where = actor.role === 'ADMIN'
        ? { tenantId: actor.tenantId }
        : { id: actor.teamId || -1, tenantId: actor.tenantId };
      const teams = await prisma.team.findMany({
        where,
        include: {
          users: {
            where: { role: 'TEAM_LEAD' },
            select: { id: true, name: true, email: true },
          },
          _count: { select: { users: true, leads: true } },
        },
        orderBy: { name: 'asc' },
      });
      return res.json(teams);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to fetch teams' });
    }
  });

  app.delete('/api/teams/:id', authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    const teamId = parseInteger(req.params.id);
    if (teamId === null || teamId < 1) {
      return res.status(400).json({ error: 'Invalid team id' });
    }

    try {
      const actor = await getCurrentUserScope(req.user.id);
      if (!actor) {
        return res.status(401).json({ error: 'Invalid user context' });
      }
      const actorTenantError = assertTenantScopedUser(actor);
      if (actorTenantError) {
        return res.status(400).json({ error: actorTenantError });
      }

      const team = await prisma.team.findFirst({
        where: { id: teamId, tenantId: actor.tenantId },
        select: { id: true, name: true },
      });
      if (!team) {
        return res.status(404).json({ error: 'Team not found' });
      }

      await prisma.$transaction(async (tx) => {
        await tx.interaction.deleteMany({ where: { lead: { teamId } } });
        await tx.lead.deleteMany({ where: { teamId, tenantId: actor.tenantId } });
        await tx.employeeProfile.deleteMany({ where: { user: { teamId, tenantId: actor.tenantId } } });
        await tx.user.deleteMany({ where: { teamId, tenantId: actor.tenantId } });
        await tx.team.delete({ where: { id: teamId } });
      });

      return res.json({ message: 'Team deleted successfully' });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to delete team' });
    }
  });

  app.get('/api/team-management', authenticateToken, authorizeRole(['ADMIN', 'TEAM_LEAD']), async (req, res) => {
    const actor = await getCurrentUserScope(req.user.id);
    if (!actor) {
      return res.status(401).json({ error: 'Invalid user context' });
    }
    const actorTenantError = assertTenantScopedUser(actor);
    if (actorTenantError) {
      return res.status(400).json({ error: actorTenantError });
    }
    if (actor.role === 'TEAM_LEAD' && !actor.teamId) {
      return res.status(400).json({ error: 'User is not assigned to a team' });
    }

    try {
      const where = actor.role === 'ADMIN'
        ? { tenantId: actor.tenantId }
        : { id: actor.teamId, tenantId: actor.tenantId };
      const teams = await prisma.team.findMany({
        where,
        orderBy: { name: 'asc' },
        include: {
          users: {
            where: { role: { in: ['TEAM_LEAD', 'SALES'] } },
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              teamId: true,
              employeeProfile: true,
            },
            orderBy: [{ role: 'asc' }, { name: 'asc' }],
          },
          _count: { select: { users: true, leads: true } },
        },
      });

      const { start, end } = buildDayRange();
      const result = await Promise.all(teams.map(async (team) => {
        const [agreed, hesitant, rejected, noAnswer, recontact, poolCount, callsToday] = await Promise.all([
          prisma.lead.count({ where: { teamId: team.id, source: { not: POOL_SOURCE }, status: 'AGREED' } }),
          prisma.lead.count({ where: { teamId: team.id, source: { not: POOL_SOURCE }, status: 'HESITANT' } }),
          prisma.lead.count({ where: { teamId: team.id, source: { not: POOL_SOURCE }, status: 'REJECTED' } }),
          prisma.lead.count({ where: { teamId: team.id, source: { not: POOL_SOURCE }, status: 'NO_ANSWER' } }),
          prisma.lead.count({ where: { teamId: team.id, source: { not: POOL_SOURCE }, status: 'RECONTACT' } }),
          prisma.lead.count({ where: buildPoolWhere({ teamId: team.id }) }),
          prisma.interaction.count({
            where: {
              type: { in: ['CALL', 'SEND'] },
              date: { gte: start, lt: end },
              lead: { teamId: team.id },
            },
          }),
        ]);
        const salesMembers = team.users.filter((member) => member.role === 'SALES');
        const teamLeadMembers = team.users.filter((member) => member.role === 'TEAM_LEAD');
        const totalTarget = salesMembers.reduce((sum, member) => sum + (member.employeeProfile?.dailyCallTarget || 0), 0);
        const nonPoolTotal = agreed + hesitant + rejected + noAnswer + recontact;

        return {
          id: team.id,
          name: team.name,
          members: team.users,
          stats: {
            membersCount: team.users.length,
            salesCount: salesMembers.length,
            teamLeadsCount: teamLeadMembers.length,
            totalLeads: nonPoolTotal,
            poolCount,
            agreed,
            hesitant,
            rejected,
            noAnswer,
            recontact,
            callsToday,
            totalTarget,
          },
        };
      }));

      return res.json(result);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to fetch team management data' });
    }
  });

  app.put('/api/team-management/members/:id/role', authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    const userId = parseInteger(req.params.id);
    const normalizedRole = typeof req.body?.role === 'string' ? req.body.role.trim().toUpperCase() : '';
    if (userId === null || userId < 1) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    if (!MANAGEABLE_ROLES.has(normalizedRole)) {
      return res.status(400).json({ error: 'Invalid role update target' });
    }

    try {
      const actor = await getCurrentUserScope(req.user.id);
      if (!actor) {
        return res.status(401).json({ error: 'Invalid user context' });
      }
      const actorTenantError = assertTenantScopedUser(actor);
      if (actorTenantError) {
        return res.status(400).json({ error: actorTenantError });
      }
      const user = await prisma.user.findFirst({
        where: { id: userId, tenantId: actor.tenantId },
        select: { id: true, role: true, teamId: true },
      });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (!user.teamId) {
        return res.status(400).json({ error: 'Target user is not assigned to a team' });
      }
      if (!MANAGEABLE_ROLES.has(user.role)) {
        return res.status(400).json({ error: 'Only team members can be updated' });
      }
      if (normalizedRole === user.role) {
        return res.json({ message: 'No role changes detected' });
      }
      if (normalizedRole === 'TEAM_LEAD') {
        const leadCapacityError = await assertTeamLeadCapacity(user.teamId, { excludeUserId: user.id });
        if (leadCapacityError) {
          return res.status(409).json({ error: leadCapacityError });
        }
      }

      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { role: normalizedRole },
        include: {
          team: { select: { id: true, name: true } },
          employeeProfile: true,
        },
      });

      if (normalizedRole === 'SALES') {
        await ensureEmployeeProfile(updated.id);
      }

      return res.json(updated);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to update member role' });
    }
  });

  app.post('/api/team-management/members', authenticateToken, authorizeRole(['ADMIN', 'TEAM_LEAD']), async (req, res) => {
    const actor = await getCurrentUserScope(req.user.id);
    if (!actor) {
      return res.status(401).json({ error: 'Invalid user context' });
    }
    const actorTenantError = assertTenantScopedUser(actor);
    if (actorTenantError) {
      return res.status(400).json({ error: actorTenantError });
    }

    const { name, email, password, role, employeeProfile, teamId: rawTeamId } = req.body;
    const normalizedName = normalizeNullableString(name, 120);
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const normalizedRole = typeof role === 'string' ? role.trim().toUpperCase() : 'SALES';
    const requestedTeamId = parseOptionalTeamId(rawTeamId);

    if (!normalizedName) return res.status(400).json({ error: 'Name is required' });
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!MANAGEABLE_ROLES.has(normalizedRole)) {
      return res.status(400).json({ error: 'Role must be SALES or TEAM_LEAD' });
    }
    if (actor.role === 'TEAM_LEAD' && normalizedRole !== 'SALES') {
      return res.status(403).json({ error: 'Team lead can only add sales members' });
    }

    const actorTeamError = actor.role === 'TEAM_LEAD' ? assertTeamScopedUser(actor) : null;
    if (actorTeamError) {
      return res.status(400).json({ error: actorTeamError });
    }

    const profileInput = employeeProfile && typeof employeeProfile === 'object' ? employeeProfile : {};
    const { payload: profilePayload, errors: profileErrors } = buildEmployeeProfilePayload(profileInput);
    if (profileErrors.length) {
      return res.status(400).json({ error: profileErrors[0] });
    }

    try {
      const effectiveTeamId = actor.role === 'ADMIN' ? requestedTeamId : actor.teamId;
      if (!effectiveTeamId) {
        return res.status(400).json({ error: 'Team is required' });
      }
      const team = await prisma.team.findFirst({
        where: { id: effectiveTeamId, tenantId: actor.tenantId },
        select: { id: true },
      });
      if (!team) {
        return res.status(404).json({ error: 'Team not found' });
      }
      if (normalizedRole === 'TEAM_LEAD') {
        const leadCapacityError = await assertTeamLeadCapacity(effectiveTeamId);
        if (leadCapacityError) {
          return res.status(409).json({ error: leadCapacityError });
        }
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const created = await prisma.user.create({
        data: {
          name: normalizedName,
          email: normalizedEmail,
          password: hashedPassword,
          role: normalizedRole,
          tenantId: actor.tenantId,
          teamId: effectiveTeamId,
          ...(normalizedRole === 'SALES'
            ? {
                employeeProfile: {
                  create: {
                    dailyCallTarget: 30,
                    ...profilePayload,
                  },
                },
              }
            : {}),
        },
        include: {
          team: { select: { id: true, name: true } },
          employeeProfile: true,
        },
      });

      return res.status(201).json(created);
    } catch (error) {
      if (error?.code === 'P2002') {
        return res.status(409).json({ error: 'Email already exists' });
      }
      console.error(error);
      return res.status(500).json({ error: 'Failed to add member' });
    }
  });

  app.put('/api/users/:id/password', authenticateToken, authorizeRole(['ADMIN', 'TEAM_LEAD']), async (req, res) => {
    const userId = parseInteger(req.params.id);
    if (userId === null || userId < 1) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const providedPassword = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    if (providedPassword && providedPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    try {
      const actor = await getCurrentUserScope(req.user.id);
      if (!actor) {
        return res.status(401).json({ error: 'Invalid user context' });
      }
      const actorTenantError = assertTenantScopedUser(actor);
      if (actorTenantError) {
        return res.status(400).json({ error: actorTenantError });
      }
      const target = await prisma.user.findFirst({
        where: { id: userId, tenantId: actor.tenantId },
        select: { id: true, role: true, teamId: true },
      });
      if (!target) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (actor.role === 'TEAM_LEAD') {
        if (!actor.teamId) {
          return res.status(400).json({ error: 'User is not assigned to a team' });
        }
        if (target.role !== 'SALES' || target.teamId !== actor.teamId) {
          return res.status(403).json({ error: 'You can only manage sales members in your team' });
        }
      }

      const nextPassword = providedPassword || generateManagedPassword();
      const hashedPassword = await bcrypt.hash(nextPassword, 10);
      await prisma.user.update({
        where: { id: target.id },
        data: { password: hashedPassword },
      });

      return res.json({ message: 'Password updated successfully', password: nextPassword });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to update password' });
    }
  });

  // DELETE /api/users/:id
  app.delete('/api/users/:id', authenticateToken, authorizeRole(['ADMIN', 'TEAM_LEAD']), async (req, res) => {
    const userId = parseInteger(req.params.id);
    if (userId === null || userId < 1) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    try {
      const actor = await getCurrentUserScope(req.user.id);
      if (!actor) {
        return res.status(401).json({ error: 'Invalid user context' });
      }
      const actorTenantError = assertTenantScopedUser(actor);
      if (actorTenantError) {
        return res.status(400).json({ error: actorTenantError });
      }
      if (userId === req.user.id) {
        return res.status(400).json({ error: 'Cannot delete current account' });
      }

      const user = await prisma.user.findFirst({
        where: { id: userId, tenantId: actor.tenantId },
        select: { id: true, role: true, teamId: true },
      });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (actor.role === 'TEAM_LEAD') {
        if (!actor.teamId) {
          return res.status(400).json({ error: 'User is not assigned to a team' });
        }
        if (user.role !== 'SALES' || user.teamId !== actor.teamId) {
          return res.status(403).json({ error: 'You can only remove sales members from your team' });
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.lead.updateMany({
          where: { agentId: userId, tenantId: actor.tenantId },
          data: { agentId: null, source: POOL_SOURCE, status: POOL_STATUS },
        });
        await tx.user.delete({ where: { id: userId } });
      });

      return res.json({ message: 'User deleted successfully' });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to delete user' });
    }
  });

  // --- Lead Management Routes ---

  // POST /api/leads/bulk (Admin + Team Lead)
  app.post('/api/leads/bulk', authenticateToken, authorizeRole(['ADMIN', 'TEAM_LEAD']), async (req, res) => {
    const actor = await getCurrentUserScope(req.user.id);
    if (!actor) {
      return res.status(401).json({ error: 'Invalid user context' });
    }
    const actorTenantError = assertTenantScopedUser(actor);
    if (actorTenantError) {
      return res.status(400).json({ error: actorTenantError });
    }

    const { leads, teamId: rawTeamId, uploadScope } = req.body;
    if (!Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ error: 'Leads array is required' });
    }

    const safeLeads = leads
      .filter((lead) => lead && typeof lead.phone === 'string' && lead.phone.trim())
      .map((lead) => ({
        normalizedPhone: normalizeEgyptMobile(lead.phone),
        name: typeof lead.name === 'string' && lead.name.trim() ? lead.name.trim() : 'Unknown',
        phone: lead.phone.trim(),
        gender: normalizeGender(lead.gender) || 'UNKNOWN',
      }))
      .filter((lead) => lead.normalizedPhone)
      .map((lead) => ({
        name: lead.name,
        phone: lead.normalizedPhone,
        gender: lead.gender,
      }));

    if (!safeLeads.length) {
      return res.status(400).json({ error: 'No valid leads to import' });
    }

    try {
      const isUploadAll = actor.role === 'ADMIN' && uploadScope === 'ALL';
      const requestedTeamId = parseOptionalTeamId(rawTeamId);
      let targetTeamIds = [];
      let useGlobalPool = false;

      if (actor.role === 'TEAM_LEAD') {
        if (!actor.teamId) {
          return res.status(400).json({ error: 'User is not assigned to a team' });
        }
        targetTeamIds = [actor.teamId];
      } else if (isUploadAll) {
        useGlobalPool = true;
      } else {
        if (!requestedTeamId) {
          return res.status(400).json({ error: 'teamId is required for team upload' });
        }
        const team = await prisma.team.findFirst({
          where: { id: requestedTeamId, tenantId: actor.tenantId },
          select: { id: true },
        });
        if (!team) {
          return res.status(404).json({ error: 'Team not found' });
        }
        targetTeamIds = [requestedTeamId];
      }
      let count = 0;
      
      const chunkSize = 50;
      for (let i = 0; i < safeLeads.length; i += chunkSize) {
        const chunk = safeLeads.slice(i, i + chunkSize);
        if (useGlobalPool) {
          await Promise.all(chunk.map(async (l) => {
            try {
              await prisma.lead.create({
                data: {
                  name: l.name,
                  phone: l.phone,
                  gender: l.gender,
                  status: POOL_STATUS,
                  source: POOL_SOURCE,
                  agentId: null,
                  teamId: null,
                  tenantId: actor.tenantId,
                },
              });
              count++;
            } catch (e) {
              console.error(`Failed to import lead ${l.phone}:`, e.message);
            }
          }));
        } else {
          await Promise.all(targetTeamIds.map(async (teamId) => {
            await Promise.all(chunk.map(async (l) => {
              try {
                await prisma.lead.create({
                  data: {
                    name: l.name,
                    phone: l.phone,
                    gender: l.gender,
                    status: POOL_STATUS,
                    source: POOL_SOURCE,
                    agentId: null,
                    teamId,
                    tenantId: actor.tenantId,
                  },
                });
                count++;
              } catch (e) {
                console.error(`Failed to import lead ${l.phone}:`, e.message);
              }
            }));
          }));
        }
      }

      res.json({ message: `Successfully added ${count} leads to pool`, teamsCount: useGlobalPool ? 0 : targetTeamIds.length, globalPool: useGlobalPool });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to upload leads: ' + error.message });
    }
  });

  // GET /api/admin/pooled-numbers (Admin only)
  app.get('/api/admin/pooled-numbers', authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    const actor = await getCurrentUserScope(req.user.id);
    if (!actor) {
      return res.status(401).json({ error: 'Invalid user context' });
    }
    const actorTenantError = assertTenantScopedUser(actor);
    if (actorTenantError) {
      return res.status(400).json({ error: actorTenantError });
    }
    const teamId = parseOptionalTeamId(normalizeSingleQueryValue(req.query.teamId));
    const search = normalizeSingleQueryValue(req.query.search);
    const where = buildPoolWhere({
      tenantId: actor.tenantId,
      ...(teamId ? { teamId } : {}),
      ...(typeof search === 'string' && search.trim()
        ? {
            OR: [
              { name: { contains: search.trim() } },
              { phone: { contains: search.trim() } },
            ],
          }
        : {}),
    });

    try {
      const [leads, total] = await Promise.all([
        prisma.lead.findMany({
          where,
          include: {
            team: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.lead.count({ where }),
      ]);
      return res.json({ total, leads });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to fetch pooled numbers' });
    }
  });

  app.delete('/api/admin/pooled-numbers', authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    const actor = await getCurrentUserScope(req.user.id);
    if (!actor) {
      return res.status(401).json({ error: 'Invalid user context' });
    }
    const actorTenantError = assertTenantScopedUser(actor);
    if (actorTenantError) {
      return res.status(400).json({ error: actorTenantError });
    }
    const teamId = parseOptionalTeamId(req.body?.teamId);
    const search = normalizeNullableString(req.body?.search, 120);
    const mode = typeof req.body?.mode === 'string' ? req.body.mode.trim().toUpperCase() : 'ALL';
    const count = parseInteger(req.body?.count);
    const sort = typeof req.body?.sort === 'string' ? req.body.sort.trim().toUpperCase() : 'OLDEST';
    const where = buildPoolWhere({
      tenantId: actor.tenantId,
      ...(teamId ? { teamId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { phone: { contains: search } },
            ],
          }
        : {}),
    });

    try {
      if (mode === 'COUNT') {
        if (count === null || count < 1) {
          return res.status(400).json({ error: 'count must be a positive integer' });
        }

        const candidates = await prisma.lead.findMany({
          where,
          select: { id: true },
          orderBy: { createdAt: sort === 'NEWEST' ? 'desc' : 'asc' },
          take: count,
        });
        const ids = candidates.map((item) => item.id);
        if (!ids.length) {
          return res.json({ message: 'No pooled leads matched deletion filters', deleted: 0 });
        }

        const result = await prisma.$transaction(async (tx) => {
          await tx.interaction.deleteMany({ where: { leadId: { in: ids } } });
          return tx.lead.deleteMany({ where: { id: { in: ids } } });
        });
        return res.json({ message: `Deleted ${result.count} pooled leads`, deleted: result.count });
      }

      const result = await prisma.$transaction(async (tx) => {
        await tx.interaction.deleteMany({ where: { lead: where } });
        return tx.lead.deleteMany({ where });
      });
      return res.json({ message: `Deleted ${result.count} pooled leads`, deleted: result.count });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to delete pooled leads' });
    }
  });

  // POST /api/leads/claim (Sales - Get a lead from pool)
  app.post('/api/leads/claim', authenticateToken, async (req, res) => {
    if (req.user.role !== 'SALES') {
      return res.status(403).json({ error: 'Only sales users can claim pool leads' });
    }

    const actor = await getCurrentUserScope(req.user.id);
    if (!actor) {
      return res.status(401).json({ error: 'Invalid user context' });
    }
    const actorTenantError = assertTenantScopedUser(actor);
    if (actorTenantError) {
      return res.status(400).json({ error: actorTenantError });
    }
    const actorTeamError = assertTeamScopedUser(actor);
    if (actorTeamError) {
      return res.status(400).json({ error: actorTeamError });
    }

    const userId = req.user.id;
    try {
      // Guard against race conditions: find candidate then conditionally claim it.
      const maxAttempts = 5;
      const claimScope = buildPoolWhere({
        tenantId: actor.tenantId,
        OR: [
          { teamId: actor.teamId },
          { teamId: null },
        ],
      });
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const poolCount = await prisma.lead.count({ where: claimScope });
        if (!poolCount) return res.status(404).json({ error: 'No leads available in pool' });
        const randomSkip = Math.floor(Math.random() * poolCount);
        const lead = await prisma.lead.findFirst({
          where: claimScope,
          orderBy: { id: 'asc' },
          skip: randomSkip,
        });

        if (!lead) return res.status(404).json({ error: 'No leads available in pool' });

        const claimed = await prisma.lead.updateMany({
          where: buildPoolWhere({ id: lead.id, teamId: lead.teamId ?? null, tenantId: actor.tenantId }),
          data: { agentId: userId, status: POOL_STATUS, teamId: actor.teamId },
        });

        if (!claimed.count) {
          continue;
        }

        const updatedLead = await prisma.lead.findUnique({ where: { id: lead.id } });
        return res.json(updatedLead);
      }

      return res.status(409).json({ error: 'Lead was claimed by another user, please retry' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to claim lead' });
    }
  });

  // POST /api/leads/:id/finalize-claim (Sales - finalize claimed pool lead)
  app.post('/api/leads/:id/finalize-claim', authenticateToken, async (req, res) => {
    if (req.user.role !== 'SALES') {
      return res.status(403).json({ error: 'Only sales users can finalize claimed leads' });
    }

    const leadId = parseInteger(req.params.id);
    if (leadId === null) {
      return res.status(400).json({ error: 'Invalid lead id' });
    }

    const { name, status, source, notes, courseId, gender, whatsappPhone } = req.body;
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!LEAD_STATUSES.has(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    if (!['CALL', 'SEND'].includes(source)) {
      return res.status(400).json({ error: 'Invalid source value' });
    }
    const normalizedGender = normalizeGender(gender);
    if (!normalizedGender) {
      return res.status(400).json({ error: 'Invalid gender value' });
    }
    const hasWhatsappPhone = Object.prototype.hasOwnProperty.call(req.body, 'whatsappPhone');
    const normalizedWhatsappPhone = hasWhatsappPhone ? normalizeEgyptMobile(whatsappPhone) : null;
    if (hasWhatsappPhone && whatsappPhone && !normalizedWhatsappPhone) {
      return res.status(400).json({ error: 'Invalid whatsappPhone value' });
    }

    const actor = await getCurrentUserScope(req.user.id);
    if (!actor) {
      return res.status(401).json({ error: 'Invalid user context' });
    }
    const actorTenantError = assertTenantScopedUser(actor);
    if (actorTenantError) {
      return res.status(400).json({ error: actorTenantError });
    }
    const actorTeamError = assertTeamScopedUser(actor);
    if (actorTeamError) {
      return res.status(400).json({ error: actorTeamError });
    }

    const parsedCourseId = courseId ? parseInt(courseId, 10) : null;
    try {
      const existingLead = await prisma.lead.findUnique({ where: { id: leadId } });
      if (!existingLead) {
        return res.status(404).json({ error: 'Lead not found' });
      }

      if (
        existingLead.tenantId !== actor.tenantId
        || existingLead.source !== POOL_SOURCE
        || existingLead.agentId !== req.user.id
        || existingLead.teamId !== actor.teamId
      ) {
        return res.status(403).json({ error: 'Lead is not claimed by current user' });
      }

      const finalizedLead = await prisma.$transaction(async (tx) => {
        if (status === POOL_STATUS) {
          return tx.lead.update({
            where: { id: leadId },
            data: {
              name: name.trim(),
              notes,
              gender: normalizedGender,
              status: POOL_STATUS,
              source: POOL_SOURCE,
              agentId: null,
              courseId: null,
              whatsappPhone: null,
            },
          });
        }

        const updatedLead = await tx.lead.update({
          where: { id: leadId },
          data: {
            name: name.trim(),
            notes,
            gender: normalizedGender,
            status,
            source,
            agentId: req.user.id,
            courseId: Number.isNaN(parsedCourseId) ? null : parsedCourseId,
            whatsappPhone: hasWhatsappPhone ? normalizedWhatsappPhone : null,
          },
        });

        await tx.interaction.create({
          data: {
            leadId: updatedLead.id,
            type: source === 'SEND' ? 'SEND' : 'CALL',
            outcome: status || null,
            notes: notes || null,
          },
        });

        return updatedLead;
      });

      return res.json(finalizedLead);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to finalize claimed lead' });
    }
  });

  app.post('/api/leads/:id/release-claim', authenticateToken, async (req, res) => {
    if (req.user.role !== 'SALES') {
      return res.status(403).json({ error: 'Only sales users can release claimed leads' });
    }

    const leadId = parseInteger(req.params.id);
    if (leadId === null) {
      return res.status(400).json({ error: 'Invalid lead id' });
    }

    const actor = await getCurrentUserScope(req.user.id);
    if (!actor) {
      return res.status(401).json({ error: 'Invalid user context' });
    }
    const actorTenantError = assertTenantScopedUser(actor);
    if (actorTenantError) {
      return res.status(400).json({ error: actorTenantError });
    }
    const actorTeamError = assertTeamScopedUser(actor);
    if (actorTeamError) {
      return res.status(400).json({ error: actorTeamError });
    }

    try {
      const released = await prisma.lead.updateMany({
        where: {
          id: leadId,
          teamId: actor.teamId,
          tenantId: actor.tenantId,
          source: POOL_SOURCE,
          status: POOL_STATUS,
          agentId: req.user.id,
        },
        data: { agentId: null },
      });
      if (!released.count) {
        return res.status(409).json({ error: 'Lead is no longer claimed by current user' });
      }
      return res.json({ success: true });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to release claimed lead' });
    }
  });

  // GET /api/leads/pool (Sales - View unassigned leads only)
  app.get('/api/leads/pool', authenticateToken, async (req, res) => {
    if (req.user.role !== 'SALES') {
      return res.status(403).json({ error: 'Pool list is for sales users only' });
    }

    const actor = await getCurrentUserScope(req.user.id);
    if (!actor) {
      return res.status(401).json({ error: 'Invalid user context' });
    }
    const actorTenantError = assertTenantScopedUser(actor);
    if (actorTenantError) {
      return res.status(400).json({ error: actorTenantError });
    }
    const actorTeamError = assertTeamScopedUser(actor);
    if (actorTeamError) {
      return res.status(400).json({ error: actorTeamError });
    }

    try {
      const leads = await prisma.lead.findMany({
        where: buildPoolWhere({ teamId: actor.teamId, tenantId: actor.tenantId }),
        orderBy: { createdAt: 'asc' },
      });
      res.json(leads);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to fetch pool leads' });
    }
  });

  // POST /api/leads/:id/assign (Sales - Assign a specific pool lead)
  app.post('/api/leads/:id/assign', authenticateToken, async (req, res) => {
    if (req.user.role !== 'SALES') {
      return res.status(403).json({ error: 'Only sales users can assign pool leads' });
    }

    const { id } = req.params;
    const leadId = parseInt(id);
    if (Number.isNaN(leadId)) {
      return res.status(400).json({ error: 'Invalid lead id' });
    }

    const actor = await getCurrentUserScope(req.user.id);
    if (!actor) {
      return res.status(401).json({ error: 'Invalid user context' });
    }
    const actorTenantError = assertTenantScopedUser(actor);
    if (actorTenantError) {
      return res.status(400).json({ error: actorTenantError });
    }
    const actorTeamError = assertTeamScopedUser(actor);
    if (actorTeamError) {
      return res.status(400).json({ error: actorTeamError });
    }

    try {
      const assigned = await prisma.lead.updateMany({
        where: buildPoolWhere({ id: leadId, teamId: actor.teamId, tenantId: actor.tenantId }),
        data: { agentId: req.user.id, status: POOL_STATUS },
      });

      if (!assigned.count) {
        return res.status(409).json({ error: 'Lead is no longer available' });
      }

      const lead = await prisma.lead.findUnique({ where: { id: leadId } });
      res.json(lead);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to assign lead' });
    }
  });

  // GET /api/leads/recontact (No-answer recontact queue)
  app.get('/api/leads/recontact', authenticateToken, async (req, res) => {
    const dueOnly = String(normalizeSingleQueryValue(req.query.dueOnly) || '0') === '1';
    const where = { status: 'RECONTACT' };

    try {
      const actor = await getCurrentUserScope(req.user.id);
      if (!actor) {
        return res.status(401).json({ error: 'Invalid user context' });
      }
      const actorTenantError = assertTenantScopedUser(actor);
      if (actorTenantError) {
        return res.status(400).json({ error: actorTenantError });
      }
      where.tenantId = actor.tenantId;
      if (actor.role === 'TEAM_LEAD') {
        where.teamId = actor.teamId || -1;
      } else if (actor.role === 'SALES') {
        where.teamId = actor.teamId || -1;
        where.agentId = req.user.id;
      }
      if (dueOnly) {
        where.nextRecontactAt = { lte: new Date() };
      }

      const leads = await prisma.lead.findMany({
        where,
        include: {
          agent: { select: { id: true, name: true, email: true } },
          team: { select: { id: true, name: true } },
        },
        orderBy: [{ nextRecontactAt: 'asc' }, { createdAt: 'desc' }],
      });
      return res.json(leads);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to fetch recontact queue' });
    }
  });

  // POST /api/leads/:id/recontact/schedule (Move no-answer lead to recontact queue)
  app.post('/api/leads/:id/recontact/schedule', authenticateToken, async (req, res) => {
    const leadId = parseInteger(req.params.id);
    const nextContactAt = parseDateTime(req.body?.nextContactAt);
    const notes = normalizeNullableString(req.body?.notes, 1000);

    if (leadId === null) {
      return res.status(400).json({ error: 'Invalid lead id' });
    }
    if (!nextContactAt) {
      return res.status(400).json({ error: 'nextContactAt is required and must be a valid datetime' });
    }

    try {
      const actor = await getCurrentUserScope(req.user.id);
      if (!actor) {
        return res.status(401).json({ error: 'Invalid user context' });
      }
      const existingLead = await prisma.lead.findUnique({ where: { id: leadId } });
      if (!existingLead) {
        return res.status(404).json({ error: 'Lead not found' });
      }
      if (!canAccessLeadByScope({ actor, lead: existingLead, userId: req.user.id })) {
        return res.status(403).json({ error: 'Access denied' });
      }
      if (!['NO_ANSWER', 'RECONTACT'].includes(existingLead.status)) {
        return res.status(409).json({ error: 'Only NO_ANSWER/RECONTACT leads can be scheduled for recontact' });
      }

      const updatedLead = await prisma.lead.update({
        where: { id: leadId },
        data: {
          status: 'RECONTACT',
          nextRecontactAt: nextContactAt,
          notes: notes || existingLead.notes,
        },
      });
      return res.json(updatedLead);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to schedule recontact' });
    }
  });

  // POST /api/leads/:id/recontact/complete (Complete one recontact attempt)
  app.post('/api/leads/:id/recontact/complete', authenticateToken, async (req, res) => {
    const leadId = parseInteger(req.params.id);
    const outcome = typeof req.body?.outcome === 'string' ? req.body.outcome.trim().toUpperCase() : '';
    const source = typeof req.body?.source === 'string' ? req.body.source.trim().toUpperCase() : 'CALL';
    const notes = normalizeNullableString(req.body?.notes, 1000);
    const scheduleNextAt = parseDateTime(req.body?.scheduleNextAt);

    if (leadId === null) {
      return res.status(400).json({ error: 'Invalid lead id' });
    }
    if (!LEAD_STATUSES.has(outcome) || outcome === 'RECONTACT') {
      return res.status(400).json({ error: 'Invalid outcome' });
    }
    if (!['CALL', 'SEND'].includes(source)) {
      return res.status(400).json({ error: 'Invalid source' });
    }
    if (outcome === 'NO_ANSWER' && !scheduleNextAt) {
      return res.status(400).json({ error: 'scheduleNextAt is required when outcome is NO_ANSWER' });
    }

    try {
      const actor = await getCurrentUserScope(req.user.id);
      if (!actor) {
        return res.status(401).json({ error: 'Invalid user context' });
      }
      const existingLead = await prisma.lead.findUnique({ where: { id: leadId } });
      if (!existingLead) {
        return res.status(404).json({ error: 'Lead not found' });
      }
      if (!canAccessLeadByScope({ actor, lead: existingLead, userId: req.user.id })) {
        return res.status(403).json({ error: 'Access denied' });
      }
      if (!['RECONTACT', 'NO_ANSWER'].includes(existingLead.status)) {
        return res.status(409).json({ error: 'Lead is not in recontact workflow' });
      }

      const now = new Date();
      const updated = await prisma.$transaction(async (tx) => {
        const lead = await tx.lead.update({
          where: { id: leadId },
          data: {
            status: outcome === 'NO_ANSWER' ? 'RECONTACT' : outcome,
            nextRecontactAt: outcome === 'NO_ANSWER' ? scheduleNextAt : null,
            lastRecontactAt: now,
            recontactAttempts: { increment: 1 },
            ...(notes ? { notes } : {}),
          },
        });

        await tx.interaction.create({
          data: {
            leadId,
            type: source === 'SEND' ? 'SEND' : 'CALL',
            outcome,
            notes: notes || null,
          },
        });

        return lead;
      });

      return res.json(updated);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to complete recontact attempt' });
    }
  });

  // GET /api/leads/:id (Lead details with access control)
  app.get('/api/leads/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const leadId = parseInt(id);
    if (Number.isNaN(leadId)) {
      return res.status(400).json({ error: 'Invalid lead id' });
    }

    try {
      const actor = await getCurrentUserScope(req.user.id);
      if (!actor) {
        return res.status(401).json({ error: 'Invalid user context' });
      }
      const actorTenantError = assertTenantScopedUser(actor);
      if (actorTenantError) {
        return res.status(400).json({ error: actorTenantError });
      }
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        include: { agent: { select: { id: true, name: true, email: true } } },
      });

      if (!lead) {
        return res.status(404).json({ error: 'Lead not found' });
      }

      if (!canAccessLeadByScope({ actor, lead, userId: req.user.id })) {
        return res.status(403).json({ error: 'Access denied' });
      }

      res.json(lead);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to fetch lead' });
    }
  });

  // GET /api/leads (Scoped: Admin global, Team Lead team, Sales own)
  app.get('/api/leads', authenticateToken, async (req, res) => {
    const status = normalizeSingleQueryValue(req.query.status);
    const source = normalizeSingleQueryValue(req.query.source);
    const where = {};
    if (status && status !== 'ALL') {
      if (!LEAD_STATUSES.has(status)) {
        return res.status(400).json({ error: 'Invalid status filter' });
      }
      where.status = status;
    }
    if (source) {
      if (!LEAD_SOURCES.has(source)) {
        return res.status(400).json({ error: 'Invalid source filter' });
      }
      where.source = source;
    }

    try {
      const actor = await getCurrentUserScope(req.user.id);
      if (!actor) {
        return res.status(401).json({ error: 'Invalid user context' });
      }
      const actorTenantError = assertTenantScopedUser(actor);
      if (actorTenantError) {
        return res.status(400).json({ error: actorTenantError });
      }
      where.tenantId = actor.tenantId;
      if (actor.role === 'TEAM_LEAD') {
        if (!actor.teamId) return res.status(400).json({ error: 'User is not assigned to a team' });
        where.teamId = actor.teamId;
      } else if (actor.role === 'SALES') {
        if (!actor.teamId) return res.status(400).json({ error: 'User is not assigned to a team' });
        where.teamId = actor.teamId;
        where.agentId = req.user.id;
      }

      const leads = await prisma.lead.findMany({
        where,
        include: {
          agent: { select: { name: true, email: true } },
          course: true
        },
        orderBy: { createdAt: 'desc' }
      });
      res.json(leads);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to fetch leads' });
    }
  });

  // POST /api/leads (Manually add lead)
  app.post('/api/leads', authenticateToken, async (req, res) => {
    const { name, phone, status, source, notes, courseId, gender, whatsappPhone, teamId: rawTeamId } = req.body;
    if (status && !LEAD_STATUSES.has(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    if (source && !LEAD_SOURCES.has(source)) {
      return res.status(400).json({ error: 'Invalid source value' });
    }
    const normalizedGender = normalizeGender(gender);
    if (!normalizedGender) {
      return res.status(400).json({ error: 'Invalid gender value' });
    }
    const normalizedWhatsappPhone = normalizeEgyptMobile(whatsappPhone);
    if (whatsappPhone && !normalizedWhatsappPhone) {
      return res.status(400).json({ error: 'Invalid whatsappPhone value' });
    }
    const normalizedPhone = normalizeEgyptMobile(phone);
    if (!normalizedPhone) {
      return res.status(400).json({ error: 'Invalid phone value' });
    }
    try {
      const actor = await getCurrentUserScope(req.user.id);
      if (!actor) {
        return res.status(401).json({ error: 'Invalid user context' });
      }
      const actorTenantError = assertTenantScopedUser(actor);
      if (actorTenantError) {
        return res.status(400).json({ error: actorTenantError });
      }

      const effectiveStatus = status || 'NEW';
      const effectiveSource = source || 'CALL';
      const parsedCourseId = courseId ? parseInt(courseId, 10) : null;
      const requestedTeamId = parseOptionalTeamId(rawTeamId);
      const effectiveTeamId = actor.role === 'ADMIN' ? requestedTeamId : actor.teamId;
      if (actor.role !== 'ADMIN' && !effectiveTeamId) {
        return res.status(400).json({ error: 'teamId is required' });
      }
      if (effectiveTeamId) {
        const team = await prisma.team.findFirst({
          where: { id: effectiveTeamId, tenantId: actor.tenantId },
          select: { id: true },
        });
        if (!team) {
          return res.status(404).json({ error: 'Team not found' });
        }
      }

      const lead = await prisma.$transaction(async (tx) => {
        const createdLead = await tx.lead.create({
          data: {
            name,
            phone: normalizedPhone,
            gender: normalizedGender,
            status: effectiveStatus,
            source: effectiveSource,
            notes,
            agentId: req.user.id, // Auto-assign to creator
            teamId: effectiveTeamId,
            tenantId: actor.tenantId,
            courseId: Number.isNaN(parsedCourseId) ? null : parsedCourseId,
            whatsappPhone: normalizedWhatsappPhone,
          },
        });

        // Sales and team leads manual lead creation should count toward today's outreach KPI.
        // Pool imports are done through /api/leads/bulk and never create interactions.
        if (req.user.role === 'SALES' || req.user.role === 'TEAM_LEAD') {
          await tx.interaction.create({
            data: {
              leadId: createdLead.id,
              type: effectiveSource === 'SEND' ? 'SEND' : 'CALL',
              outcome: createdLead.status || null,
              notes: createdLead.notes || null,
            },
          });
        }

        return createdLead;
      });

      res.status(201).json(lead);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to create lead', details: error.message });
    }
  });

  // PUT /api/leads/:id (Update lead status/notes)
  app.put('/api/leads/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { name, status, notes, logCall, gender, whatsappPhone } = req.body;
    const leadId = parseInt(id);
    if (Number.isNaN(leadId)) {
      return res.status(400).json({ error: 'Invalid lead id' });
    }
    if (status && !LEAD_STATUSES.has(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    if (typeof logCall !== 'undefined' && typeof logCall !== 'boolean') {
      return res.status(400).json({ error: 'logCall must be boolean' });
    }
    const hasGender = Object.prototype.hasOwnProperty.call(req.body, 'gender');
    const normalizedGender = hasGender ? normalizeGender(gender) : null;
    if (hasGender && !normalizedGender) {
      return res.status(400).json({ error: 'Invalid gender value' });
    }
    const hasWhatsappPhone = Object.prototype.hasOwnProperty.call(req.body, 'whatsappPhone');
    const normalizedWhatsappPhone = hasWhatsappPhone ? normalizeEgyptMobile(whatsappPhone) : null;
    if (hasWhatsappPhone && whatsappPhone && !normalizedWhatsappPhone) {
      return res.status(400).json({ error: 'Invalid whatsappPhone value' });
    }

    try {
      const actor = await getCurrentUserScope(req.user.id);
      if (!actor) {
        return res.status(401).json({ error: 'Invalid user context' });
      }
      const actorTenantError = assertTenantScopedUser(actor);
      if (actorTenantError) {
        return res.status(400).json({ error: actorTenantError });
      }
      const existingLead = await prisma.lead.findUnique({ where: { id: leadId } });
      if (!existingLead) {
        return res.status(404).json({ error: 'Lead not found' });
      }

      if (!canAccessLeadByScope({ actor, lead: existingLead, userId: req.user.id })) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const lead = await prisma.$transaction(async (tx) => {
        const updatedLead = await tx.lead.update({
          where: { id: leadId },
          data: {
            name,
            status,
            notes,
            ...(hasGender ? { gender: normalizedGender } : {}),
            ...(hasWhatsappPhone ? { whatsappPhone: normalizedWhatsappPhone } : {}),
          }
        });

        if (logCall && (req.user.role === 'SALES' || req.user.role === 'TEAM_LEAD')) {
          await tx.interaction.create({
            data: {
              leadId: leadId,
              type: 'CALL',
              outcome: status || null,
              notes: notes || null,
            },
          });
        }

        return updatedLead;
      });
      res.json(lead);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to update lead' });
    }
  });

  app.delete('/api/leads/:id', authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    const leadId = parseInteger(req.params.id);
    if (leadId === null || leadId < 1) {
      return res.status(400).json({ error: 'Invalid lead id' });
    }

    try {
      const actor = await getCurrentUserScope(req.user.id);
      if (!actor) {
        return res.status(401).json({ error: 'Invalid user context' });
      }
      const actorTenantError = assertTenantScopedUser(actor);
      if (actorTenantError) {
        return res.status(400).json({ error: actorTenantError });
      }
      const lead = await prisma.lead.findFirst({
        where: { id: leadId, tenantId: actor.tenantId },
        select: { id: true },
      });
      if (!lead) {
        return res.status(404).json({ error: 'Lead not found' });
      }

      await prisma.$transaction(async (tx) => {
        await tx.interaction.deleteMany({ where: { leadId } });
        await tx.lead.delete({ where: { id: leadId } });
      });

      return res.json({ message: 'Lead deleted successfully' });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to delete lead' });
    }
  });

  // GET /api/stats
  app.get('/api/stats', authenticateToken, async (req, res) => {
    try {
      const actor = await getCurrentUserScope(req.user.id);
      if (!actor) {
        return res.status(401).json({ error: 'Invalid user context' });
      }
      const actorTenantError = assertTenantScopedUser(actor);
      if (actorTenantError) {
        return res.status(400).json({ error: actorTenantError });
      }

      const where = { tenantId: actor.tenantId };
      if (actor.role === 'TEAM_LEAD') {
        if (!actor.teamId) return res.status(400).json({ error: 'User is not assigned to a team' });
        where.teamId = actor.teamId;
      } else if (actor.role === 'SALES') {
        if (!actor.teamId) return res.status(400).json({ error: 'User is not assigned to a team' });
        where.teamId = actor.teamId;
        where.agentId = req.user.id;
      }

      const { start, end } = buildDayRange();
      const customerWhere = { ...where, source: { not: POOL_SOURCE }, status: { notIn: ['NO_ANSWER', 'RECONTACT'] } };
      const [total, agreed, hesitant, rejected, noAnswer, recontact] = await Promise.all([
        prisma.lead.count({ where: customerWhere }),
        prisma.lead.count({ where: { ...where, source: { not: POOL_SOURCE }, status: 'AGREED' } }),
        prisma.lead.count({ where: { ...where, source: { not: POOL_SOURCE }, status: 'HESITANT' } }),
        prisma.lead.count({ where: { ...where, source: { not: POOL_SOURCE }, status: 'REJECTED' } }),
        prisma.lead.count({ where: { ...where, source: { not: POOL_SOURCE }, status: 'NO_ANSWER' } }),
        prisma.lead.count({ where: { ...where, source: { not: POOL_SOURCE }, status: 'RECONTACT' } }),
      ]);

      // If Admin, also get pool count
      let poolCount = 0;
      let callsToday = 0;
      let dailyCallTarget = null;
      let teamMembersPerformance = [];
      if (actor.role === 'ADMIN') {
        poolCount = await prisma.lead.count({ where: buildPoolWhere({ tenantId: actor.tenantId }) });
      } else if (actor.role === 'SALES') {
        const profile = await ensureEmployeeProfile(req.user.id);
        dailyCallTarget = profile.dailyCallTarget;
        callsToday = await prisma.interaction.count({
          where: {
            type: { in: ['CALL', 'SEND'] },
            date: { gte: start, lt: end },
              lead: { agentId: req.user.id, tenantId: actor.tenantId },
          },
        });
      } else if (actor.role === 'TEAM_LEAD') {
        const teamMembers = await prisma.user.findMany({
          where: { role: 'SALES', teamId: actor.teamId || -1, tenantId: actor.tenantId },
          select: {
            id: true,
            employeeProfile: { select: { dailyCallTarget: true } },
          },
        });
        const salesIds = teamMembers.map((member) => member.id);
        dailyCallTarget = teamMembers.reduce((sum, member) => sum + (member.employeeProfile?.dailyCallTarget || 0), 0);
        teamMembersPerformance = teamMembers.map((member) => ({
          userId: member.id,
          dailyCallTarget: member.employeeProfile?.dailyCallTarget || 0,
        }));
        callsToday = salesIds.length
          ? await prisma.interaction.count({
              where: {
                type: { in: ['CALL', 'SEND'] },
                date: { gte: start, lt: end },
                lead: { agentId: { in: salesIds }, tenantId: actor.tenantId },
              },
            })
          : 0;
        if (salesIds.length) {
          const callsByAgent = await prisma.interaction.groupBy({
            by: ['leadId'],
            where: {
              type: { in: ['CALL', 'SEND'] },
              date: { gte: start, lt: end },
              lead: { agentId: { in: salesIds }, tenantId: actor.tenantId },
            },
            _count: { _all: true },
          });
          const leadIds = callsByAgent.map((item) => item.leadId);
          const mappedLeads = leadIds.length
            ? await prisma.lead.findMany({
                where: { id: { in: leadIds }, tenantId: actor.tenantId },
                select: { id: true, agentId: true },
              })
            : [];
          const interactionByAgent = mappedLeads.reduce((acc, lead) => {
            const leadMetric = callsByAgent.find((item) => item.leadId === lead.id)?._count?._all || 0;
            if (lead.agentId) acc[lead.agentId] = (acc[lead.agentId] || 0) + leadMetric;
            return acc;
          }, {});
          teamMembersPerformance = teamMembersPerformance.map((member) => ({
            ...member,
            callsToday: interactionByAgent[member.userId] || 0,
          }));
        }
        poolCount = await prisma.lead.count({ where: buildPoolWhere({ teamId: actor.teamId, tenantId: actor.tenantId }) });
      }
      const safeTotal = safeCount(total);
      const safeAgreed = safeCount(agreed);
      const safeHesitant = safeCount(hesitant);
      const safeRejected = safeCount(rejected);
      const safeNoAnswer = safeCount(noAnswer);
      const safeRecontact = safeCount(recontact);
      const safePoolCount = safeCount(poolCount);
      const safeCallsToday = safeCount(callsToday);
      const safeDailyCallTarget = Number.isFinite(dailyCallTarget) && dailyCallTarget > 0 ? dailyCallTarget : null;
      const completionRate = safeDailyCallTarget
        ? Math.min(100, Number(((safeCallsToday / safeDailyCallTarget) * 100).toFixed(2)))
        : null;

      res.json({
        total: safeTotal,
        agreed: safeAgreed,
        hesitant: safeHesitant,
        rejected: safeRejected,
        noAnswer: safeNoAnswer,
        recontact: safeRecontact,
        poolCount: safePoolCount,
        callsToday: safeCallsToday,
        dailyCallTarget: safeDailyCallTarget,
        byStatus: {
          AGREED: safeAgreed,
          HESITANT: safeHesitant,
          REJECTED: safeRejected,
          NO_ANSWER: safeNoAnswer,
          RECONTACT: safeRecontact,
        },
        kpi: {
          callsToday: safeCallsToday,
          dailyCallTarget: safeDailyCallTarget,
          remainingCalls: safeDailyCallTarget ? Math.max(0, safeDailyCallTarget - safeCallsToday) : null,
          completionRate,
        },
        teamAnalytics: actor.role === 'TEAM_LEAD'
          ? {
              teamId: actor.teamId,
              members: teamMembersPerformance,
              membersCount: teamMembersPerformance.length,
            }
          : null,
        scope: actor.role === 'ADMIN' ? 'TENANT' : actor.role === 'TEAM_LEAD' ? 'TEAM' : 'AGENT',
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  // GET /api/me/employee-profile
  app.get('/api/me/employee-profile', authenticateToken, async (req, res) => {
    if (req.user.role !== 'SALES') {
      return res.status(403).json({ error: 'Employee profile is available for sales agents only' });
    }
    try {
      const profile = await ensureEmployeeProfile(req.user.id);
      res.json(profile);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to fetch employee profile' });
    }
  });

  // GET /api/users (Admin + Team Lead with scope)
  app.get('/api/users', authenticateToken, authorizeRole(['ADMIN', 'TEAM_LEAD']), async (req, res) => {
    try {
      const actor = await getCurrentUserScope(req.user.id);
      if (!actor) {
        return res.status(401).json({ error: 'Invalid user context' });
      }
      const actorTenantError = assertTenantScopedUser(actor);
      if (actorTenantError) {
        return res.status(400).json({ error: actorTenantError });
      }

      const where = actor.role === 'TEAM_LEAD'
        ? { teamId: actor.teamId || -1, role: 'SALES', tenantId: actor.tenantId }
        : { tenantId: actor.tenantId };
      const users = await prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          tenantId: true,
          teamId: true,
          team: { select: { id: true, name: true } },
          employeeProfile: true,
        }
      });
      res.json(users);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });

  // GET /api/admin/employees (Admin + Team Lead scoped by team)
  app.get('/api/admin/employees', authenticateToken, authorizeRole(['ADMIN', 'TEAM_LEAD']), async (req, res) => {
    const actor = await getCurrentUserScope(req.user.id);
    if (!actor) {
      return res.status(401).json({ error: 'Invalid user context' });
    }
    const actorTenantError = assertTenantScopedUser(actor);
    if (actorTenantError) {
      return res.status(400).json({ error: actorTenantError });
    }
    const search = normalizeSingleQueryValue(req.query.search);
    const where = {
      role: 'SALES',
      tenantId: actor.tenantId,
      ...(actor.role === 'TEAM_LEAD' ? { teamId: actor.teamId || -1 } : {}),
      ...(typeof search === 'string' && search.trim()
        ? {
            OR: [
              { name: { contains: search.trim() } },
              { email: { contains: search.trim() } },
            ],
          }
        : {}),
    };

    try {
      const users = await prisma.user.findMany({
        where,
        include: { employeeProfile: true },
        orderBy: { name: 'asc' },
      });

      const missingProfileIds = users
        .filter((user) => !user.employeeProfile)
        .map((user) => user.id);

      if (missingProfileIds.length) {
        await Promise.all(missingProfileIds.map((userId) => ensureEmployeeProfile(userId)));
      }

      const refreshedUsers = missingProfileIds.length
        ? await prisma.user.findMany({
            where,
            include: { employeeProfile: true },
            orderBy: { name: 'asc' },
          })
        : users;

      const { start, end } = buildDayRange();
      const agentIds = refreshedUsers.map((user) => user.id);
      const calls = agentIds.length
        ? await prisma.interaction.findMany({
            where: {
              type: 'CALL',
              date: { gte: start, lt: end },
              lead: { agentId: { in: agentIds }, tenantId: actor.tenantId },
            },
            select: {
              lead: {
                select: { agentId: true },
              },
            },
          })
        : [];

      const callsByAgent = calls.reduce((acc, interaction) => {
        const agentId = interaction.lead?.agentId;
        if (agentId) {
          acc[agentId] = (acc[agentId] || 0) + 1;
        }
        return acc;
      }, {});

      const result = refreshedUsers.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        teamId: user.teamId,
        profile: user.employeeProfile,
        callsToday: callsByAgent[user.id] || 0,
      }));

      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to fetch employee profiles' });
    }
  });

  // PUT /api/admin/employees/:id/profile (Admin + Team Lead)
  app.put('/api/admin/employees/:id/profile', authenticateToken, authorizeRole(['ADMIN', 'TEAM_LEAD']), async (req, res) => {
    const actor = await getCurrentUserScope(req.user.id);
    if (!actor) {
      return res.status(401).json({ error: 'Invalid user context' });
    }
    const actorTenantError = assertTenantScopedUser(actor);
    if (actorTenantError) {
      return res.status(400).json({ error: actorTenantError });
    }

    const userId = parseInteger(req.params.id);
    if (userId === null || userId < 1) {
      return res.status(400).json({ error: 'Invalid employee id' });
    }

    const { payload, errors } = buildEmployeeProfilePayload(req.body, { strictTarget: true });
    if (errors.length) {
      return res.status(400).json({ error: errors[0] });
    }

    try {
      const user = await prisma.user.findFirst({
        where: { id: userId, tenantId: actor.tenantId },
        select: { id: true, role: true, teamId: true },
      });

      if (!user) {
        return res.status(404).json({ error: 'Employee not found' });
      }

      if (user.role !== 'SALES') {
        return res.status(400).json({ error: 'Profile can only be updated for sales agents' });
      }
      if (actor.role === 'TEAM_LEAD' && user.teamId !== actor.teamId) {
        return res.status(403).json({ error: 'You can only update your team members' });
      }

      const profile = await prisma.employeeProfile.upsert({
        where: { userId },
        update: payload,
        create: { userId, ...payload },
      });

      res.json(profile);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to update employee profile' });
    }
  });

  // --- Template Routes ---

  // GET /api/templates
  app.get('/api/templates', authenticateToken, async (req, res) => {
    try {
      const actor = await getCurrentUserScope(req.user.id);
      if (!actor) {
        return res.status(401).json({ error: 'Invalid user context' });
      }
      const actorTenantError = assertTenantScopedUser(actor);
      if (actorTenantError) {
        return res.status(400).json({ error: actorTenantError });
      }
      await Promise.all(
        DEFAULT_TEMPLATES.map((template) =>
          prisma.messageTemplate.upsert({
            where: { tenantId_status: { tenantId: actor.tenantId, status: template.status } },
            update: {},
            create: {
              ...template,
              tenantId: actor.tenantId,
            },
          }),
        ),
      );
      const templates = await prisma.messageTemplate.findMany({
        where: { tenantId: actor.tenantId },
        orderBy: { id: 'asc' },
      });
      res.json(templates);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to fetch templates' });
    }
  });

  // PUT /api/templates/:id (Admin only)
  app.put('/api/templates/:id', authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    const { id } = req.params;
    const { content } = req.body;
    try {
      const actor = await getCurrentUserScope(req.user.id);
      if (!actor) {
        return res.status(401).json({ error: 'Invalid user context' });
      }
      const actorTenantError = assertTenantScopedUser(actor);
      if (actorTenantError) {
        return res.status(400).json({ error: actorTenantError });
      }
      const templateId = parseInteger(id);
      if (templateId === null || templateId < 1) {
        return res.status(400).json({ error: 'Invalid template id' });
      }
      const template = await prisma.messageTemplate.updateMany({
        where: { id: templateId, tenantId: actor.tenantId },
        data: { content }
      });
      if (!template.count) {
        return res.status(404).json({ error: 'Template not found' });
      }
      const updatedTemplate = await prisma.messageTemplate.findFirst({
        where: { id: templateId, tenantId: actor.tenantId },
      });
      res.json(updatedTemplate);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to update template' });
    }
  });

  app.get('/api/assistant/training', authenticateToken, async (req, res) => {
    try {
      const actor = await getCurrentUserScope(req.user.id);
      if (!actor) {
        return res.status(401).json({ error: 'Invalid user context' });
      }
      const actorTenantError = assertTenantScopedUser(actor);
      if (actorTenantError) {
        return res.status(400).json({ error: actorTenantError });
      }
      const bucket = readAssistantTraining();
      const key = String(actor.tenantId);
      const training = bucket[key] || { topic: '', context: '', updatedAt: null };
      return res.json(training);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to load assistant training' });
    }
  });

  app.post('/api/assistant/training', authenticateToken, async (req, res) => {
    const topic = normalizeNullableString(req.body?.topic, 120) || '';
    const context = normalizeNullableString(req.body?.context, 2000) || '';
    if (!topic && !context) {
      return res.status(400).json({ error: 'Training topic or context is required' });
    }
    try {
      const actor = await getCurrentUserScope(req.user.id);
      if (!actor) {
        return res.status(401).json({ error: 'Invalid user context' });
      }
      const actorTenantError = assertTenantScopedUser(actor);
      if (actorTenantError) {
        return res.status(400).json({ error: actorTenantError });
      }
      const bucket = readAssistantTraining();
      const key = String(actor.tenantId);
      bucket[key] = { topic, context, updatedAt: new Date().toISOString() };
      writeAssistantTraining(bucket);
      return res.json(bucket[key]);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to save assistant training' });
    }
  });

  app.post('/api/assistant/extract-name', authenticateToken, async (req, res) => {
    const transcript = normalizeNullableString(req.body?.transcript, 1200);
    if (!transcript) {
      return res.status(400).json({ error: 'Transcript is required' });
    }
    const extractedName = extractNameFromTranscript(transcript);
    return res.json({ extractedName });
  });

  app.post('/api/assistant/generate-script', authenticateToken, async (req, res) => {
    const leadName = normalizeNullableString(req.body?.leadName, 120) || '';
    const occupation = normalizeNullableString(req.body?.occupation, 120) || '';
    const age = normalizeNullableString(req.body?.age, 20) || '';
    const education = normalizeNullableString(req.body?.education, 120) || '';
    const goals = normalizeNullableString(req.body?.goals, 280) || '';
    const notes = normalizeNullableString(req.body?.notes, 1000) || '';
    const searchWeb = req.body?.searchWeb !== false;

    try {
      const actor = await getCurrentUserScope(req.user.id);
      if (!actor) {
        return res.status(401).json({ error: 'Invalid user context' });
      }
      const actorTenantError = assertTenantScopedUser(actor);
      if (actorTenantError) {
        return res.status(400).json({ error: actorTenantError });
      }

      const bucket = readAssistantTraining();
      const savedTraining = bucket[String(actor.tenantId)] || {};
      const trainingTopic = normalizeNullableString(req.body?.trainingTopic, 120) || savedTraining.topic || '';
      const trainingContext = normalizeNullableString(req.body?.trainingContext, 2000) || savedTraining.context || '';
      const followUpQuestions = buildFollowUpQuestions({ occupation, age, education, goals });
      const queryParts = [trainingTopic, occupation, education, goals].filter(Boolean);
      const webInsights = searchWeb && queryParts.length
        ? await fetchWebInsights(queryParts.join(' '))
        : [];
      const script = await generateScriptWithModel({
        leadName,
        trainingTopic,
        trainingContext,
        occupation,
        age,
        education,
        goals,
        notes,
        webInsights,
      });

      return res.json({
        script,
        followUpQuestions,
        webInsights,
        trainingTopic,
        trainingContext,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to generate assistant script' });
    }
  });

  const publicDir = join(__dirname, 'public');
  if (existsSync(publicDir)) {
    app.use(express.static(publicDir));
    app.get(/^(?!\/api).*/, (_, res) => {
      res.sendFile(join(publicDir, 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

startServer().catch(e => {
  console.error('Failed to start server:', e);
  process.exit(1);
});
