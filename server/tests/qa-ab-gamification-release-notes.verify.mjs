const API_BASE = process.env.API_BASE || 'http://localhost:5000/api';
const RUN_ID = Date.now();

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const request = async (path, { method = 'GET', token, body, params } = {}) => {
  const query = params
    ? `?${new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null)).toString()}`
    : '';
  const response = await fetch(`${API_BASE}${path}${query}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { response, data };
};

const expectOk = (result, label) => {
  assert(result.response.ok, `${label} failed: ${result.data?.error || result.response.status}`);
  return result.data;
};

const login = async (email, password) => {
  const result = await request('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  return expectOk(result, `Login (${email})`);
};

const run = async () => {
  console.log('Running QA + A/B + Gamification + Global Release Notes verification...');

  const admin = await login('admin@edicon.com', 'admin123');
  const adminToken = admin.token;

  const team = expectOk(await request('/teams', {
    method: 'POST',
    token: adminToken,
    body: { name: `QA-AB Team ${RUN_ID}` },
  }), 'Create team');

  const salesEmail = `sales-qa-ab-${RUN_ID}@qa.local`;
  const createdSales = expectOk(await request('/users', {
    method: 'POST',
    token: adminToken,
    body: {
      name: `Sales QA AB ${RUN_ID}`,
      email: salesEmail,
      password: 'pass1234',
      role: 'SALES',
      teamId: team.id,
    },
  }), 'Create sales user');

  const sales = await login(salesEmail, 'pass1234');
  const salesToken = sales.token;

  const qaSettingsBefore = expectOk(await request('/qa/sampling-settings', {
    token: adminToken,
  }), 'Get QA settings');
  assert(typeof qaSettingsBefore.samplingRate === 'number', 'Expected QA samplingRate number');

  const qaSettingsUpdated = expectOk(await request('/qa/sampling-settings', {
    method: 'PUT',
    token: adminToken,
    body: {
      samplingRate: 35,
      minDailySample: 7,
      targetScore: 88,
      enabled: true,
    },
  }), 'Update QA settings');
  assert(qaSettingsUpdated.samplingRate === 35, 'Expected samplingRate updated to 35');

  const lead = expectOk(await request('/leads', {
    method: 'POST',
    token: salesToken,
    body: {
      name: `Lead QA ${RUN_ID}`,
      phone: `010${String(RUN_ID).slice(-8)}`,
      status: 'INTERESTED',
      source: 'CALL',
      gender: 'MALE',
      notes: 'qa scorecard seed lead',
      callDurationSec: 70,
    },
  }), 'Create lead');

  const scorecardResult = expectOk(await request('/qa/scorecards', {
    method: 'POST',
    token: adminToken,
    body: {
      agentId: createdSales.id,
      leadId: lead.id,
      score: 92,
      maxScore: 100,
      notes: 'Strong opening and objection handling',
      checklist: { intro: true, objectionHandling: true, close: true },
    },
  }), 'Create QA scorecard');
  assert(scorecardResult?.created?.id, 'Expected created QA scorecard id');

  const qaSummary = expectOk(await request('/qa/scorecards/summary', {
    token: adminToken,
  }), 'Get QA summary');
  assert(qaSummary.totalScorecards >= 1, 'Expected QA summary totalScorecards >= 1');

  const abTest = expectOk(await request('/ab-tests', {
    method: 'POST',
    token: adminToken,
    body: {
      name: `AB Test ${RUN_ID}`,
      channel: 'MESSAGE_TEMPLATE',
      status: 'ACTIVE',
      hypothesis: 'Variant B should improve conversion rate',
      variants: [
        { key: 'A', label: 'Control', content: 'Hello from control', isControl: true },
        { key: 'B', label: 'Challenger', content: 'Hello from challenger', isControl: false },
      ],
    },
  }), 'Create A/B test');
  assert(Array.isArray(abTest.variants) && abTest.variants.length === 2, 'Expected 2 variants');
  const variantB = abTest.variants.find((v) => v.key === 'B') || abTest.variants[0];

  expectOk(await request(`/ab-tests/${abTest.id}/events`, {
    method: 'POST',
    token: salesToken,
    body: {
      variantId: variantB.id,
      eventType: 'IMPRESSION',
      leadId: lead.id,
      metadata: { channel: 'whatsapp' },
    },
  }), 'Log A/B impression');

  expectOk(await request(`/ab-tests/${abTest.id}/events`, {
    method: 'POST',
    token: salesToken,
    body: {
      variantId: variantB.id,
      eventType: 'CONVERSION',
      leadId: lead.id,
      metadata: { outcome: 'INTERESTED' },
    },
  }), 'Log A/B conversion');

  const report = expectOk(await request(`/ab-tests/${abTest.id}/report`, {
    token: adminToken,
  }), 'Get A/B report');
  const reportVariantB = report.variants.find((v) => v.id === variantB.id);
  assert(reportVariantB?.impressions >= 1, 'Expected variant impressions >= 1');
  assert(reportVariantB?.conversions >= 1, 'Expected variant conversions >= 1');

  const gamificationSettings = expectOk(await request('/gamification/settings', {
    method: 'PUT',
    token: adminToken,
    body: {
      enabled: true,
      pointsPerQaPass: 11,
      dailyGoalPoints: 25,
    },
  }), 'Update gamification settings');
  assert(gamificationSettings.pointsPerQaPass === 11, 'Expected pointsPerQaPass updated');

  const manualPoints = expectOk(await request('/gamification/points', {
    method: 'POST',
    token: adminToken,
    body: {
      userId: createdSales.id,
      points: 10,
      sourceType: 'MANUAL',
      notes: 'QA verification bonus',
    },
  }), 'Add manual points');
  assert(manualPoints.createdCount >= 2, 'Expected daily+weekly points logs created');

  const leaderboard = expectOk(await request('/gamification/leaderboard', {
    token: adminToken,
    params: { periodType: 'DAILY' },
  }), 'Get daily leaderboard');
  const me = leaderboard.leaderboard.find((row) => row.userId === createdSales.id);
  assert(Boolean(me), 'Expected sales user in leaderboard');
  assert(me.points >= 10, `Expected points >= 10, got ${me.points}`);

  const globalReleaseNote = expectOk(await request('/admin/release-notes', {
    method: 'POST',
    token: adminToken,
    body: {
      title: `Global QA Release ${RUN_ID}`,
      body: 'Global notice for all tenants',
      version: `v-${RUN_ID}`,
      isGlobal: true,
      isPublished: true,
    },
  }), 'Create global release note');
  assert(globalReleaseNote.isGlobal === true, 'Expected created release note to be global');

  const notesForSales = expectOk(await request('/release-notes', {
    token: salesToken,
  }), 'Fetch release notes for sales');
  const globalVisible = notesForSales.find((note) => note.id === globalReleaseNote.id);
  assert(Boolean(globalVisible), 'Expected global release note to be visible to sales');

  const unreadBefore = expectOk(await request('/release-notes/unread-count', {
    token: salesToken,
  }), 'Fetch unread count before read');

  expectOk(await request(`/release-notes/${globalReleaseNote.id}/read`, {
    method: 'POST',
    token: salesToken,
  }), 'Mark global release note as read');

  const unreadAfter = expectOk(await request('/release-notes/unread-count', {
    token: salesToken,
  }), 'Fetch unread count after read');
  assert(unreadAfter.unreadCount <= unreadBefore.unreadCount, 'Expected unread count to decrease or stay equal');

  console.log('QA + A/B + Gamification + Global Release Notes verification passed.');
};

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
