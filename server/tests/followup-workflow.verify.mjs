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
  console.log('Running automatic follow-up workflow verification...');
  const admin = await login('admin@edicon.com', 'admin123');
  const adminToken = admin.token;

  const team = expectOk(await request('/teams', {
    method: 'POST',
    token: adminToken,
    body: { name: `QA Follow-up Team ${RUN_ID}` },
  }), 'Create team');

  const salesEmail = `sales-followup-${RUN_ID}@qa.local`;
  expectOk(await request('/users', {
    method: 'POST',
    token: adminToken,
    body: {
      name: `Sales Follow-up ${RUN_ID}`,
      email: salesEmail,
      password: 'pass1234',
      role: 'SALES',
      teamId: team.id,
    },
  }), 'Create sales user');

  const sales = await login(salesEmail, 'pass1234');
  const salesToken = sales.token;

  const lead = expectOk(await request('/leads', {
    method: 'POST',
    token: salesToken,
    body: {
      name: `Lead Follow-up ${RUN_ID}`,
      phone: `010${String(RUN_ID).slice(-8)}`,
      status: 'NO_ANSWER',
      source: 'CALL',
      gender: 'MALE',
      notes: 'no answer first attempt',
      callDurationSec: 45,
    },
  }), 'Create no-answer lead');

  const queue = expectOk(await request('/leads/followups', {
    token: salesToken,
    params: { dueOnly: 0 },
  }), 'Fetch follow-up queue');

  const followTask = queue.find((item) => item.leadId === lead.id && item.status === 'PENDING');
  assert(Boolean(followTask), 'Expected pending automatic follow-up task');
  assert(followTask.triggerStatus === 'NO_ANSWER', `Expected triggerStatus=NO_ANSWER, got ${followTask.triggerStatus}`);

  expectOk(await request(`/leads/${lead.id}/recontact/complete`, {
    method: 'POST',
    token: salesToken,
    body: {
      outcome: 'AGREED',
      source: 'CALL',
      notes: 'customer converted on follow-up',
      callDurationSec: 120,
    },
  }), 'Complete follow-up as agreed');

  const queueAfter = expectOk(await request('/leads/followups', {
    token: salesToken,
    params: { dueOnly: 0 },
  }), 'Fetch follow-up queue after completion');
  const stillPending = queueAfter.find((item) => item.leadId === lead.id && item.status === 'PENDING');
  assert(!stillPending, 'Expected follow-up task to be completed and removed from pending queue');

  const stats = expectOk(await request('/stats', { token: salesToken }), 'Fetch stats');
  assert(typeof stats?.performance?.conversion === 'number', 'Expected performance.conversion in stats');
  assert(typeof stats?.performance?.avgTalkTime === 'number', 'Expected performance.avgTalkTime in stats');
  assert(typeof stats?.performance?.followupSLA === 'number', 'Expected performance.followupSLA in stats');
  assert(typeof stats?.performance?.recontactSuccess === 'number', 'Expected performance.recontactSuccess in stats');
  assert(stats.performance.recontactSuccess >= 100, `Expected recontactSuccess >= 100, got ${stats.performance.recontactSuccess}`);

  console.log('Automatic follow-up workflow verification passed.');
};

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
