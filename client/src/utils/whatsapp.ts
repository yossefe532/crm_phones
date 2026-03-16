export const AUTO_MESSAGE_STATUSES = new Set(['INTERESTED', 'AGREED', 'REJECTED', 'HESITANT', 'SPONSOR', 'NO_ANSWER']);
export type LeadGender = 'MALE' | 'FEMALE' | 'UNKNOWN';

export const formatEgyptPhone = (phone: string) => {
  let digits = (phone || '').trim().replace(/\D/g, '');

  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('20')) return `+${digits}`;
  if (digits.startsWith('0')) return `+20${digits.slice(1)}`;
  return `+20${digits}`;
};

export const toWhatsAppNumber = (phone: string) => formatEgyptPhone(phone).replace('+', '');

export const buildLeadTemplatePlaceholders = ({
  customerName,
  userName,
  gender,
}: {
  customerName: string;
  userName: string;
  gender?: LeadGender | string | null;
}) => {
  const normalizedGender = String(gender || 'UNKNOWN').toUpperCase() as LeadGender;
  const isFemale = normalizedGender === 'FEMALE';
  const isMale = normalizedGender === 'MALE';

  return {
    customer_name: customerName || '',
    user_name: userName || '',
    customer_gender: isFemale ? 'female' : isMale ? 'male' : 'unknown',
    customer_gender_ar: isFemale ? 'أنثى' : isMale ? 'ذكر' : 'غير محدد',
    customer_title: isFemale ? 'الأستاذة' : isMale ? 'الأستاذ' : 'الأستاذ/الأستاذة',
    customer_honorific: isFemale ? 'Ms.' : isMale ? 'Mr.' : 'Mx.',
    customer_object_pronoun: isFemale ? 'ها' : isMale ? 'ه' : 'ه/ها',
    customer_possessive_pronoun: isFemale ? 'ها' : isMale ? 'ه' : 'ه/ها',
  };
};

export const buildTemplateMessage = (
  template: string,
  placeholders: Record<string, string>,
) => {
  if (!template) return '';
  const normalized: Record<string, string> = {};
  Object.entries(placeholders).forEach(([key, value]) => {
    normalized[key.toLowerCase()] = value ?? '';
  });

  const aliasMap: Record<string, string> = {
    customer_name: 'customer_name',
    customer: 'customer_name',
    client_name: 'customer_name',
    اسم_العميل: 'customer_name',
    'اسم العميل': 'customer_name',
    user_name: 'user_name',
    user: 'user_name',
    agent_name: 'user_name',
    sales_name: 'user_name',
    اسم_الموظف: 'user_name',
    'اسم الموظف': 'user_name',
    customer_gender: 'customer_gender',
    gender: 'customer_gender',
    gender_en: 'customer_gender',
    جنس_العميل: 'customer_gender_ar',
    'جنس العميل': 'customer_gender_ar',
    customer_gender_ar: 'customer_gender_ar',
    customer_title: 'customer_title',
    title: 'customer_title',
    لقب_العميل: 'customer_title',
    'لقب العميل': 'customer_title',
    customer_honorific: 'customer_honorific',
    customer_object_pronoun: 'customer_object_pronoun',
    customer_possessive_pronoun: 'customer_possessive_pronoun',
  };

  const resolveToken = (token: string) => {
    const clean = String(token || '').trim().toLowerCase();
    const mapped = aliasMap[clean] || clean;
    return mapped in normalized ? normalized[mapped] : null;
  };

  let message = template;

  message = message.replace(/\{\{\s*([^{}]+?)\s*\}\}|\{\s*([^{}]+?)\s*\}/gi, (match, p1, p2) => {
    const value = resolveToken(String(p1 || p2 || ''));
    return value === null ? match : value;
  });

  message = message.replace(/\(\s*([^()]+?)\s*\)/gi, (match, p1) => {
    const value = resolveToken(String(p1 || ''));
    return value === null ? match : value;
  });

  return message;
};
