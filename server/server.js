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
import webpush from 'web-push';
import cron from 'node-cron';
import { runPrismaBootstrap } from './scripts/prisma-bootstrap.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });

// Configure Web Push
const PUSH_ENABLED = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL || 'admin@edicon.com'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} else {
  console.warn('[startup] VAPID keys are missing. Push notifications will be disabled.');
}

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.RAILWAY_ENVIRONMENT
    ? 'file:/data/crm.db'
    : 'file:./prisma/dev.db';
  console.warn(`[startup] DATABASE_URL was missing. Fallback applied: ${process.env.DATABASE_URL}`);
}
if (typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.startsWith('file:') && !process.env.DATABASE_URL.includes('connection_limit=')) {
  process.env.DATABASE_URL = `${process.env.DATABASE_URL}${process.env.DATABASE_URL.includes('?') ? '&' : '?'}connection_limit=1`;
}
runPrismaBootstrap(__dirname);

const app = express();
const PORT = process.env.PORT || 5000;
const APP_RUNTIME_TAG = process.env.APP_RUNTIME_TAG || 'prisma-hotfix-20260310-r3';
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-this';
const LEAD_STATUSES = new Set(['NEW', 'INTERESTED', 'AGREED', 'REJECTED', 'HESITANT', 'SPONSOR', 'NO_ANSWER', 'RECONTACT', 'WRONG_NUMBER']);
const LEAD_SOURCES = new Set(['CALL', 'SEND', 'POOL']);
const LEAD_GENDERS = new Set(['MALE', 'FEMALE', 'UNKNOWN']);
const USER_ROLES = new Set(['ADMIN', 'TEAM_LEAD', 'SALES']);
const MANAGEABLE_ROLES = new Set(['TEAM_LEAD', 'SALES']);
const POOL_SOURCE = 'POOL';
const POOL_STATUS = 'NEW';
const UNKNOWN_LEAD_NAME = 'Unknown';
const CLAIM_TIMEOUT_MINUTES = 15;
const MAX_TEAM_LEADS_PER_TEAM = 2;
const DEFAULT_TEMPLATES = [
  { status: 'AGREED', content: 'السلام عليكم {customer_title} {customer_name}، مع حضرتك {user_name} من إيديكون. تم تأكيد موافقتك، وبرجاء إرسال التفاصيل النهائية.' },
  { status: 'REJECTED', content: 'شكراً لوقتك {customer_title} {customer_name}، نتمنى لك التوفيق.' },
  { status: 'HESITANT', content: 'السلام عليكم {customer_title} {customer_name}، مع حضرتك {user_name}. حبيت أتابع مع حضرتك لو في أي استفسار.' },
  { status: 'SPONSOR', content: 'السلام عليكم {customer_title} {customer_name}، شكراً لاهتمامك بالرعاية. برجاء إرسال التفاصيل المطلوبة.' },
  { status: 'NO_ANSWER', content: 'السلام عليكم {customer_title} {customer_name}، حاولنا نتواصل مع حضرتك اليوم لكن ماكانش فيه رد. لو مناسب لحضرتك ابعتلنا وقت مناسب وهنكلمك فوراً.' },
  { status: 'WRONG_NUMBER', content: 'نعتذر، تم تسجيل أن الرقم غير صحيح. برجاء التأكد من الرقم الصحيح إذا رغبت بالتواصل.' },
];
const CORS_ORIGIN = process.env.CORS_ORIGIN || '';
const allowedOrigins = CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);
const ASSISTANT_TRAINING_FILE = join(__dirname, 'assistant-training.json');

app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : true,
}));
app.use(express.json({ limit: '10mb' }));
console.log(`[runtime] tag=${APP_RUNTIME_TAG} prisma_engine=${process.env.PRISMA_CLIENT_ENGINE_TYPE || 'default'}`);

app.get('/api/runtime-info', (_req, res) => {
  res.json({
    tag: APP_RUNTIME_TAG,
    prismaEngine: process.env.PRISMA_CLIENT_ENGINE_TYPE || null,
    databaseUrl: typeof process.env.DATABASE_URL === 'string' ? process.env.DATABASE_URL : null,
  });
});

console.log('Initializing Prisma Client...');
const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

const sseClients = new Map();

const writeSseEvent = (res, event, data) => {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
  }
};

const writeSseComment = (res, text) => {
  try {
    res.write(`: ${text}\n\n`);
  } catch {
  }
};

const broadcastTenantEvent = (tenantId, event, data) => {
  for (const client of sseClients.values()) {
    if (tenantId && client.tenantId && client.tenantId !== tenantId) continue;
    writeSseEvent(client.res, event, data);
  }
};

const broadcastUserEvent = (userId, event, data) => {
  for (const client of sseClients.values()) {
    if (client.userId !== userId) continue;
    writeSseEvent(client.res, event, data);
  }
};

setInterval(() => {
  for (const client of sseClients.values()) {
    writeSseComment(client.res, 'ping');
  }
}, 25000).unref();

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

app.get('/api/events', authenticateToken, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  const userId = req.user?.id;
  const tenantId = req.user?.tenantId || null;
  const teamId = req.user?.teamId || null;
  const role = req.user?.role || null;
  const id = randomBytes(12).toString('hex');

  sseClients.set(id, { res, userId, tenantId, teamId, role });
  writeSseComment(res, 'connected');
  writeSseEvent(res, 'hello', { at: new Date().toISOString() });

  req.on('close', () => {
    sseClients.delete(id);
  });
});

const normalizeSingleQueryValue = (value) => {
  if (Array.isArray(value)) return value[0];
  return value;
};

const buildPoolWhere = (extra = {}) => ({
  agentId: null,
  source: POOL_SOURCE,
  status: POOL_STATUS,
  isHiddenFromSales: false,
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

const getCurrentUserScope = async (userId) => prisma.user.findFirst({
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

const normalizeEmail = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed;
};

const normalizeLeadName = (value) => normalizeNullableString(value, 120) || UNKNOWN_LEAD_NAME;

const hasValidProvidedName = (value) => {
  const normalized = normalizeNullableString(value, 120);
  if (!normalized) return false;
  return normalized.toLowerCase() !== UNKNOWN_LEAD_NAME.toLowerCase();
};

const parseBulkLine = (line) => {
  if (typeof line !== 'string') return null;
  const raw = line.trim();
  if (!raw) return null;
  const parts = raw.split(',').map((part) => part.trim());
  const first = parts[0] || '';
  const nameParts = parts.slice(1).filter(Boolean);
  const normalizedPhone = normalizeEgyptMobile(first);
  if (!normalizedPhone) return null;
  const providedName = normalizeNullableString(nameParts.join(' '), 120);
  return {
    phone: normalizedPhone,
    name: providedName || UNKNOWN_LEAD_NAME,
    hasProvidedName: !!providedName,
  };
};

const normalizeBulkLeadInput = (lead) => {
  if (!lead) return null;
  if (typeof lead === 'string') {
    return parseBulkLine(lead);
  }
  const normalizedPhone = normalizeEgyptMobile(typeof lead.phone === 'string' ? lead.phone : '');
  if (!normalizedPhone) return null;
  const rawName = typeof lead.name === 'string'
    ? lead.name
    : (typeof lead['الاسم'] === 'string' ? lead['الاسم'] : '');
  const normalizedName = normalizeLeadName(rawName);
  return {
    phone: normalizedPhone,
    name: normalizedName,
    hasProvidedName: hasValidProvidedName(rawName),
    gender: normalizeGender(lead.gender) || 'UNKNOWN',
  };
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

  if (Object.prototype.hasOwnProperty.call(input, 'dailyApprovalTarget')) {
    const target = parseInteger(input.dailyApprovalTarget);
    if (target === null || target < 0 || target > 200) {
      errors.push('dailyApprovalTarget must be an integer between 0 and 200');
    } else {
      payload.dailyApprovalTarget = target;
    }
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

const buildDayRangeWithOffset = (offsetDays = 0) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + offsetDays);
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
      const user = await prisma.user.findFirst({ where: { email: normalizedEmail } });
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

  // --- Push Notification Routes ---

  // GET /api/notifications/vapid-public-key
  app.get('/api/notifications/vapid-public-key', (req, res) => {
    if (!process.env.VAPID_PUBLIC_KEY) {
      return res.status(503).json({ error: 'Push notifications are disabled' });
    }
    return res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
  });

  // POST /api/notifications/subscribe
  app.post('/api/notifications/subscribe', authenticateToken, async (req, res) => {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'Invalid subscription object' });
    }

    try {
      await prisma.pushSubscription.upsert({
        where: { endpoint },
        update: {
          userId: req.user.id,
          p256dh: keys.p256dh,
          auth: keys.auth,
        },
        create: {
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          userId: req.user.id,
        },
      });
      res.status(201).json({ message: 'Subscribed successfully' });
    } catch (error) {
      console.error('Push subscribe error:', error);
      res.status(500).json({ error: 'Failed to subscribe' });
    }
  });

  const sendPushNotification = async (userId, payload) => {
    try {
      if (!PUSH_ENABLED) {
        return { sent: 0, reason: 'disabled' };
      }
      const subscriptions = await prisma.pushSubscription.findMany({
        where: { userId },
      });

      if (!subscriptions.length) {
        return { sent: 0, reason: 'no_subscriptions' };
      }

      let sent = 0;
      const promises = subscriptions.map((sub) => {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        };
        return webpush.sendNotification(pushSubscription, JSON.stringify(payload))
          .then(() => {
            sent += 1;
          })
          .catch(async (err) => {
            if (err.statusCode === 410 || err.statusCode === 404) {
              // Subscription expired or no longer valid, delete it
              await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
            }
            console.error('Error sending push notification:', err.message);
          });
      });

      await Promise.all(promises);
      return { sent, reason: sent ? 'ok' : 'failed' };
    } catch (error) {
      console.error('sendPushNotification error:', error);
      return { sent: 0, reason: 'error' };
    }
  };

  const LOW_APPROVAL_CALLS_STEP = 20;
  const LOW_APPROVAL_MIN_APPROVALS_PER_STEP = 5;
  const lastLowApprovalAlertByUser = new Map();
  const lastMotivationSentAtByUser = new Map();

  const motivationalLines = [
    'اشتغل على الجودة مش بس الكمية. ركّز على خطوة واضحة في نهاية المكالمة.',
    'كل مكالمة لازم تنتهي بسؤال إغلاق واضح: نكمل فين وبإيه؟',
    'لو النسبة قليلة، جرّب تغيّر الافتتاحية وسؤالين الاستكشاف قبل العرض.',
    'ركز على سبب واحد قوي يناسب العميل بدل ما تعدد مزايا كتير مرة واحدة.',
    'اسمع أكتر من ما تتكلم: خلي العميل يقول مشكلته، وبعدها اربط الحل.',
    'قسّم هدفك لدفعات صغيرة: 10 مكالمات وراجع الأداء بسرعة.',
  ];

  const pickStableLine = (seed, lines) => {
    if (!Array.isArray(lines) || lines.length === 0) return '';
    const str = String(seed || '');
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return lines[h % lines.length];
  };

  const buildJobTips = (profile) => {
    const department = String(profile?.department || '').toLowerCase();
    const jobTitle = String(profile?.jobTitle || '').toLowerCase();
    const key = `${department} ${jobTitle}`;
    const tips = [];
    if (key.includes('inside') || key.includes('sales') || key.includes('telesales') || key.includes('call')) {
      tips.push('قلّل وقت المقدمة: 10-15 ثانية ثم سؤال استكشاف.');
      tips.push('اسأل: إيه أهم هدف حضرتك عايز توصله؟ ثم اربط الحل بالهدف.');
      tips.push('قبل الإغلاق: لخص في جملة واحدة واطلب خطوة محددة (موعد/تحويل/مستند).');
    }
    if (key.includes('support') || key.includes('customer') || key.includes('service')) {
      tips.push('ابدأ بتأكيد المشكلة ثم قدّم حل واحد واضح وخطوة متابعة.');
      tips.push('لو العميل متردد: قدّم اختيارين بدل سؤال مفتوح.');
    }
    if (!tips.length) {
      tips.push('جرّب: سؤال استكشاف + عرض مختصر + سؤال إغلاق.');
      tips.push('راجع آخر 5 مكالمات: فين نقطة الاعتراض المتكررة؟');
    }
    return tips.slice(0, 3);
  };

  const getTodayInteractionCounts = async (userId, { start, end }) => {
    const [callsCount, approvalsCount] = await Promise.all([
      prisma.interaction.count({
        where: {
          userId,
          type: { in: ['CALL', 'SEND'] },
          date: { gte: start, lt: end },
        },
      }),
      prisma.interaction.count({
        where: {
          userId,
          type: { in: ['CALL', 'SEND'] },
          outcome: 'AGREED',
          date: { gte: start, lt: end },
        },
      }),
    ]);
    return { callsCount, approvalsCount };
  };

  const buildTenantLeaderboard = async ({ tenantId, start, end }) => {
    const users = await prisma.user.findMany({
      where: { tenantId, role: 'SALES' },
      select: {
        id: true,
        name: true,
        tenantId: true,
        employeeProfile: true,
      },
    });
    const ids = users.map((u) => u.id);
    const [callsRows, approvalsRows] = ids.length
      ? await Promise.all([
          prisma.interaction.groupBy({
            by: ['userId'],
            where: {
              userId: { in: ids },
              type: { in: ['CALL', 'SEND'] },
              date: { gte: start, lt: end },
            },
            _count: { _all: true },
          }),
          prisma.interaction.groupBy({
            by: ['userId'],
            where: {
              userId: { in: ids },
              type: { in: ['CALL', 'SEND'] },
              outcome: 'AGREED',
              date: { gte: start, lt: end },
            },
            _count: { _all: true },
          }),
        ])
      : [[], []];

    const callsMap = callsRows.reduce((acc, row) => {
      acc.set(row.userId, row._count._all || 0);
      return acc;
    }, new Map());
    const approvalsMap = approvalsRows.reduce((acc, row) => {
      acc.set(row.userId, row._count._all || 0);
      return acc;
    }, new Map());

    const leaderboard = users.map((u) => ({
      userId: u.id,
      name: u.name,
      tenantId: u.tenantId,
      profile: u.employeeProfile,
      callsToday: callsMap.get(u.id) || 0,
      approvalsToday: approvalsMap.get(u.id) || 0,
    })).sort((a, b) => {
      if (b.callsToday !== a.callsToday) return b.callsToday - a.callsToday;
      return b.approvalsToday - a.approvalsToday;
    });

    const rankMap = leaderboard.reduce((acc, row, idx) => {
      acc.set(row.userId, idx + 1);
      return acc;
    }, new Map());

    return { leaderboard, rankMap };
  };

  const maybeSendMotivationPulse = async (userRow, { rankMap, leaderboard, start, end }) => {
    const userId = userRow.userId;
    const now = Date.now();
    const last = lastMotivationSentAtByUser.get(userId) || 0;
    if (now - last < 25 * 60 * 1000) return;
    lastMotivationSentAtByUser.set(userId, now);

    const callsCount = userRow.callsToday || 0;
    const approvalsCount = userRow.approvalsToday || 0;
    const callTarget = userRow.profile?.dailyCallTarget || 30;
    const approvalTarget = userRow.profile?.dailyApprovalTarget || 0;
    const remainingCalls = Math.max(0, callTarget - callsCount);
    const remainingApprovals = Math.max(0, approvalTarget - approvalsCount);
    if (remainingCalls === 0 && remainingApprovals === 0) return;

    const rank = rankMap.get(userId) || null;
    const third = leaderboard[2] || null;
    const gapCalls = third && rank && rank > 3 ? Math.max(0, (third.callsToday - callsCount) + 1) : 0;
    const gapApprovals = third && rank && rank > 3 ? Math.max(0, (third.approvalsToday - approvalsCount) + 1) : 0;
    const tips = buildJobTips(userRow.profile);
    const line = pickStableLine(`${userId}:${new Date().toISOString().slice(0, 13)}`, motivationalLines);

    const parts = [];
    if (remainingCalls > 0) parts.push(`${remainingCalls} مكالمة`);
    if (remainingApprovals > 0) parts.push(`${remainingApprovals} موافقة`);

    const rankText = rank
      ? (rank <= 3 ? `ترتيبك النهاردة: ${rank} (توب 3)` : `ترتيبك النهاردة: ${rank}`)
      : '';
    const top3Text = third && rank && rank > 3
      ? `علشان تدخل التوب 3: محتاج تقريباً +${gapCalls} مكالمة و +${gapApprovals} موافقة.`
      : '';

    const lowApprovalsMilestone = callsCount >= LOW_APPROVAL_CALLS_STEP
      ? Math.floor(callsCount / LOW_APPROVAL_CALLS_STEP) * LOW_APPROVAL_MIN_APPROVALS_PER_STEP
      : 0;
    const qualityText = lowApprovalsMilestone > 0 && approvalsCount < lowApprovalsMilestone
      ? `ملحوظة: موافقاتك أقل من المتوقع لنفس عدد المكالمات. ركّز على سؤال الإغلاق.`
      : '';

    const body = [
      `مكالمات: ${callsCount}/${callTarget}`,
      `موافقات: ${approvalsCount}/${approvalTarget}`,
      `المتبقي: ${parts.join(' و ')}`,
      rankText,
      top3Text,
      qualityText,
      tips[0] ? `نصيحة: ${tips[0]}` : '',
      line ? `تحفيز: ${line}` : '',
    ].filter(Boolean).join(' • ');

    await sendPushNotification(userId, {
      title: 'دفعة تحفيز',
      body,
      icon: '/icon-192.png',
    });
    broadcastUserEvent(userId, 'coach', {
      title: 'دفعة تحفيز',
      body,
      level: 'info',
      at: new Date().toISOString(),
    });
  };

  const maybeSendLowApprovalAlert = async (userId) => {
    try {
      const user = await prisma.user.findFirst({
        where: { id: userId },
        include: { employeeProfile: true },
      });
      if (!user || user.role !== 'SALES') return;
      const { start, end } = buildDayRange();
      const { callsCount, approvalsCount } = await getTodayInteractionCounts(userId, { start, end });
      if (!callsCount || callsCount % LOW_APPROVAL_CALLS_STEP !== 0) return;
      const milestone = Math.floor(callsCount / LOW_APPROVAL_CALLS_STEP);
      if (milestone < 1) return;
      const expectedApprovals = milestone * LOW_APPROVAL_MIN_APPROVALS_PER_STEP;
      if (approvalsCount >= expectedApprovals) return;

      const lastKey = lastLowApprovalAlertByUser.get(userId);
      const alertKey = `${new Date().toISOString().slice(0, 10)}:${callsCount}`;
      if (lastKey === alertKey) return;
      lastLowApprovalAlertByUser.set(userId, alertKey);

      const ratio = callsCount > 0 ? Math.round((approvalsCount / callsCount) * 100) : 0;
      const tips = buildJobTips(user.employeeProfile);
      const line = pickStableLine(`${userId}:${alertKey}`, motivationalLines);
      const body = [
        `عملت ${callsCount} مكالمة النهاردة والموافقات ${approvalsCount}.`,
        `ده أقل من المتوقع (${expectedApprovals}) لنفس عدد المكالمات.`,
        `نسبة التحويل: ${ratio}%.`,
        tips.length ? `نصيحة سريعة: ${tips[0]}` : '',
        tips[1] ? `كمان: ${tips[1]}` : '',
        line ? `تحفيز: ${line}` : '',
      ].filter(Boolean).join(' ');

      await sendPushNotification(userId, {
        title: 'مراجعة سريعة للأداء',
        body,
        icon: '/icon-192.png',
      });
      broadcastUserEvent(userId, 'coach', {
        title: 'مراجعة سريعة للأداء',
        body,
        level: 'warning',
        at: new Date().toISOString(),
      });
    } catch (error) {
      console.error('maybeSendLowApprovalAlert error:', error);
    }
  };

  const checkTargetCompletion = async (userId) => {
    try {
      const user = await prisma.user.findFirst({
        where: { id: userId },
        include: { employeeProfile: true, team: { select: { leadId: true } } },
      });
      if (!user || user.role !== 'SALES') return;

      const callTarget = user.employeeProfile?.dailyCallTarget || 30;
      const approvalTarget = user.employeeProfile?.dailyApprovalTarget || 0;
      const { start, end } = buildDayRange();
      const { callsCount, approvalsCount } = await getTodayInteractionCounts(userId, { start, end });

      const callsSatisfied = callsCount >= callTarget;
      const approvalsSatisfied = approvalsCount >= approvalTarget;
      const justReachedCalls = callsCount === callTarget;
      const justReachedApprovals = approvalTarget > 0 && approvalsCount === approvalTarget;

      if (callsSatisfied && approvalsSatisfied && (justReachedCalls || justReachedApprovals)) {
        await sendPushNotification(user.id, {
          title: 'عاش يا بطل! 🏆',
          body: `خلصت تارجت النهاردة (مكالمات: ${callsCount}/${callTarget}${approvalTarget > 0 ? ` • موافقات: ${approvalsCount}/${approvalTarget}` : ''}). استمر!`,
          icon: '/icon-192.png',
        });

        if (user.team?.leadId) {
          await sendPushNotification(user.team.leadId, {
            title: 'واحد من فريقك خلص! 🚀',
            body: `الموظف ${user.name} خلص تارجته النهاردة (مكالمات: ${callsCount}/${callTarget}${approvalTarget > 0 ? ` • موافقات: ${approvalsCount}/${approvalTarget}` : ''}).`,
            icon: '/icon-192.png',
          });
        }
      }
    } catch (error) {
      console.error('checkTargetCompletion error:', error);
    }
  };

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

  app.post('/api/admin/create-team-lead', authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    const actor = await getCurrentUserScope(req.user.id);
    if (!actor) return res.status(401).json({ error: 'Invalid user context' });
    const actorTenantError = assertTenantScopedUser(actor);
    if (actorTenantError) return res.status(400).json({ error: actorTenantError });
    const teamName = normalizeTeamName(req.body?.teamName);
    const leadName = normalizeNullableString(req.body?.name, 120);
    const leadEmail = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    if (!teamName) return res.status(400).json({ error: 'Team name is required' });
    if (!leadName) return res.status(400).json({ error: 'Name is required' });
    if (!leadEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(leadEmail)) return res.status(400).json({ error: 'Valid email is required' });
    if (typeof password !== 'string' || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const result = await prisma.$transaction(async (tx) => {
        let team = await tx.team.findFirst({
          where: { name: teamName, tenantId: actor.tenantId },
          select: { id: true, name: true },
        });
        if (!team) {
          team = await tx.team.create({
            data: { name: teamName, tenantId: actor.tenantId },
            select: { id: true, name: true },
          });
        }
        const leadersCount = await tx.user.count({
          where: { role: 'TEAM_LEAD', teamId: team.id },
        });
        if (leadersCount >= MAX_TEAM_LEADS_PER_TEAM) {
          throw new Error(`Each team can have only ${MAX_TEAM_LEADS_PER_TEAM} team leads`);
        }
        const user = await tx.user.create({
          data: {
            name: leadName,
            email: leadEmail,
            password: hashedPassword,
            role: 'TEAM_LEAD',
            tenantId: actor.tenantId,
            teamId: team.id,
          },
          select: { id: true, name: true, email: true, role: true, teamId: true },
        });
        return { team, user };
      });
      return res.status(201).json(result);
    } catch (error) {
      if (error?.code === 'P2002') {
        return res.status(409).json({ error: 'Email already exists' });
      }
      console.error(error);
      return res.status(500).json({ error: error?.message || 'Failed to create team lead' });
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
      return res.json([]);
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
      const yesterdayRange = buildDayRangeWithOffset(-1);
      const result = await Promise.all(teams.map(async (team) => {
        const salesIds = team.users.filter((member) => member.role === 'SALES').map((member) => member.id);
        const [agreed, hesitant, rejected, noAnswer, recontact, wrongNumber, poolCount, callsToday, callsYesterday, agreedToday, callsTodayRows, agreedTodayRows] = await Promise.all([
          prisma.lead.count({ where: { tenantId: actor.tenantId, teamId: team.id, source: { not: POOL_SOURCE }, status: 'AGREED' } }),
          prisma.lead.count({ where: { tenantId: actor.tenantId, teamId: team.id, source: { not: POOL_SOURCE }, status: 'HESITANT' } }),
          prisma.lead.count({ where: { tenantId: actor.tenantId, teamId: team.id, source: { not: POOL_SOURCE }, status: 'REJECTED' } }),
          prisma.lead.count({ where: { tenantId: actor.tenantId, teamId: team.id, source: { not: POOL_SOURCE }, status: 'NO_ANSWER' } }),
          prisma.lead.count({ where: { tenantId: actor.tenantId, teamId: team.id, source: { not: POOL_SOURCE }, status: 'RECONTACT' } }),
          prisma.lead.count({ where: { tenantId: actor.tenantId, teamId: team.id, source: { not: POOL_SOURCE }, status: 'WRONG_NUMBER' } }),
          prisma.lead.count({ where: buildPoolWhere({ tenantId: actor.tenantId, teamId: team.id }) }),
          prisma.interaction.count({
            where: {
              type: { in: ['CALL', 'SEND'] },
              date: { gte: start, lt: end },
              lead: { tenantId: actor.tenantId, teamId: team.id },
            },
          }),
          prisma.interaction.count({
            where: {
              type: { in: ['CALL', 'SEND'] },
              date: { gte: yesterdayRange.start, lt: yesterdayRange.end },
              lead: { tenantId: actor.tenantId, teamId: team.id },
            },
          }),
          prisma.interaction.count({
            where: {
              type: { in: ['CALL', 'SEND'] },
              outcome: 'AGREED',
              date: { gte: start, lt: end },
              lead: { tenantId: actor.tenantId, teamId: team.id },
            },
          }),
          salesIds.length
            ? prisma.interaction.findMany({
                where: {
                  userId: { in: salesIds },
                  type: { in: ['CALL', 'SEND'] },
                  date: { gte: start, lt: end },
                },
                select: { userId: true },
              })
            : Promise.resolve([]),
          salesIds.length
            ? prisma.interaction.findMany({
                where: {
                  userId: { in: salesIds },
                  type: { in: ['CALL', 'SEND'] },
                  outcome: 'AGREED',
                  date: { gte: start, lt: end },
                },
                select: { userId: true },
              })
            : Promise.resolve([]),
        ]);
        const salesMembers = team.users.filter((member) => member.role === 'SALES');
        const teamLeadMembers = team.users.filter((member) => member.role === 'TEAM_LEAD');
        const totalCallTarget = salesMembers.reduce((sum, member) => sum + (member.employeeProfile?.dailyCallTarget || 0), 0);
        const totalApprovalTarget = salesMembers.reduce((sum, member) => sum + (member.employeeProfile?.dailyApprovalTarget || 0), 0);
        const nonPoolTotal = agreed + hesitant + rejected + noAnswer + recontact + wrongNumber;
        const memberCallsMap = callsTodayRows.reduce((acc, item) => {
          if (!item.userId) return acc;
          acc.set(item.userId, (acc.get(item.userId) || 0) + 1);
          return acc;
        }, new Map());
        const memberAgreedMap = agreedTodayRows.reduce((acc, item) => {
          if (!item.userId) return acc;
          acc.set(item.userId, (acc.get(item.userId) || 0) + 1);
          return acc;
        }, new Map());
        const membersWithCalls = team.users.map((member) => ({
          ...member,
          callsToday: memberCallsMap.get(member.id) || 0,
          agreedToday: memberAgreedMap.get(member.id) || 0,
        }));
        const callsAchievementPercent = totalCallTarget > 0
          ? Number(((callsToday / totalCallTarget) * 100).toFixed(2))
          : 0;
        const approvalsAchievementPercent = totalApprovalTarget > 0
          ? Number(((agreedToday / totalApprovalTarget) * 100).toFixed(2))
          : 100;
        const targetAchievementPercent = Number(Math.min(callsAchievementPercent, approvalsAchievementPercent).toFixed(2));

        return {
          id: team.id,
          name: team.name,
          members: membersWithCalls,
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
            wrongNumber,
            callsToday,
            callsYesterday,
            agreedToday,
            totalCallTarget,
            totalApprovalTarget,
            totalTarget: totalCallTarget,
            targetAchievementPercent,
            callsAchievementPercent,
            approvalsAchievementPercent,
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
  app.put('/api/users/:id', authenticateToken, authorizeRole(['ADMIN', 'TEAM_LEAD']), async (req, res) => {
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
      const target = await prisma.user.findFirst({
        where: { id: userId, tenantId: actor.tenantId },
        select: { id: true, role: true, teamId: true, name: true, email: true },
      });
      if (!target) {
        return res.status(404).json({ error: 'User not found' });
      }

      const hasName = Object.prototype.hasOwnProperty.call(req.body, 'name');
      const hasEmail = Object.prototype.hasOwnProperty.call(req.body, 'email');
      const hasRole = Object.prototype.hasOwnProperty.call(req.body, 'role');
      const hasTeamId = Object.prototype.hasOwnProperty.call(req.body, 'teamId');

      const normalizedName = hasName ? normalizeNullableString(req.body.name, 120) : null;
      const normalizedEmail = hasEmail && typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : null;
      const normalizedRole = hasRole && typeof req.body.role === 'string' ? req.body.role.trim().toUpperCase() : null;

      if (hasName && !normalizedName) {
        return res.status(400).json({ error: 'Name is required' });
      }
      if (hasEmail && (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))) {
        return res.status(400).json({ error: 'Valid email is required' });
      }
      if (hasRole && !USER_ROLES.has(normalizedRole)) {
        return res.status(400).json({ error: 'Invalid role' });
      }

      if (actor.role === 'TEAM_LEAD') {
        if (!actor.teamId) {
          return res.status(400).json({ error: 'User is not assigned to a team' });
        }
        if (target.role !== 'SALES' || target.teamId !== actor.teamId) {
          return res.status(403).json({ error: 'You can only manage sales members from your team' });
        }
        if (hasRole || hasTeamId) {
          return res.status(403).json({ error: 'Team lead cannot change role or team assignment' });
        }
      }

      let nextRole = hasRole ? normalizedRole : target.role;
      let nextTeamId = hasTeamId ? parseOptionalTeamId(req.body.teamId) : target.teamId;
      if (actor.role === 'TEAM_LEAD') {
        nextRole = 'SALES';
        nextTeamId = actor.teamId;
      }
      if (nextRole === 'ADMIN') {
        nextTeamId = null;
      } else if (!nextTeamId) {
        return res.status(400).json({ error: 'Team is required for non-admin users' });
      }
      if (nextTeamId) {
        const team = await prisma.team.findFirst({
          where: { id: nextTeamId, tenantId: actor.tenantId },
          select: { id: true },
        });
        if (!team) {
          return res.status(404).json({ error: 'Team not found' });
        }
      }
      if (nextRole === 'TEAM_LEAD') {
        const leadCapacityError = await assertTeamLeadCapacity(nextTeamId, { excludeUserId: target.id });
        if (leadCapacityError) {
          return res.status(409).json({ error: leadCapacityError });
        }
      }

      const updated = await prisma.user.update({
        where: { id: target.id },
        data: {
          ...(hasName ? { name: normalizedName } : {}),
          ...(hasEmail ? { email: normalizedEmail } : {}),
          ...(actor.role === 'ADMIN' ? { role: nextRole, teamId: nextTeamId } : {}),
        },
        include: {
          team: { select: { id: true, name: true } },
          employeeProfile: true,
        },
      });

      return res.json(updated);
    } catch (error) {
      if (error?.code === 'P2002') {
        return res.status(409).json({ error: 'Email already exists' });
      }
      console.error(error);
      return res.status(500).json({ error: 'Failed to update user' });
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

    const { leads, teamId: rawTeamId, uploadScope, batchId: rawBatchId, batchName: rawBatchName, batchLocation: rawBatchLocation, isVip } = req.body;
    if (!Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ error: 'Leads array is required' });
    }

    const normalizedRows = leads.map((lead) => normalizeBulkLeadInput(lead)).filter(Boolean);
    if (!normalizedRows.length) {
      return res.status(400).json({ error: 'No valid leads to import' });
    }
    const deduplicatedMap = new Map();
    let duplicatesInPayload = 0;
    for (const row of normalizedRows) {
      const existing = deduplicatedMap.get(row.phone);
      if (!existing) {
        deduplicatedMap.set(row.phone, row);
        continue;
      }
      duplicatesInPayload += 1;
      if (!existing.hasProvidedName && row.hasProvidedName) {
        deduplicatedMap.set(row.phone, row);
      }
    }
    const safeLeads = [...deduplicatedMap.values()];

    try {
      const isUploadAll = actor.role === 'ADMIN' && uploadScope === 'ALL';
      const requestedTeamId = parseOptionalTeamId(rawTeamId);
      const requestedBatchId = parseOptionalTeamId(rawBatchId);
      const batchName = normalizeNullableString(rawBatchName, 120);
      const batchLocation = normalizeNullableString(rawBatchLocation, 120);
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

      let resolvedBatchId = null;
      if (requestedBatchId) {
        const existingBatch = await prisma.leadBatch.findFirst({
          where: { id: requestedBatchId, tenantId: actor.tenantId },
          select: { id: true },
        });
        if (!existingBatch) {
          return res.status(404).json({ error: 'Batch not found' });
        }
        resolvedBatchId = existingBatch.id;
      } else {
        const fallbackName = batchName || `رفع ${new Date().toLocaleDateString('en-CA')}`;
        const createdBatch = await prisma.leadBatch.create({
          data: {
            name: fallbackName,
            location: batchLocation,
            tenantId: actor.tenantId,
          },
          select: { id: true, name: true, location: true },
        });
        resolvedBatchId = createdBatch.id;
      }

      const existingLeads = await prisma.lead.findMany({
        where: {
          tenantId: actor.tenantId,
          phone: { in: safeLeads.map((lead) => lead.phone) },
        },
        select: { id: true, phone: true, name: true, hasProvidedName: true },
      });
      const existingByPhone = new Map(existingLeads.map((lead) => [lead.phone, lead]));
      const freshLeads = safeLeads.filter((lead) => !existingByPhone.has(lead.phone));
      const skippedExisting = safeLeads.length - freshLeads.length;
      let upgradedNames = 0;
      if (existingLeads.length) {
        for (const row of safeLeads) {
          const existing = existingByPhone.get(row.phone);
          if (!existing) continue;
          const shouldUpgradeName = row.hasProvidedName && (!existing.hasProvidedName || existing.name === UNKNOWN_LEAD_NAME);
          if (!shouldUpgradeName) continue;
          await prisma.lead.update({
            where: { id: existing.id },
            data: {
              name: row.name,
              hasProvidedName: true,
            },
          });
          upgradedNames += 1;
        }
      }
      let inserted = 0;
      if (freshLeads.length) {
        const createRows = async (teamId) => {
          await Promise.all(freshLeads.map(async (lead) => {
            await prisma.lead.create({
              data: {
                name: lead.name,
                phone: lead.phone,
                gender: lead.gender || 'UNKNOWN',
                hasProvidedName: !!lead.hasProvidedName,
                status: POOL_STATUS,
                source: POOL_SOURCE,
                agentId: null,
                teamId,
                tenantId: actor.tenantId,
                batchId: resolvedBatchId,
                isHiddenFromSales: false,
                isVip: !!isVip, // Add isVip flag here
              },
            });
            inserted += 1;
          }));
        };
        if (useGlobalPool) {
          await createRows(null);
        } else {
          for (const teamId of targetTeamIds) {
            await createRows(teamId);
          }
        }
      }
      const batch = await prisma.leadBatch.findFirst({
        where: { id: resolvedBatchId, tenantId: actor.tenantId },
        select: { id: true, name: true, location: true },
      });
      res.json({
        message: `Successfully added ${inserted} leads to pool`,
        teamsCount: useGlobalPool ? 0 : targetTeamIds.length,
        globalPool: useGlobalPool,
        inserted,
        skippedExisting,
        upgradedNames,
        duplicatesInPayload,
        totalReceived: leads.length,
        validRows: safeLeads.length,
        batch,
      });
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
    const batchId = parseOptionalTeamId(normalizeSingleQueryValue(req.query.batchId));
    const search = normalizeSingleQueryValue(req.query.search);
    const location = normalizeNullableString(normalizeSingleQueryValue(req.query.location), 120);
    const nameMode = typeof normalizeSingleQueryValue(req.query.nameMode) === 'string'
      ? String(normalizeSingleQueryValue(req.query.nameMode)).trim().toUpperCase()
      : 'ALL';
    const includeHidden = String(normalizeSingleQueryValue(req.query.includeHidden) || '0') === '1';
    const baseWhere = includeHidden
      ? { agentId: null, source: POOL_SOURCE, status: POOL_STATUS }
      : buildPoolWhere();
    const where = {
      ...baseWhere,
      tenantId: actor.tenantId,
      ...(teamId ? { teamId } : {}),
      ...(batchId ? { batchId } : {}),
      ...(nameMode === 'NAMED'
        ? { hasProvidedName: true }
        : nameMode === 'UNNAMED'
          ? { hasProvidedName: false }
          : {}),
      ...(location ? { batch: { location: { contains: location } } } : {}),
      ...(typeof search === 'string' && search.trim()
        ? {
            OR: [
              { name: { contains: search.trim() } },
              { phone: { contains: search.trim() } },
              { batch: { name: { contains: search.trim() } } },
            ],
          }
        : {}),
    };

    try {
      const teams = await prisma.team.findMany({
        where: { tenantId: actor.tenantId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });

      const [leads, total, remainingGroups, pulledGroups, pulledTotal] = await Promise.all([
        prisma.lead.findMany({
          where,
          include: {
            team: { select: { id: true, name: true } },
            batch: { select: { id: true, name: true, location: true } },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.lead.count({ where }),
        prisma.lead.groupBy({
          by: ['teamId'],
          where,
          _count: { _all: true },
        }),
        prisma.lead.groupBy({
          by: ['teamId'],
          where: {
            tenantId: actor.tenantId,
            ...(teamId ? { teamId } : {}),
            ...(batchId ? { batchId } : {}),
            ...(location ? { batch: { location: { contains: location } } } : {}),
            claimedAt: { not: null },
          },
          _count: { _all: true },
        }),
        prisma.lead.count({
          where: {
            tenantId: actor.tenantId,
            ...(teamId ? { teamId } : {}),
            ...(batchId ? { batchId } : {}),
            ...(location ? { batch: { location: { contains: location } } } : {}),
            claimedAt: { not: null },
          },
        }),
      ]);

      const teamNameById = teams.reduce((acc, t) => {
        acc.set(t.id, t.name);
        return acc;
      }, new Map());

      const remainingByTeamId = remainingGroups.reduce((acc, row) => {
        acc.set(row.teamId ?? null, row._count._all || 0);
        return acc;
      }, new Map());
      const pulledByTeamId = pulledGroups.reduce((acc, row) => {
        acc.set(row.teamId ?? null, row._count._all || 0);
        return acc;
      }, new Map());

      const allTeamIds = teams.map((t) => t.id);
      const allKeys = [null, ...allTeamIds];
      const teamStats = allKeys.map((key) => ({
        teamId: key,
        teamName: key === null ? 'غير محدد' : (teamNameById.get(key) || `Team ${key}`),
        remainingCount: remainingByTeamId.get(key) || 0,
        pulledCount: pulledByTeamId.get(key) || 0,
      }));

      return res.json({
        total,
        leads,
        summary: {
          remainingTotal: total,
          pulledTotal,
          teamStats,
        },
      });
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
    const batchId = parseOptionalTeamId(req.body?.batchId);
    const search = normalizeNullableString(req.body?.search, 120);
    const location = normalizeNullableString(req.body?.location, 120);
    const nameMode = typeof req.body?.nameMode === 'string' ? req.body.nameMode.trim().toUpperCase() : 'ALL';
    const includeHidden = req.body?.includeHidden === true;
    const mode = typeof req.body?.mode === 'string' ? req.body.mode.trim().toUpperCase() : 'ALL';
    const count = parseInteger(req.body?.count);
    const sort = typeof req.body?.sort === 'string' ? req.body.sort.trim().toUpperCase() : 'OLDEST';
    const baseWhere = includeHidden
      ? { agentId: null, source: POOL_SOURCE, status: POOL_STATUS }
      : buildPoolWhere();
    const where = {
      ...baseWhere,
      tenantId: actor.tenantId,
      ...(teamId ? { teamId } : {}),
      ...(batchId ? { batchId } : {}),
      ...(nameMode === 'NAMED'
        ? { hasProvidedName: true }
        : nameMode === 'UNNAMED'
          ? { hasProvidedName: false }
          : {}),
      ...(location ? { batch: { location: { contains: location } } } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { phone: { contains: search } },
              { batch: { name: { contains: search } } },
            ],
          }
        : {}),
    };

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

  app.get('/api/admin/pool-batches', authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    const actor = await getCurrentUserScope(req.user.id);
    if (!actor) {
      return res.status(401).json({ error: 'Invalid user context' });
    }
    const actorTenantError = assertTenantScopedUser(actor);
    if (actorTenantError) {
      return res.status(400).json({ error: actorTenantError });
    }
    const location = normalizeNullableString(normalizeSingleQueryValue(req.query.location), 120);
    const search = normalizeNullableString(normalizeSingleQueryValue(req.query.search), 120);
    try {
      const batches = await prisma.leadBatch.findMany({
        where: {
          tenantId: actor.tenantId,
          ...(location ? { location: { contains: location } } : {}),
          ...(search ? { name: { contains: search } } : {}),
        },
        orderBy: { createdAt: 'desc' },
      });
      const batchStats = await Promise.all(
        batches.map(async (batch) => {
          const [totalNumbers, namedCount, unnamedCount, inPoolVisible, hiddenUnclaimed, pulledCount, contactedCount, agreedCount, hesitantCount, rejectedCount, noAnswerCount, recontactCount, wrongNumberCount, byUser] = await Promise.all([
            prisma.lead.count({ where: { tenantId: actor.tenantId, batchId: batch.id } }),
            prisma.lead.count({ where: { tenantId: actor.tenantId, batchId: batch.id, hasProvidedName: true } }),
            prisma.lead.count({ where: { tenantId: actor.tenantId, batchId: batch.id, hasProvidedName: false } }),
            prisma.lead.count({ where: buildPoolWhere({ tenantId: actor.tenantId, batchId: batch.id }) }),
            prisma.lead.count({ where: buildPoolWhere({ tenantId: actor.tenantId, batchId: batch.id, isHiddenFromSales: true }) }),
            prisma.lead.count({ where: { tenantId: actor.tenantId, batchId: batch.id, claimedAt: { not: null } } }),
            prisma.interaction.findMany({
              where: {
                lead: { tenantId: actor.tenantId, batchId: batch.id },
                type: { in: ['CALL', 'SEND'] },
              },
              select: { leadId: true },
              distinct: ['leadId'],
            }).then((rows) => rows.length),
            prisma.lead.count({ where: { tenantId: actor.tenantId, batchId: batch.id, status: 'AGREED' } }),
            prisma.lead.count({ where: { tenantId: actor.tenantId, batchId: batch.id, status: 'HESITANT' } }),
            prisma.lead.count({ where: { tenantId: actor.tenantId, batchId: batch.id, status: 'REJECTED' } }),
            prisma.lead.count({ where: { tenantId: actor.tenantId, batchId: batch.id, status: 'NO_ANSWER' } }),
            prisma.lead.count({ where: { tenantId: actor.tenantId, batchId: batch.id, status: 'RECONTACT' } }),
            prisma.lead.count({ where: { tenantId: actor.tenantId, batchId: batch.id, status: 'WRONG_NUMBER' } }),
            prisma.interaction.findMany({
              where: {
                userId: { not: null },
                lead: { tenantId: actor.tenantId, batchId: batch.id },
                type: { in: ['CALL', 'SEND'] },
              },
              select: { userId: true },
            }),
          ]);
          const userCountMap = byUser.reduce((acc, row) => {
            if (!row.userId) return acc;
            acc.set(row.userId, (acc.get(row.userId) || 0) + 1);
            return acc;
          }, new Map());
          const userIds = [...userCountMap.keys()];
          const users = userIds.length
            ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
            : [];
          const userMap = new Map(users.map((user) => [user.id, user.name]));
          const contactedBy = [...userCountMap.entries()]
            .map(([userId, interactions]) => ({
              userId,
              name: userMap.get(userId) || 'غير معروف',
              interactions,
            }))
            .sort((a, b) => b.interactions - a.interactions)
            .slice(0, 8);
          return {
            id: batch.id,
            name: batch.name,
            location: batch.location,
            createdAt: batch.createdAt,
            stats: {
              totalNumbers,
              namedCount,
              unnamedCount,
              inPoolVisible,
              hiddenUnclaimed,
              pulledCount,
              contactedCount,
              agreedCount,
              hesitantCount,
              rejectedCount,
              noAnswerCount,
              recontactCount,
              wrongNumberCount,
              contactedBy,
            },
          };
        }),
      );
      return res.json(batchStats);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to fetch pool batches' });
    }
  });

  app.post('/api/admin/pool-batches/:id/redistribute', authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    const actor = await getCurrentUserScope(req.user.id);
    if (!actor) {
      return res.status(401).json({ error: 'Invalid user context' });
    }
    const actorTenantError = assertTenantScopedUser(actor);
    if (actorTenantError) {
      return res.status(400).json({ error: actorTenantError });
    }
    const batchId = parseInteger(req.params.id);
    const targetTeamId = parseOptionalTeamId(req.body?.targetTeamId);
    if (batchId === null || batchId < 1) {
      return res.status(400).json({ error: 'Invalid batch id' });
    }
    try {
      const batch = await prisma.leadBatch.findFirst({ where: { id: batchId, tenantId: actor.tenantId }, select: { id: true } });
      if (!batch) {
        return res.status(404).json({ error: 'Batch not found' });
      }
      if (targetTeamId) {
        const team = await prisma.team.findFirst({ where: { id: targetTeamId, tenantId: actor.tenantId }, select: { id: true } });
        if (!team) {
          return res.status(404).json({ error: 'Target team not found' });
        }
      }
      const result = await prisma.lead.updateMany({
        where: buildPoolWhere({ tenantId: actor.tenantId, batchId }),
        data: { teamId: targetTeamId, isHiddenFromSales: false },
      });
      return res.json({ moved: result.count, message: `Moved ${result.count} unclaimed leads` });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to redistribute batch' });
    }
  });

  app.post('/api/admin/pool-batches/:id/hide-unclaimed', authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    const actor = await getCurrentUserScope(req.user.id);
    if (!actor) {
      return res.status(401).json({ error: 'Invalid user context' });
    }
    const actorTenantError = assertTenantScopedUser(actor);
    if (actorTenantError) {
      return res.status(400).json({ error: actorTenantError });
    }
    const batchId = parseInteger(req.params.id);
    if (batchId === null || batchId < 1) {
      return res.status(400).json({ error: 'Invalid batch id' });
    }
    try {
      const result = await prisma.lead.updateMany({
        where: buildPoolWhere({ tenantId: actor.tenantId, batchId }),
        data: { isHiddenFromSales: true },
      });
      return res.json({ hidden: result.count, message: `Hidden ${result.count} unclaimed leads` });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to hide unclaimed leads' });
    }
  });

  app.post('/api/admin/pool-batches/:id/unhide-unclaimed', authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    const actor = await getCurrentUserScope(req.user.id);
    if (!actor) {
      return res.status(401).json({ error: 'Invalid user context' });
    }
    const actorTenantError = assertTenantScopedUser(actor);
    if (actorTenantError) {
      return res.status(400).json({ error: actorTenantError });
    }
    const batchId = parseInteger(req.params.id);
    if (batchId === null || batchId < 1) {
      return res.status(400).json({ error: 'Invalid batch id' });
    }
    try {
      const result = await prisma.lead.updateMany({
        where: buildPoolWhere({ tenantId: actor.tenantId, batchId, isHiddenFromSales: true }),
        data: { isHiddenFromSales: false },
      });
      return res.json({ visible: result.count, message: `Restored ${result.count} leads` });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to restore unclaimed leads' });
    }
  });

  app.get('/api/admin/pool-batches/:id/export-active-leads', authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    const actor = await getCurrentUserScope(req.user.id);
    if (!actor) return res.status(401).json({ error: 'Invalid user context' });
    const actorTenantError = assertTenantScopedUser(actor);
    if (actorTenantError) return res.status(400).json({ error: actorTenantError });
    const batchId = parseInteger(req.params.id);
    if (batchId === null || batchId < 1) return res.status(400).json({ error: 'Invalid batch id' });
    try {
      const rows = await prisma.lead.findMany({
        where: {
          tenantId: actor.tenantId,
          batchId,
          status: 'AGREED',
          agentId: { not: null },
        },
        include: {
          agent: { select: { name: true, email: true } },
          team: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      const header = ['name', 'phone', 'team', 'agentName', 'agentEmail', 'status', 'notes', 'createdAt'];
      const csv = [header, ...rows.map((row) => [
        row.name,
        row.phone,
        row.team?.name || '',
        row.agent?.name || '',
        row.agent?.email || '',
        row.status,
        row.notes || '',
        row.createdAt.toISOString(),
      ])]
        .map((cols) => cols.map((col) => `"${String(col).replace(/"/g, '""')}"`).join(','))
        .join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="batch-${batchId}-active-leads.csv"`);
      return res.send(`\uFEFF${csv}`);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to export active leads' });
    }
  });

  // POST /api/leads/claim (Sales - Get a lead from pool)
  app.post('/api/leads/claim', authenticateToken, async (req, res) => {
    if (req.user.role !== 'SALES') {
      return res.status(403).json({ error: 'Only sales users can claim pool leads' });
    }

    const { type } = req.body; // 'vip' or 'regular'
    const isVipClaim = type === 'vip';

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
      // VIP Logic Check
      if (isVipClaim) {
        const profile = await prisma.employeeProfile.findUnique({ where: { userId } });
        const manualLimit = profile?.manualVipLimit;
        
        let dailyLimit = 0;

        if (manualLimit !== null && manualLimit !== undefined) {
           dailyLimit = manualLimit;
        } else {
           // Automatic calculation based on TOTAL approvals
           const totalApprovals = await prisma.interaction.count({
             where: {
               userId,
               outcome: 'AGREED',
               type: { in: ['CALL', 'SEND'] }
             }
           });
           
           if (totalApprovals >= 20) {
             // 20 -> 1, 30 -> 2, ..., 80 -> 7
             dailyLimit = Math.min(7, Math.floor((totalApprovals - 10) / 10));
           }
        }

        if (dailyLimit <= 0) {
          return res.status(403).json({ error: 'You are not eligible for VIP leads yet.' });
        }

        const todayStart = new Date();
        todayStart.setHours(0,0,0,0);
        
        const vipClaimedToday = await prisma.lead.count({
          where: {
            agentId: userId,
            isVip: true,
            claimedAt: { gte: todayStart }
          }
        });

        if (vipClaimedToday >= dailyLimit) {
          return res.status(403).json({ error: `You have reached your daily VIP limit (${dailyLimit}).` });
        }
      }

      const staleThreshold = new Date(Date.now() - CLAIM_TIMEOUT_MINUTES * 60 * 1000);
      
      // Clean up stale claims (only for regular leads or general cleanup)
      // We might want to be careful not to uncliam VIPs if they are special, but generally same rules apply
      await prisma.lead.updateMany({
        where: {
          tenantId: actor.tenantId,
          teamId: actor.teamId,
          source: POOL_SOURCE,
          status: POOL_STATUS,
          agentId: { not: null },
          claimedAt: { lt: staleThreshold },
        },
        data: {
          agentId: null,
          claimedAt: null,
        },
      });

      // Build Query
      const claimWhere = {
        tenantId: actor.tenantId,
        source: POOL_SOURCE,
        status: POOL_STATUS,
        agentId: null,
        isHiddenFromSales: false,
        isVip: isVipClaim // Strictly match VIP status
      };

      if (actor.teamId) {
        // If user is in a team, they can claim leads assigned to their team OR leads with no team
        claimWhere.OR = [
          { teamId: actor.teamId },
          { teamId: null }
        ];
      } else {
        // If user has no team (unlikely for SALES but possible), only claim no-team leads
        claimWhere.teamId = null;
      }

      const maxAttempts = 5;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const poolCount = await prisma.lead.count({ where: claimWhere });
        
        if (!poolCount) {
          return res.status(404).json({ error: isVipClaim ? 'No VIP leads available' : 'No leads available in pool' });
        }

        const randomSkip = Math.floor(Math.random() * poolCount);
        const lead = await prisma.lead.findFirst({
          where: claimWhere,
          skip: randomSkip,
        });

        if (!lead) {
           return res.status(404).json({ error: isVipClaim ? 'No VIP leads available' : 'No leads available in pool' });
        }

        // Try to claim
        const updateResult = await prisma.lead.updateMany({
          where: {
            id: lead.id,
            agentId: null // Optimistic locking
          },
          data: { 
            agentId: userId, 
            status: POOL_STATUS, 
            teamId: actor.teamId, 
            claimedAt: new Date() 
          },
        });

        if (updateResult.count > 0) {
          const updatedLead = await prisma.lead.findUnique({ where: { id: lead.id } });
          return res.json(updatedLead);
        }
        // If count is 0, someone else claimed it, retry loop
      }

      return res.status(409).json({ error: 'Could not claim a lead after multiple attempts. Please try again.' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to claim lead' });
    }
  });

  // GET /api/me/vip-status
  app.get('/api/me/vip-status', authenticateToken, async (req, res) => {
    if (req.user.role !== 'SALES') return res.status(403).json({ error: 'Not allowed' });
    
    try {
      const userId = req.user.id;
      const profile = await prisma.employeeProfile.findUnique({ where: { userId } });
      const manualLimit = profile?.manualVipLimit;
      
      let dailyLimit = 0;
      let isManual = false;

      if (manualLimit !== null && manualLimit !== undefined) {
         dailyLimit = manualLimit;
         isManual = true;
      } else {
         const totalApprovals = await prisma.interaction.count({
           where: {
             userId,
             outcome: 'AGREED',
             type: { in: ['CALL', 'SEND'] }
           }
         });
         
         if (totalApprovals >= 20) {
           dailyLimit = Math.min(7, Math.floor((totalApprovals - 10) / 10));
         }
      }

      const todayStart = new Date();
      todayStart.setHours(0,0,0,0);
      
      const claimedToday = await prisma.lead.count({
        where: {
          agentId: userId,
          isVip: true,
          claimedAt: { gte: todayStart }
        }
      });

      res.json({
        dailyLimit,
        claimedToday,
        remaining: Math.max(0, dailyLimit - claimedToday),
        isManual
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to fetch VIP status' });
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

    const { name, status, source, notes, courseId, gender, whatsappPhone, profileDetails } = req.body;
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
    const normalizedProfileDetails = normalizeNullableString(profileDetails, 2000);

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
      const existingLead = await prisma.lead.findFirst({ where: { id: leadId } });
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
              hasProvidedName: hasValidProvidedName(name),
              notes,
              gender: normalizedGender,
              status: POOL_STATUS,
              source: POOL_SOURCE,
              agentId: null,
              claimedAt: null,
              courseId: null,
              whatsappPhone: null,
              profileDetails: normalizedProfileDetails,
              isHiddenFromSales: false,
            },
          });
        }

        const updatedLead = await tx.lead.update({
          where: { id: leadId },
          data: {
            name: name.trim(),
            hasProvidedName: hasValidProvidedName(name),
            notes,
            gender: normalizedGender,
            status,
            source,
            agentId: req.user.id,
            courseId: Number.isNaN(parsedCourseId) ? null : parsedCourseId,
            whatsappPhone: hasWhatsappPhone ? normalizedWhatsappPhone : null,
            profileDetails: normalizedProfileDetails,
            isVip: existingLead.isVip, // Maintain VIP status if set
          },
        });

        await tx.interaction.create({
          data: {
            leadId: updatedLead.id,
            userId: req.user.id,
            type: source === 'SEND' ? 'SEND' : 'CALL',
            outcome: status || null,
            notes: notes || null,
          },
        });
        checkTargetCompletion(req.user.id).catch(() => {});
        maybeSendLowApprovalAlert(req.user.id).catch(() => {});
        broadcastTenantEvent(req.user?.tenantId, 'invalidate', {
          at: new Date().toISOString(),
          kind: 'interaction',
          userId: req.user?.id,
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
        data: { agentId: req.user.id, status: POOL_STATUS, claimedAt: new Date() },
      });

      if (!assigned.count) {
        return res.status(409).json({ error: 'Lead is no longer available' });
      }

      const lead = await prisma.lead.findFirst({ where: { id: leadId } });
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
      const existingLead = await prisma.lead.findFirst({ where: { id: leadId } });
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
      const existingLead = await prisma.lead.findFirst({ where: { id: leadId } });
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
            userId: req.user.id,
            type: source === 'SEND' ? 'SEND' : 'CALL',
            outcome,
            notes: notes || null,
          },
        });
        checkTargetCompletion(req.user.id).catch(() => {});
        maybeSendLowApprovalAlert(req.user.id).catch(() => {});
        broadcastTenantEvent(req.user?.tenantId, 'invalidate', {
          at: new Date().toISOString(),
          kind: 'interaction',
          userId: req.user?.id,
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
      const lead = await prisma.lead.findFirst({
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
        where.OR = [
          { agentId: req.user.id },
          {
            interactions: {
              some: {
                userId: req.user.id,
                type: { in: ['CALL', 'SEND'] },
              },
            },
          },
        ];
      }

      const leads = await prisma.lead.findMany({
        where,
        include: {
          agent: { select: { name: true, email: true } },
          course: true
        },
        orderBy: { createdAt: 'desc' }
      });
      const leadIds = leads.map((lead) => lead.id);
      const lastRows = leadIds.length
        ? await prisma.interaction.groupBy({
            by: ['leadId'],
            where: {
              leadId: { in: leadIds },
              type: { in: ['CALL', 'SEND'] },
            },
            _max: { date: true },
          })
        : [];
      const lastMap = lastRows.reduce((acc, row) => {
        acc.set(row.leadId, row._max?.date || null);
        return acc;
      }, new Map());

      const payload = leads.map((lead) => ({
        ...lead,
        lastInteractionAt: lastMap.get(lead.id) || null,
      })).sort((a, b) => {
        const aLast = a.lastInteractionAt ? new Date(a.lastInteractionAt).getTime() : -1;
        const bLast = b.lastInteractionAt ? new Date(b.lastInteractionAt).getTime() : -1;
        if (aLast !== bLast) return bLast - aLast;
        const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bCreated - aCreated;
      });
      res.json(payload);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to fetch leads' });
    }
  });

  // POST /api/leads (Manually add lead)
  app.post('/api/leads', authenticateToken, async (req, res) => {
    const { name, phone, status, source, notes, courseId, gender, whatsappPhone, teamId: rawTeamId, profileDetails } = req.body;
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
    const normalizedProfileDetails = normalizeNullableString(profileDetails, 2000);
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

      const existingLead = await prisma.lead.findFirst({
        where: { tenantId: actor.tenantId, phone: normalizedPhone },
        select: { id: true },
      });

      const lead = await prisma.$transaction(async (tx) => {
        const createdLead = existingLead
          ? await tx.lead.update({
              where: { id: existingLead.id },
              data: {
                name: normalizeLeadName(name),
                hasProvidedName: hasValidProvidedName(name),
                gender: normalizedGender,
                status: effectiveStatus,
                source: effectiveSource,
                notes,
                profileDetails: normalizedProfileDetails,
                agentId: req.user.id,
                teamId: effectiveTeamId,
                courseId: Number.isNaN(parsedCourseId) ? null : parsedCourseId,
                whatsappPhone: normalizedWhatsappPhone,
                isHiddenFromSales: false,
                claimedAt: new Date(),
              },
            })
          : await tx.lead.create({
              data: {
                name: normalizeLeadName(name),
                hasProvidedName: hasValidProvidedName(name),
                phone: normalizedPhone,
                gender: normalizedGender,
                status: effectiveStatus,
                source: effectiveSource,
                notes,
                profileDetails: normalizedProfileDetails,
                agentId: req.user.id,
                teamId: effectiveTeamId,
                tenantId: actor.tenantId,
                courseId: Number.isNaN(parsedCourseId) ? null : parsedCourseId,
                whatsappPhone: normalizedWhatsappPhone,
                claimedAt: new Date(),
              },
            });

        if (req.user.role === 'SALES' || req.user.role === 'TEAM_LEAD') {
          await tx.interaction.create({
            data: {
              leadId: createdLead.id,
              userId: req.user.id,
              type: effectiveSource === 'SEND' ? 'SEND' : 'CALL',
              outcome: createdLead.status || null,
              notes: createdLead.notes || null,
            },
          });
          checkTargetCompletion(req.user.id).catch(() => {});
          maybeSendLowApprovalAlert(req.user.id).catch(() => {});
          broadcastTenantEvent(req.user?.tenantId, 'invalidate', {
            at: new Date().toISOString(),
            kind: 'interaction',
            userId: req.user?.id,
          });
        }

        return createdLead;
      });

      res.status(existingLead ? 200 : 201).json(lead);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to create lead', details: error.message });
    }
  });

  // PUT /api/leads/:id (Update lead status/notes)
  app.put('/api/leads/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { name, status, notes, logCall, gender, whatsappPhone, profileDetails } = req.body;
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
    const hasProfileDetails = Object.prototype.hasOwnProperty.call(req.body, 'profileDetails');
    const normalizedProfileDetails = hasProfileDetails ? normalizeNullableString(profileDetails, 2000) : null;

    try {
      const actor = await getCurrentUserScope(req.user.id);
      if (!actor) {
        return res.status(401).json({ error: 'Invalid user context' });
      }
      const actorTenantError = assertTenantScopedUser(actor);
      if (actorTenantError) {
        return res.status(400).json({ error: actorTenantError });
      }
      const existingLead = await prisma.lead.findFirst({ where: { id: leadId } });
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
            ...(typeof name === 'string' ? { hasProvidedName: hasValidProvidedName(name) } : {}),
            status,
            notes,
            ...(hasGender ? { gender: normalizedGender } : {}),
            ...(hasWhatsappPhone ? { whatsappPhone: normalizedWhatsappPhone } : {}),
            ...(hasProfileDetails ? { profileDetails: normalizedProfileDetails } : {}),
          }
        });

        if (logCall && (req.user.role === 'SALES' || req.user.role === 'TEAM_LEAD')) {
          await tx.interaction.create({
            data: {
              leadId: leadId,
              userId: req.user.id,
              type: 'CALL',
              outcome: status || null,
              notes: notes || null,
            },
          });
          checkTargetCompletion(req.user.id).catch(() => {});
          maybeSendLowApprovalAlert(req.user.id).catch(() => {});
          broadcastTenantEvent(req.user?.tenantId, 'invalidate', {
            at: new Date().toISOString(),
            kind: 'interaction',
            userId: req.user?.id,
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

      const teamIdFilter = req.query.teamId ? parseInt(req.query.teamId) : null;

      const where = { tenantId: actor.tenantId };
      if (actor.role === 'ADMIN') {
        if (teamIdFilter) {
          where.teamId = teamIdFilter;
        }
      } else if (actor.role === 'TEAM_LEAD') {
        if (!actor.teamId) return res.status(400).json({ error: 'User is not assigned to a team' });
        where.teamId = actor.teamId;
      } else if (actor.role === 'SALES') {
        if (!actor.teamId) return res.status(400).json({ error: 'User is not assigned to a team' });
        // Global where for sales dashboard stays the same
        where.OR = [
          { agentId: req.user.id },
          {
            interactions: {
              some: {
                userId: req.user.id,
                type: { in: ['CALL', 'SEND'] },
              },
            },
          },
        ];
      }

      const { start, end } = buildDayRange();
      const yesterdayRange = buildDayRangeWithOffset(-1);
      const customerWhere = { ...where, source: { not: POOL_SOURCE } };
      const [total, agreed, hesitant, rejected, noAnswer, recontact, wrongNumber] = await Promise.all([
        prisma.lead.count({ where: customerWhere }),
        prisma.lead.count({ where: { ...where, source: { not: POOL_SOURCE }, status: 'AGREED' } }),
        prisma.lead.count({ where: { ...where, source: { not: POOL_SOURCE }, status: 'HESITANT' } }),
        prisma.lead.count({ where: { ...where, source: { not: POOL_SOURCE }, status: 'REJECTED' } }),
        prisma.lead.count({ where: { ...where, source: { not: POOL_SOURCE }, status: 'NO_ANSWER' } }),
        prisma.lead.count({ where: { ...where, source: { not: POOL_SOURCE }, status: 'RECONTACT' } }),
        prisma.lead.count({ where: { ...where, source: { not: POOL_SOURCE }, status: 'WRONG_NUMBER' } }),
      ]);

      // If Admin, also get pool count
      let poolCount = 0;
      let callsToday = 0;
      let callsYesterday = 0;
      let approvalsToday = 0;
      let approvalsYesterday = 0;
      let dailyCallTarget = null;
      let dailyApprovalTarget = null;
      let teamMembersPerformance = [];
      let leaderboard = [];

      if (actor.role === 'ADMIN' || actor.role === 'TEAM_LEAD' || actor.role === 'SALES') {
        // Calculate leaderboard for everyone in the same tenant
        const allTenantSales = await prisma.user.findMany({
          where: { role: 'SALES', tenantId: actor.tenantId },
          select: {
            id: true,
            name: true,
            employeeProfile: { select: { dailyCallTarget: true, dailyApprovalTarget: true } },
          },
        });
        const tenantSalesIds = allTenantSales.map(m => m.id);

        const tenantCallsTodayByAgent = tenantSalesIds.length ? await prisma.interaction.groupBy({
          by: ['userId'],
          where: {
            userId: { in: tenantSalesIds },
            type: { in: ['CALL', 'SEND'] },
            date: { gte: start, lt: end },
          },
          _count: { _all: true },
        }) : [];

        const tenantAgreedTodayByAgent = tenantSalesIds.length ? await prisma.interaction.groupBy({
          by: ['userId'],
          where: {
            userId: { in: tenantSalesIds },
            type: { in: ['CALL', 'SEND'] },
            outcome: 'AGREED',
            date: { gte: start, lt: end },
          },
          _count: { _all: true },
        }) : [];

        const tCallsMap = tenantCallsTodayByAgent.reduce((acc, row) => {
          acc[row.userId] = row._count._all;
          return acc;
        }, {});

        const tAgreedMap = tenantAgreedTodayByAgent.reduce((acc, row) => {
          acc[row.userId] = row._count._all;
          return acc;
        }, {});

        leaderboard = allTenantSales.map(m => ({
          userId: m.id,
          name: m.name,
          callsToday: tCallsMap[m.id] || 0,
          agreedToday: tAgreedMap[m.id] || 0,
          dailyCallTarget: m.employeeProfile?.dailyCallTarget || 30,
          dailyApprovalTarget: m.employeeProfile?.dailyApprovalTarget || 0,
        })).sort((a, b) => {
          // Priority 1: Agreed Today (Descending)
          if (b.agreedToday !== a.agreedToday) return b.agreedToday - a.agreedToday;
          // Priority 2: Calls Today (Descending)
          return b.callsToday - a.callsToday;
        });
      }

      if (actor.role === 'ADMIN') {
        poolCount = await prisma.lead.count({ where: buildPoolWhere({ tenantId: actor.tenantId, teamId: teamIdFilter }) });
        
        const filteredSales = await prisma.user.findMany({
          where: { 
            role: 'SALES', 
            tenantId: actor.tenantId,
            ...(teamIdFilter ? { teamId: teamIdFilter } : {})
          },
          select: {
            id: true,
            name: true,
            employeeProfile: { select: { dailyCallTarget: true, dailyApprovalTarget: true, phone: true } },
          },
        });
        const fSalesIds = filteredSales.map(m => m.id);
        
        teamMembersPerformance = filteredSales.map((m) => {
          const stats = leaderboard.find(l => l.userId === m.id);
          return {
            userId: m.id,
            name: m.name,
            dailyCallTarget: m.employeeProfile?.dailyCallTarget || 30,
            dailyApprovalTarget: m.employeeProfile?.dailyApprovalTarget || 0,
            callsToday: stats?.callsToday || 0,
            agreedToday: stats?.agreedToday || 0,
            phone: m.employeeProfile?.phone || null,
          };
        }).sort((a, b) => {
          const aDone = a.callsToday >= a.dailyCallTarget && a.agreedToday >= a.dailyApprovalTarget;
          const bDone = b.callsToday >= b.dailyCallTarget && b.agreedToday >= b.dailyApprovalTarget;
          if (aDone && !bDone) return -1;
          if (!aDone && bDone) return 1;
          // Priority 1: Agreed Today (Descending)
          if (b.agreedToday !== a.agreedToday) return b.agreedToday - a.agreedToday;
          // Priority 2: Calls Today (Descending)
          return b.callsToday - a.callsToday;
        });
      } else if (actor.role === 'SALES') {
        const profile = await ensureEmployeeProfile(req.user.id);
        dailyCallTarget = profile.dailyCallTarget;
        dailyApprovalTarget = profile.dailyApprovalTarget || 0;
        callsToday = await prisma.interaction.count({
          where: {
            userId: req.user.id,
            type: { in: ['CALL', 'SEND'] },
            date: { gte: start, lt: end },
            lead: { tenantId: actor.tenantId },
          },
        });
        approvalsToday = await prisma.interaction.count({
          where: {
            userId: req.user.id,
            type: { in: ['CALL', 'SEND'] },
            outcome: 'AGREED',
            date: { gte: start, lt: end },
            lead: { tenantId: actor.tenantId },
          },
        });
        callsYesterday = await prisma.interaction.count({
          where: {
            userId: req.user.id,
            type: { in: ['CALL', 'SEND'] },
            date: { gte: yesterdayRange.start, lt: yesterdayRange.end },
            lead: { tenantId: actor.tenantId },
          },
        });
        approvalsYesterday = await prisma.interaction.count({
          where: {
            userId: req.user.id,
            type: { in: ['CALL', 'SEND'] },
            outcome: 'AGREED',
            date: { gte: yesterdayRange.start, lt: yesterdayRange.end },
            lead: { tenantId: actor.tenantId },
          },
        });
      } else if (actor.role === 'TEAM_LEAD') {
        const teamMembers = await prisma.user.findMany({
          where: { role: 'SALES', teamId: actor.teamId || -1, tenantId: actor.tenantId },
          select: {
            id: true,
            name: true,
            employeeProfile: { select: { dailyCallTarget: true, dailyApprovalTarget: true, phone: true } },
          },
        });
        const salesIds = teamMembers.map((member) => member.id);
        dailyCallTarget = teamMembers.reduce((sum, member) => sum + (member.employeeProfile?.dailyCallTarget || 30), 0);
        dailyApprovalTarget = teamMembers.reduce((sum, member) => sum + (member.employeeProfile?.dailyApprovalTarget || 0), 0);
        
        teamMembersPerformance = teamMembers.map((m) => {
          const stats = leaderboard.find(l => l.userId === m.id);
          return {
            userId: m.id,
            name: m.name,
            dailyCallTarget: m.employeeProfile?.dailyCallTarget || 30,
            dailyApprovalTarget: m.employeeProfile?.dailyApprovalTarget || 0,
            callsToday: stats?.callsToday || 0,
            agreedToday: stats?.agreedToday || 0,
            phone: m.employeeProfile?.phone || null,
          };
        }).sort((a, b) => {
          const aDone = a.callsToday >= a.dailyCallTarget && a.agreedToday >= a.dailyApprovalTarget;
          const bDone = b.callsToday >= b.dailyCallTarget && b.agreedToday >= b.dailyApprovalTarget;
          if (aDone && !bDone) return -1;
          if (!aDone && bDone) return 1;
          // Priority 1: Agreed Today (Descending)
          if (b.agreedToday !== a.agreedToday) return b.agreedToday - a.agreedToday;
          // Priority 2: Calls Today (Descending)
          return b.callsToday - a.callsToday;
        });

        callsToday = teamMembersPerformance.reduce((sum, m) => sum + m.callsToday, 0);
        approvalsToday = teamMembersPerformance.reduce((sum, m) => sum + m.agreedToday, 0);
        
        callsYesterday = salesIds.length
          ? await prisma.interaction.count({
              where: {
                userId: { in: salesIds },
                type: { in: ['CALL', 'SEND'] },
                date: { gte: yesterdayRange.start, lt: yesterdayRange.end },
              },
            })
          : 0;
        approvalsYesterday = salesIds.length
          ? await prisma.interaction.count({
              where: {
                userId: { in: salesIds },
                type: { in: ['CALL', 'SEND'] },
                outcome: 'AGREED',
                date: { gte: yesterdayRange.start, lt: yesterdayRange.end },
              },
            })
          : 0;
        poolCount = await prisma.lead.count({ where: buildPoolWhere({ teamId: actor.teamId, tenantId: actor.tenantId }) });
      }
      const safeTotal = safeCount(total);
      const safeAgreed = safeCount(agreed);
      const safeHesitant = safeCount(hesitant);
      const safeRejected = safeCount(rejected);
      const safeNoAnswer = safeCount(noAnswer);
      const safeRecontact = safeCount(recontact);
      const safeWrongNumber = safeCount(wrongNumber);
      const safePoolCount = safeCount(poolCount);
      const safeCallsToday = safeCount(callsToday);
      const safeCallsYesterday = safeCount(callsYesterday);
      const safeApprovalsToday = safeCount(approvalsToday);
      const safeApprovalsYesterday = safeCount(approvalsYesterday);
      const safeDailyCallTarget = Number.isFinite(dailyCallTarget) && dailyCallTarget > 0 ? dailyCallTarget : null;
      const safeDailyApprovalTarget = Number.isFinite(dailyApprovalTarget) && dailyApprovalTarget >= 0 ? dailyApprovalTarget : null;
      const callsCompletionRate = safeDailyCallTarget
        ? Math.min(100, Number(((safeCallsToday / safeDailyCallTarget) * 100).toFixed(2)))
        : null;
      const approvalsCompletionRate = safeDailyApprovalTarget !== null && safeDailyApprovalTarget > 0
        ? Math.min(100, Number(((safeApprovalsToday / safeDailyApprovalTarget) * 100).toFixed(2)))
        : 100;
      const completionRate = callsCompletionRate === null ? null : Math.min(callsCompletionRate, approvalsCompletionRate);

      res.json({
        total: safeTotal,
        agreed: safeAgreed,
        hesitant: safeHesitant,
        rejected: safeRejected,
        noAnswer: safeNoAnswer,
        recontact: safeRecontact,
        wrongNumber: safeWrongNumber,
        poolCount: safePoolCount,
        callsToday: safeCallsToday,
        callsYesterday: safeCallsYesterday,
        dailyCallTarget: safeDailyCallTarget,
        approvalsToday: safeApprovalsToday,
        approvalsYesterday: safeApprovalsYesterday,
        dailyApprovalTarget: safeDailyApprovalTarget,
        byStatus: {
          AGREED: safeAgreed,
          HESITANT: safeHesitant,
          REJECTED: safeRejected,
          NO_ANSWER: safeNoAnswer,
          RECONTACT: safeRecontact,
          WRONG_NUMBER: safeWrongNumber,
        },
        kpi: {
          callsToday: safeCallsToday,
          callsYesterday: safeCallsYesterday,
          dailyCallTarget: safeDailyCallTarget,
          remainingCalls: safeDailyCallTarget ? Math.max(0, safeDailyCallTarget - safeCallsToday) : null,
          approvalsToday: safeApprovalsToday,
          approvalsYesterday: safeApprovalsYesterday,
          dailyApprovalTarget: safeDailyApprovalTarget,
          remainingApprovals: safeDailyApprovalTarget !== null ? Math.max(0, safeDailyApprovalTarget - safeApprovalsToday) : null,
          callsCompletionRate,
          approvalsCompletionRate,
          completionRate,
        },
        teamMembersPerformance: (actor.role === 'ADMIN' || actor.role === 'TEAM_LEAD') ? teamMembersPerformance : [],
        teamAnalytics: actor.role === 'TEAM_LEAD'
          ? {
              teamId: actor.teamId,
              members: teamMembersPerformance,
              membersCount: teamMembersPerformance.length,
            }
          : null,
        scope: actor.role === 'ADMIN' ? 'TENANT' : actor.role === 'TEAM_LEAD' ? 'TEAM' : 'AGENT',
        generatedAt: new Date().toISOString(),
        leaderboard,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  // GET /api/me/employee-profile
  app.get('/api/me/employee-profile', authenticateToken, async (req, res) => {
    if (req.user.role !== 'SALES' && req.user.role !== 'TEAM_LEAD') {
      return res.status(403).json({ error: 'Employee profile is available for sales agents and team leads only' });
    }
    try {
      const profile = await ensureEmployeeProfile(req.user.id);
      res.json(profile);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to fetch employee profile' });
    }
  });

  // PUT /api/me/update-name
  app.put('/api/me/update-name', authenticateToken, async (req, res) => {
    const { name, whatsappPhone } = req.body;
    
    try {
      const dataToUpdate = {};
      if (name) {
        if (typeof name !== 'string' || name.trim().length < 2) {
          return res.status(400).json({ error: 'الاسم يجب أن يكون حرفين على الأقل' });
        }
        dataToUpdate.name = name.trim();
      }

      const updatedUser = await prisma.user.update({
        where: { id: req.user.id },
        data: dataToUpdate,
        select: { id: true, name: true, email: true, role: true, tenantId: true, teamId: true }
      });

      if (whatsappPhone) {
        await prisma.employeeProfile.upsert({
          where: { userId: req.user.id },
          update: { phone: whatsappPhone },
          create: {
            userId: req.user.id,
            phone: whatsappPhone,
            dailyCallTarget: 30,
            department: 'Sales',
            isActive: true,
            timezone: 'Africa/Cairo',
          }
        });
      }

      // Issue a new token with the updated name
      const token = jwt.sign(
        {
          id: updatedUser.id,
          name: updatedUser.name,
          email: updatedUser.email,
          role: updatedUser.role,
          tenantId: updatedUser.tenantId,
          teamId: updatedUser.teamId,
        },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.json({ user: updatedUser, token });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'فشل تحديث البيانات' });
    }
  });

  // PUT /api/admin/teams/:id/update-target (Admin + Team Lead)
  app.put('/api/admin/teams/:id/update-target', authenticateToken, authorizeRole(['ADMIN', 'TEAM_LEAD']), async (req, res) => {
    const teamIdParam = req.params.id;
    const callTarget = Object.prototype.hasOwnProperty.call(req.body, 'dailyCallTarget')
      ? parseInteger(req.body.dailyCallTarget)
      : parseInteger(req.body.target);
    const approvalTarget = Object.prototype.hasOwnProperty.call(req.body, 'dailyApprovalTarget')
      ? parseInteger(req.body.dailyApprovalTarget)
      : parseInteger(req.body.approvalsTarget);

    const hasCallTarget = callTarget !== null && typeof callTarget !== 'undefined';
    const hasApprovalTarget = approvalTarget !== null && typeof approvalTarget !== 'undefined';

    if (!hasCallTarget && !hasApprovalTarget) {
      return res.status(400).json({ error: 'dailyCallTarget or dailyApprovalTarget is required' });
    }
    if (hasCallTarget && (!Number.isInteger(callTarget) || callTarget < 1 || callTarget > 500)) {
      return res.status(400).json({ error: 'Invalid dailyCallTarget value' });
    }
    if (hasApprovalTarget && (!Number.isInteger(approvalTarget) || approvalTarget < 0 || approvalTarget > 200)) {
      return res.status(400).json({ error: 'Invalid dailyApprovalTarget value' });
    }

    try {
      const actor = await getCurrentUserScope(req.user.id);
      
      let userIds = [];
      if (teamIdParam === 'all') {
        if (actor.role !== 'ADMIN') return res.status(403).json({ error: 'Only admin can update all targets' });
        const allUsers = await prisma.user.findMany({
          where: { tenantId: actor.tenantId, role: { in: ['SALES', 'TEAM_LEAD'] } },
          select: { id: true }
        });
        userIds = allUsers.map(u => u.id);
      } else {
        const teamId = parseInteger(teamIdParam);
        if (teamId === null) return res.status(400).json({ error: 'Invalid team id' });
        if (actor.role === 'TEAM_LEAD' && actor.teamId !== teamId) {
          return res.status(403).json({ error: 'Access denied' });
        }
        const teamUsers = await prisma.user.findMany({
          where: { teamId, tenantId: actor.tenantId },
          select: { id: true }
        });
        userIds = teamUsers.map(u => u.id);
      }

      if (userIds.length > 0) {
        for (const userId of userIds) {
          await prisma.employeeProfile.upsert({
            where: { userId },
            update: {
              ...(hasCallTarget ? { dailyCallTarget: callTarget } : {}),
              ...(hasApprovalTarget ? { dailyApprovalTarget: approvalTarget } : {}),
            },
            create: {
              userId,
              ...(hasCallTarget ? { dailyCallTarget: callTarget } : {}),
              ...(hasApprovalTarget ? { dailyApprovalTarget: approvalTarget } : {}),
              department: 'Sales',
              isActive: true,
              timezone: 'Africa/Cairo',
            }
          });
        }
      }

      broadcastTenantEvent(actor.tenantId, 'invalidate', {
        at: new Date().toISOString(),
        kind: 'targets',
        actorId: actor.id,
      });
      res.json({ message: `تم تحديث التارجت لـ ${userIds.length} موظف بنجاح` });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to update team target' });
    }
  });

  // PUT /api/admin/employees/:id/profile (Admin + Team Lead)
  app.put('/api/admin/employees/:id/profile', authenticateToken, authorizeRole(['ADMIN', 'TEAM_LEAD']), async (req, res) => {
    const employeeId = parseInteger(req.params.id);
    if (employeeId === null) return res.status(400).json({ error: 'Invalid employee id' });

    const { name, email, dailyCallTarget, dailyApprovalTarget, department, jobTitle, phone, isActive, role } = req.body;

    try {
      const actor = await getCurrentUserScope(req.user.id);
      const targetUser = await prisma.user.findUnique({ where: { id: employeeId } });
      
      if (!targetUser || targetUser.tenantId !== actor.tenantId) {
        return res.status(404).json({ error: 'Employee not found' });
      }

      if (actor.role === 'TEAM_LEAD' && targetUser.teamId !== actor.teamId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      if (actor.role === 'TEAM_LEAD' && targetUser.role !== 'SALES') {
        return res.status(403).json({ error: 'You can only update sales members' });
      }

      const hasName = Object.prototype.hasOwnProperty.call(req.body, 'name');
      const hasEmail = Object.prototype.hasOwnProperty.call(req.body, 'email');
      const normalizedName = hasName ? normalizeNullableString(name, 120) : null;
      const normalizedEmail = hasEmail && typeof email === 'string' ? email.trim().toLowerCase() : null;
      if (hasName && !normalizedName) {
        return res.status(400).json({ error: 'Name is required' });
      }
      if (hasEmail && (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))) {
        return res.status(400).json({ error: 'Valid email is required' });
      }

      const profileInput = {};
      if (Object.prototype.hasOwnProperty.call(req.body, 'dailyCallTarget')) profileInput.dailyCallTarget = dailyCallTarget;
      if (Object.prototype.hasOwnProperty.call(req.body, 'dailyApprovalTarget')) profileInput.dailyApprovalTarget = dailyApprovalTarget;
      if (Object.prototype.hasOwnProperty.call(req.body, 'department')) profileInput.department = department;
      if (Object.prototype.hasOwnProperty.call(req.body, 'jobTitle')) profileInput.jobTitle = jobTitle;
      if (Object.prototype.hasOwnProperty.call(req.body, 'phone')) profileInput.phone = phone;
      if (Object.prototype.hasOwnProperty.call(req.body, 'timezone')) profileInput.timezone = req.body.timezone;
      if (Object.prototype.hasOwnProperty.call(req.body, 'isActive')) profileInput.isActive = isActive;

      const { payload: profilePayload, errors: profileErrors } = buildEmployeeProfilePayload(profileInput, { strictTarget: false });
      if (profileErrors.length) {
        return res.status(400).json({ error: profileErrors[0] });
      }

      // Update User details (including name)
      const updatedUser = await prisma.user.update({
        where: { id: employeeId },
        data: {
          ...(hasName ? { name: normalizedName } : {}),
          ...(hasEmail ? { email: normalizedEmail } : {}),
          ...(role && actor.role === 'ADMIN' && { role }), // Only admin can change role
        }
      });

      // Update or Create Profile
      const updatedProfile = await prisma.employeeProfile.upsert({
        where: { userId: employeeId },
        update: profilePayload,
        create: {
          userId: employeeId,
          timezone: 'Africa/Cairo',
          dailyCallTarget: 30,
          dailyApprovalTarget: 0,
          department: 'Sales',
          isActive: true,
          ...profilePayload,
        }
      });

      broadcastTenantEvent(actor.tenantId, 'invalidate', {
        at: new Date().toISOString(),
        kind: 'profile',
        actorId: actor.id,
        userId: employeeId,
      });
      res.json({ user: updatedUser, profile: updatedProfile });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to update employee' });
    }
  });

  // GET /api/notifications/test
  app.get('/api/notifications/test', authenticateToken, async (req, res) => {
    try {
      const result = await sendPushNotification(req.user.id, {
        title: 'تجربة الإشعارات 🔔',
        body: 'مبروك! نظام الإشعارات شغال بنجاح على جهازك.',
        icon: '/icon-192.png',
      });
      if (result.reason === 'disabled') {
        return res.status(503).json({ error: 'Push notifications are disabled on server (missing VAPID keys)' });
      }
      if (result.reason === 'no_subscriptions') {
        return res.status(404).json({ error: 'لا يوجد اشتراك Push لهذا المستخدم. افتح النظام ووافق على الإشعارات ثم أعد تسجيل الدخول.' });
      }
      if (result.sent === 0) {
        return res.status(502).json({ error: 'تعذر إرسال الإشعار (مزود Push رفض الطلب). جرّب إعادة تفعيل الإشعارات من المتصفح ثم تسجيل الدخول.' });
      }
      return res.json({ message: 'تم إرسال إشعار تجريبي بنجاح', sent: result.sent });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'فشل إرسال الإشعار التجريبي' });
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
    if (actor.role === 'TEAM_LEAD' && !actor.teamId) {
      return res.status(400).json({ error: 'User is not assigned to a team' });
    }
    const normalizedSearch = typeof search === 'string' ? search.trim().toLowerCase() : '';

    const fallbackEmployees = async () => {
      const where = actor.role === 'ADMIN'
        ? { tenantId: actor.tenantId, role: { in: ['SALES', 'TEAM_LEAD'] } }
        : { tenantId: actor.tenantId, teamId: actor.teamId || -1, role: { in: ['SALES', 'TEAM_LEAD'] } };
      const baseUsers = await prisma.user.findMany({
        where,
        orderBy: { name: 'asc' },
        select: { id: true, name: true, email: true, role: true, teamId: true },
      });
      const filteredUsers = normalizedSearch
        ? baseUsers.filter((user) => {
            const name = String(user.name || '').toLowerCase();
            const email = String(user.email || '').toLowerCase();
            return name.includes(normalizedSearch) || email.includes(normalizedSearch);
          })
        : baseUsers;
      return filteredUsers.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        teamId: user.teamId,
        profile: {
          id: null,
          userId: user.id,
          department: 'Sales',
          jobTitle: null,
          phone: null,
          timezone: 'Africa/Cairo',
          dailyCallTarget: 30,
          dailyApprovalTarget: 0,
          isActive: true,
        },
        callsToday: 0,
        callsYesterday: 0,
      }));
    };

    try {
      const fetchUsersByScope = async () => {
        const teams = await prisma.team.findMany({
          where: actor.role === 'ADMIN'
            ? { tenantId: actor.tenantId }
            : { id: actor.teamId || -1, tenantId: actor.tenantId },
          include: {
            users: {
              include: { employeeProfile: true },
              orderBy: { name: 'asc' },
            },
          },
          orderBy: { name: 'asc' },
        });
        let scopedUsers = teams.flatMap((team) => team.users);
        scopedUsers = scopedUsers.filter((user) => (actor.role === 'ADMIN'
          ? user.role === 'SALES' || user.role === 'TEAM_LEAD'
          : user.role === 'SALES' || user.role === 'TEAM_LEAD'));
        if (normalizedSearch) {
          scopedUsers = scopedUsers.filter((user) => {
            const name = String(user.name || '').toLowerCase();
            const email = String(user.email || '').toLowerCase();
            return name.includes(normalizedSearch) || email.includes(normalizedSearch);
          });
        }
        return scopedUsers.sort((a, b) => a.name.localeCompare(b.name));
      };

      let users = await fetchUsersByScope();

      const missingProfileIds = users
        .filter((user) => !user.employeeProfile)
        .map((user) => user.id);

      if (missingProfileIds.length) {
        await Promise.all(missingProfileIds.map((userId) => ensureEmployeeProfile(userId)));
        users = await fetchUsersByScope();
      }
      const { start, end } = buildDayRange();
      const yesterdayRange = buildDayRangeWithOffset(-1);
      const userIds = users.map((user) => user.id);
      const [callsTodayRows, callsYesterdayRows] = userIds.length
        ? await Promise.all([
            prisma.interaction.findMany({
              where: {
                userId: { in: userIds },
                type: { in: ['CALL', 'SEND'] },
                date: { gte: start, lt: end },
              },
              select: { userId: true },
            }),
            prisma.interaction.findMany({
              where: {
                userId: { in: userIds },
                type: { in: ['CALL', 'SEND'] },
                date: { gte: yesterdayRange.start, lt: yesterdayRange.end },
              },
              select: { userId: true },
            }),
          ])
        : [[], []];
      const callsTodayMap = callsTodayRows.reduce((acc, row) => {
        if (!row.userId) return acc;
        acc.set(row.userId, (acc.get(row.userId) || 0) + 1);
        return acc;
      }, new Map());
      const callsYesterdayMap = callsYesterdayRows.reduce((acc, row) => {
        if (!row.userId) return acc;
        acc.set(row.userId, (acc.get(row.userId) || 0) + 1);
        return acc;
      }, new Map());

      const result = users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        teamId: user.teamId,
        profile: {
          id: user.employeeProfile?.id || null,
          userId: user.employeeProfile?.userId || user.id,
          department: user.employeeProfile?.department || 'Sales',
          jobTitle: user.employeeProfile?.jobTitle || null,
          phone: user.employeeProfile?.phone || null,
          timezone: user.employeeProfile?.timezone || 'Africa/Cairo',
          dailyCallTarget: Number(user.employeeProfile?.dailyCallTarget || 30),
          dailyApprovalTarget: Number(user.employeeProfile?.dailyApprovalTarget || 0),
          isActive: typeof user.employeeProfile?.isActive === 'boolean' ? user.employeeProfile.isActive : true,
        },
        callsToday: callsTodayMap.get(user.id) || 0,
        callsYesterday: callsYesterdayMap.get(user.id) || 0,
      }));

      res.json(result);
    } catch (error) {
      console.error(error);
      try {
        const fallback = await fallbackEmployees();
        return res.json(fallback);
      } catch (fallbackError) {
        console.error(fallbackError);
        return res.status(500).json({ error: 'Failed to fetch employee profiles' });
      }
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

      if (actor.role === 'TEAM_LEAD' && user.teamId !== actor.teamId) {
        return res.status(403).json({ error: 'You can only update your team members' });
      }
      if (actor.role === 'TEAM_LEAD' && user.role !== 'SALES') {
        return res.status(403).json({ error: 'You can only update sales members' });
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

  app.get('/api/admin/employees/:id/performance', authenticateToken, authorizeRole(['ADMIN', 'TEAM_LEAD']), async (req, res) => {
    const actor = await getCurrentUserScope(req.user.id);
    if (!actor) return res.status(401).json({ error: 'Invalid user context' });
    const actorTenantError = assertTenantScopedUser(actor);
    if (actorTenantError) return res.status(400).json({ error: actorTenantError });
    const userId = parseInteger(req.params.id);
    if (userId === null || userId < 1) return res.status(400).json({ error: 'Invalid employee id' });
    const days = Math.min(60, Math.max(7, parseInteger(normalizeSingleQueryValue(req.query.days)) || 14));
    try {
      const employee = await prisma.user.findFirst({
        where: { id: userId, tenantId: actor.tenantId, role: { in: ['SALES', 'TEAM_LEAD'] } },
        include: { employeeProfile: true, team: { select: { id: true, name: true } } },
      });
      if (!employee) return res.status(404).json({ error: 'Employee not found' });
      if (actor.role === 'TEAM_LEAD' && employee.teamId !== actor.teamId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - (days - 1));
      const interactions = await prisma.interaction.findMany({
        where: {
          userId: employee.id,
          type: { in: ['CALL', 'SEND'] },
          date: { gte: start, lte: end },
        },
        select: { date: true, outcome: true, lead: { select: { batchId: true } } },
      });
      const seriesMap = new Map();
      for (let i = 0; i < days; i++) {
        const date = new Date(start);
        date.setDate(start.getDate() + i);
        const key = date.toISOString().slice(0, 10);
        seriesMap.set(key, { date: key, calls: 0, agreed: 0, rejected: 0, hesitant: 0, wrongNumber: 0 });
      }
      interactions.forEach((item) => {
        const key = item.date.toISOString().slice(0, 10);
        const row = seriesMap.get(key);
        if (!row) return;
        row.calls += 1;
        if (item.outcome === 'AGREED') row.agreed += 1;
        if (item.outcome === 'REJECTED') row.rejected += 1;
        if (item.outcome === 'HESITANT') row.hesitant += 1;
        if (item.outcome === 'WRONG_NUMBER') row.wrongNumber += 1;
      });
      const series = [...seriesMap.values()];
      const totalCalls = series.reduce((sum, row) => sum + row.calls, 0);
      const totalAgreed = series.reduce((sum, row) => sum + row.agreed, 0);
      const callTarget = employee.employeeProfile?.dailyCallTarget || 0;
      const approvalTarget = employee.employeeProfile?.dailyApprovalTarget || 0;
      const totalCallTarget = callTarget * days;
      const totalApprovalTarget = approvalTarget * days;
      const callsCompletionRate = totalCallTarget > 0 ? Number(((totalCalls / totalCallTarget) * 100).toFixed(2)) : 0;
      const approvalsCompletionRate = totalApprovalTarget > 0 ? Number(((totalAgreed / totalApprovalTarget) * 100).toFixed(2)) : 100;
      const completionRate = Number(Math.min(callsCompletionRate, approvalsCompletionRate).toFixed(2));
      return res.json({
        employee: {
          id: employee.id,
          name: employee.name,
          email: employee.email,
          team: employee.team,
          isActive: employee.employeeProfile?.isActive ?? true,
          dailyCallTarget: callTarget,
          dailyApprovalTarget: approvalTarget,
        },
        periodDays: days,
        totals: {
          calls: totalCalls,
          agreed: totalAgreed,
          rejected: series.reduce((sum, row) => sum + row.rejected, 0),
          hesitant: series.reduce((sum, row) => sum + row.hesitant, 0),
          wrongNumber: series.reduce((sum, row) => sum + row.wrongNumber, 0),
          callTarget: totalCallTarget,
          approvalTarget: totalApprovalTarget,
          target: totalCallTarget,
          callsCompletionRate,
          approvalsCompletionRate,
          completionRate,
        },
        series,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to fetch employee performance' });
    }
  });

  app.get('/api/admin/employees/export-active', authenticateToken, authorizeRole(['ADMIN', 'TEAM_LEAD']), async (req, res) => {
    const actor = await getCurrentUserScope(req.user.id);
    if (!actor) return res.status(401).json({ error: 'Invalid user context' });
    const actorTenantError = assertTenantScopedUser(actor);
    if (actorTenantError) return res.status(400).json({ error: actorTenantError });
    try {
      const users = await prisma.user.findMany({
        where: {
          tenantId: actor.tenantId,
          role: 'SALES',
          ...(actor.role === 'TEAM_LEAD' ? { teamId: actor.teamId || -1 } : {}),
          employeeProfile: { isActive: true },
        },
        include: { team: { select: { name: true } }, employeeProfile: true },
        orderBy: { name: 'asc' },
      });
      const header = ['name', 'email', 'team', 'dailyCallTarget', 'dailyApprovalTarget', 'department', 'jobTitle', 'phone'];
      const rows = users.map((user) => [
        user.name,
        user.email,
        user.team?.name || '',
        String(user.employeeProfile?.dailyCallTarget || 0),
        String(user.employeeProfile?.dailyApprovalTarget || 0),
        user.employeeProfile?.department || '',
        user.employeeProfile?.jobTitle || '',
        user.employeeProfile?.phone || '',
      ]);
      const csv = [header, ...rows]
        .map((cols) => cols.map((col) => `"${String(col).replace(/"/g, '""')}"`).join(','))
        .join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="active-employees.csv"');
      return res.send(`\uFEFF${csv}`);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to export active employees' });
    }
  });

  // --- SIM Cards Management ---

  app.post('/api/admin/sim-cards/parse', authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Invalid text' });

      const actor = await getCurrentUserScope(req.user.id);
      const users = await prisma.user.findMany({
        where: { tenantId: actor.tenantId, role: { in: ['SALES', 'TEAM_LEAD'] } },
        select: { id: true, name: true }
      });

      const lines = text.split('\n').filter(l => l.trim());
      const parsedResults = lines.map(line => {
        const cleanLine = line.trim();
        // Regex to find Serial (14+ digits) and Phone (01 followed by 9 digits)
        const serialMatch = cleanLine.match(/(\d{14,})/);
        const phoneMatch = cleanLine.match(/(01\d{9})/);
        
        const serial = serialMatch ? serialMatch[0] : null;
        const phone = phoneMatch ? phoneMatch[0] : null;
        
        // Remove serial, phone and trailing numbers (like ID 195) from name
        let namePart = cleanLine;
        if (serial) namePart = namePart.replace(serial, '');
        if (phone) namePart = namePart.replace(phone, '');
        // Remove trailing numbers that are likely IDs (1-4 digits at end)
        namePart = namePart.replace(/\s+\d{1,4}$/, '');
        const name = namePart.replace(/[^\u0600-\u06FFa-zA-Z\s]/g, '').trim();

        // Find best match
        let bestMatch = null;
        let maxScore = 0;

        if (name) {
          const tokens1 = name.toLowerCase().split(/\s+/).filter(t => t.length > 2);
          users.forEach(user => {
            const tokens2 = user.name.toLowerCase().split(/\s+/).filter(t => t.length > 2);
            if (tokens2.length === 0) return;
            
            const intersection = tokens1.filter(t => tokens2.some(t2 => t2.includes(t) || t.includes(t2)));
            const score = intersection.length / Math.max(tokens1.length, tokens2.length);
            
            if (score > maxScore && score > 0.3) { // Threshold
              maxScore = score;
              bestMatch = { id: user.id, name: user.name, score };
            }
          });
        }

        return {
          raw: cleanLine,
          parsed: { name, serial, phone },
          match: bestMatch
        };
      });

      res.json({ results: parsedResults, users });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to parse SIM cards list' });
    }
  });

  app.post('/api/admin/sim-cards/assign', authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    try {
      const { assignments } = req.body; // Array of { userId, serial, phone }
      if (!Array.isArray(assignments)) return res.status(400).json({ error: 'Invalid assignments' });

      const actor = await getCurrentUserScope(req.user.id);
      
      const updates = [];
      for (const item of assignments) {
        if (!item.userId || !item.serial) continue;
        
        // Verify user belongs to tenant
        const user = await prisma.user.findFirst({
            where: { id: item.userId, tenantId: actor.tenantId }
        });
        if (!user) continue;

        updates.push(
          prisma.employeeProfile.upsert({
            where: { userId: item.userId },
            update: { simSerialNumber: item.serial, simPhoneNumber: item.phone },
            create: { userId: item.userId, simSerialNumber: item.serial, simPhoneNumber: item.phone }
          })
        );
      }

      await prisma.$transaction(updates);
      res.json({ success: true, count: updates.length });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to assign SIM cards' });
    }
  });

  app.get('/api/admin/sim-cards', authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    try {
      const actor = await getCurrentUserScope(req.user.id);
      const employees = await prisma.user.findMany({
        where: { tenantId: actor.tenantId, role: { in: ['SALES', 'TEAM_LEAD'] } },
        include: { employeeProfile: true },
        orderBy: { name: 'asc' }
      });

      const result = employees.map(u => ({
        id: u.id,
        name: u.name,
        role: u.role,
        simSerialNumber: u.employeeProfile?.simSerialNumber || null,
        simPhoneNumber: u.employeeProfile?.simPhoneNumber || null
      }));

      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to fetch SIM cards' });
    }
  });

  // --- Suggestions Routes ---

  app.post('/api/suggestions', authenticateToken, async (req, res) => {
    try {
      const { content } = req.body;
      if (!content || typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({ error: 'Suggestion content is required' });
      }

      const actor = await getCurrentUserScope(req.user.id);
      if (!actor) return res.status(401).json({ error: 'Invalid user context' });
      const actorTenantError = assertTenantScopedUser(actor);
      if (actorTenantError) return res.status(400).json({ error: actorTenantError });

      const suggestion = await prisma.suggestion.create({
        data: {
          content: content.trim(),
          userId: actor.id,
          tenantId: actor.tenantId
        }
      });

      res.status(201).json(suggestion);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to submit suggestion' });
    }
  });

  app.get('/api/admin/suggestions', authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    try {
      const actor = await getCurrentUserScope(req.user.id);
      if (!actor) return res.status(401).json({ error: 'Invalid user context' });
      const actorTenantError = assertTenantScopedUser(actor);
      if (actorTenantError) return res.status(400).json({ error: actorTenantError });

      const suggestions = await prisma.suggestion.findMany({
        where: { tenantId: actor.tenantId },
        include: { user: { select: { name: true, email: true, role: true } } },
        orderBy: { createdAt: 'desc' }
      });

      res.json(suggestions);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to fetch suggestions' });
    }
  });

  // --- Template Routes ---

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
      const bucket = readAssistantTraining();
      const tenantKey = String(actor.tenantId);
      const tenantBucket = bucket[tenantKey] || {};
      const userOverrides = tenantBucket?.templates?.users?.[String(actor.id)] || {};
      const response = templates.map((template) => {
        const override = userOverrides?.[template.status];
        if (typeof override === 'string' && override.trim()) {
          return { ...template, content: override, scope: 'USER' };
        }
        return { ...template, scope: 'TENANT' };
      });
      res.json(response);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to fetch templates' });
    }
  });

  app.put('/api/templates/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { content } = req.body;
    const scope = typeof req.body?.scope === 'string' ? req.body.scope.trim().toUpperCase() : 'USER';
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
      const template = await prisma.messageTemplate.findFirst({
        where: { id: templateId, tenantId: actor.tenantId },
      });
      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }
      if (scope === 'TENANT') {
        if (actor.role !== 'ADMIN') {
          return res.status(403).json({ error: 'Only admin can update tenant default template' });
        }
        await prisma.messageTemplate.update({
          where: { id: templateId },
          data: { content },
        });
        const updatedTemplate = await prisma.messageTemplate.findFirst({
          where: { id: templateId, tenantId: actor.tenantId },
        });
        return res.json({ ...updatedTemplate, scope: 'TENANT' });
      }
      const bucket = readAssistantTraining();
      const tenantKey = String(actor.tenantId);
      bucket[tenantKey] = bucket[tenantKey] || {};
      bucket[tenantKey].templates = bucket[tenantKey].templates || {};
      bucket[tenantKey].templates.users = bucket[tenantKey].templates.users || {};
      bucket[tenantKey].templates.users[String(actor.id)] = {
        ...(bucket[tenantKey].templates.users[String(actor.id)] || {}),
        [template.status]: content,
      };
      writeAssistantTraining(bucket);
      return res.json({ ...template, content, scope: 'USER' });
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
      const tenantBucket = bucket[key] || {};
      const globalTraining = tenantBucket.globalTraining || {
        topic: tenantBucket.topic || '',
        context: tenantBucket.context || '',
        updatedAt: tenantBucket.updatedAt || null,
      };
      const userTrainingMap = tenantBucket.userTraining || {};
      const userTraining = userTrainingMap[String(actor.id)] || { topic: '', context: '', updatedAt: null };
      return res.json({
        globalTraining,
        userTraining,
        effectiveTraining: {
          topic: userTraining.topic || globalTraining.topic || '',
          context: userTraining.context || globalTraining.context || '',
        },
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to load assistant training' });
    }
  });

  app.post('/api/assistant/training', authenticateToken, async (req, res) => {
    const topic = normalizeNullableString(req.body?.topic, 120) || '';
    const context = normalizeNullableString(req.body?.context, 2000) || '';
    const scope = typeof req.body?.scope === 'string' ? req.body.scope.trim().toUpperCase() : 'USER';
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
      bucket[key] = bucket[key] || {};
      if (scope === 'GLOBAL') {
        if (actor.role !== 'ADMIN') {
          return res.status(403).json({ error: 'Only admin can save global training' });
        }
        bucket[key].globalTraining = { topic, context, updatedAt: new Date().toISOString() };
        writeAssistantTraining(bucket);
        return res.json({ scope: 'GLOBAL', training: bucket[key].globalTraining });
      }
      bucket[key].userTraining = bucket[key].userTraining || {};
      bucket[key].userTraining[String(actor.id)] = { topic, context, updatedAt: new Date().toISOString() };
      writeAssistantTraining(bucket);
      return res.json({ scope: 'USER', training: bucket[key].userTraining[String(actor.id)] });
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
      const tenantBucket = bucket[String(actor.tenantId)] || {};
      const globalTraining = tenantBucket.globalTraining || {
        topic: tenantBucket.topic || '',
        context: tenantBucket.context || '',
      };
      const userTraining = (tenantBucket.userTraining || {})[String(actor.id)] || {};
      const trainingTopic = normalizeNullableString(req.body?.trainingTopic, 120) || userTraining.topic || globalTraining.topic || '';
      const trainingContext = normalizeNullableString(req.body?.trainingContext, 2000) || userTraining.context || globalTraining.context || '';
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

  // --- Cron Jobs ---

  // 1. Hourly Reminder for Sales (09:00 - 22:00)
  cron.schedule('0 9-22 * * *', async () => {
    console.log('[cron] Running hourly reminder check...');
    try {
      const { start, end } = buildDayRange();
      const salesUsers = await prisma.user.findMany({
        where: { role: 'SALES' },
        include: { employeeProfile: true },
      });

      for (const user of salesUsers) {
        const callTarget = user.employeeProfile?.dailyCallTarget || 30;
        const approvalTarget = user.employeeProfile?.dailyApprovalTarget || 0;
        const [callsCount, approvalsCount] = await Promise.all([
          prisma.interaction.count({
            where: {
              userId: user.id,
              type: { in: ['CALL', 'SEND'] },
              date: { gte: start, lt: end },
            },
          }),
          prisma.interaction.count({
            where: {
              userId: user.id,
              type: { in: ['CALL', 'SEND'] },
              outcome: 'AGREED',
              date: { gte: start, lt: end },
            },
          }),
        ]);

        const remainingCalls = Math.max(0, callTarget - callsCount);
        const remainingApprovals = Math.max(0, approvalTarget - approvalsCount);

        if (remainingCalls > 0 || remainingApprovals > 0) {
          const parts = [];
          if (remainingCalls > 0) parts.push(`${remainingCalls} مكالمة`);
          if (remainingApprovals > 0) parts.push(`${remainingApprovals} موافقة`);
          await sendPushNotification(user.id, {
            title: 'تذكير بالهدف اليومي 🎯',
            body: `فاضلك ${parts.join(' و ')} عشان تخلص التارجت بتاعك النهاردة. شد حيلك!`,
            icon: '/icon-192.png',
          });
        }
      }
    } catch (error) {
      console.error('[cron] Hourly reminder error:', error);
    }
  });

  cron.schedule('*/30 9-22 * * *', async () => {
    try {
      const { start, end } = buildDayRange();
      const salesUsers = await prisma.user.findMany({
        where: { role: 'SALES' },
        select: { id: true, tenantId: true, employeeProfile: true },
      });
      const byTenant = salesUsers.reduce((acc, u) => {
        if (!u.tenantId) return acc;
        const key = u.tenantId;
        const list = acc.get(key) || [];
        list.push(u);
        acc.set(key, list);
        return acc;
      }, new Map());

      for (const [tenantId, users] of byTenant.entries()) {
        const { leaderboard, rankMap } = await buildTenantLeaderboard({ tenantId, start, end });
        const userMap = users.reduce((acc, u) => {
          acc.set(u.id, u);
          return acc;
        }, new Map());
        const mergedRows = leaderboard.map((row) => {
          const u = userMap.get(row.userId);
          return {
            ...row,
            profile: u?.employeeProfile || row.profile,
          };
        });
        for (const row of mergedRows) {
          await maybeSendMotivationPulse(row, { rankMap, leaderboard: mergedRows, start, end });
        }
      }
    } catch (error) {
      console.error('[cron] Motivation pulse error:', error);
    }
  });

  // 2. Daily Summary for Team Leads (23:30)
  cron.schedule('30 23 * * *', async () => {
    console.log('[cron] Running daily summary for team leads...');
    try {
      const { start, end } = buildDayRange();
      const teamLeads = await prisma.user.findMany({
        where: { role: 'TEAM_LEAD' },
      });

      for (const lead of teamLeads) {
        if (!lead.teamId) continue;

        const teamMembers = await prisma.user.findMany({
          where: { teamId: lead.teamId, role: 'SALES' },
          include: { employeeProfile: true },
        });

        let achieved = 0;
        let missed = 0;
        const missedNames = [];

        for (const member of teamMembers) {
          const callTarget = member.employeeProfile?.dailyCallTarget || 30;
          const approvalTarget = member.employeeProfile?.dailyApprovalTarget || 0;
          const [callsCount, approvalsCount] = await Promise.all([
            prisma.interaction.count({
              where: {
                userId: member.id,
                type: { in: ['CALL', 'SEND'] },
                date: { gte: start, lt: end },
              },
            }),
            prisma.interaction.count({
              where: {
                userId: member.id,
                type: { in: ['CALL', 'SEND'] },
                outcome: 'AGREED',
                date: { gte: start, lt: end },
              },
            }),
          ]);

          const done = callsCount >= callTarget && approvalsCount >= approvalTarget;
          if (done) achieved++;
          else {
            missed++;
            missedNames.push(member.name);
          }
        }

        const body = missed > 0 
          ? `النهاردة ${achieved} واحد خلصوا التارجت و ${missed} لسه (${missedNames.join(', ')}).`
          : `كل الفريق خلص التارجت النهاردة! عاش يا وحوش 🚀`;

        await sendPushNotification(lead.id, {
          title: 'ملخص الأداء اليومي 📊',
          body,
          icon: '/icon-192.png',
        });
      }
    } catch (error) {
      console.error('[cron] Daily summary error:', error);
    }
  });

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

startServer().catch(e => {
  console.error('Failed to start server:', e);
  process.exit(1);
});
