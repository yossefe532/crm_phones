const API_BASE = process.env.API_BASE || 'http://localhost:5000/api';
const RUN_ID = Date.now();

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const request = async (path, { method = 'GET', token, body } = {}) => {
  const response = await fetch(`${API_BASE}${path}`, {
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
  console.log('Running same-day status transition target verification...');
  const admin = await login('admin@edicon.com', 'admin123');
  const adminToken = admin.token;

  const team = expectOk(await request('/teams', {
    method: 'POST',
    token: adminToken,
    body: { name: `QA Target Team ${RUN_ID}` },
  }), 'Create team');

  const salesEmail = `sales-target-${RUN_ID}@qa.local`;
  expectOk(await request('/users', {
    method: 'POST',
    token: adminToken,
    body: {
      name: `Sales Target ${RUN_ID}`,
      email: salesEmail,
      password: 'pass1234',
      role: 'SALES',
      teamId: team.id,
      employeeProfile: {
        dailyCallTarget: 1,
        dailyInterestedTarget: 1,
        dailyApprovalTarget: 1,
        department: 'Inside Sales',
      },
    },
  }), 'Create sales user');

  const sales = await login(salesEmail, 'pass1234');
  const salesToken = sales.token;

  const lead = expectOk(await request('/leads', {
    method: 'POST',
    token: salesToken,
    body: {
      name: `Lead ${RUN_ID}`,
      phone: `010${String(RUN_ID).slice(-8)}`,
      status: 'HESITANT',
      source: 'CALL',
      gender: 'MALE',
      notes: 'initial hesitant',
    },
  }), 'Create hesitant lead');

  const statsAfterCreate = expectOk(await request('/stats', { token: salesToken }), 'Fetch stats after create');
  assert(statsAfterCreate.callsToday === 1, `Expected callsToday=1 after create, got ${statsAfterCreate.callsToday}`);
  assert(statsAfterCreate.interestedToday === 0, `Expected interestedToday=0 after create, got ${statsAfterCreate.interestedToday}`);
  assert(statsAfterCreate.approvalsToday === 0, `Expected approvalsToday=0 after create, got ${statsAfterCreate.approvalsToday}`);

  expectOk(await request(`/leads/${lead.id}`, {
    method: 'PUT',
    token: salesToken,
    body: {
      name: lead.name,
      status: 'INTERESTED',
      notes: 'became interested same day',
      gender: lead.gender || 'MALE',
      whatsappPhone: lead.whatsappPhone || null,
      profileDetails: lead.profileDetails || null,
    },
  }), 'Update lead HESITANT->INTERESTED');

  const statsAfterInterested = expectOk(await request('/stats', { token: salesToken }), 'Fetch stats after interested');
  assert(statsAfterInterested.callsToday === 1, `Expected callsToday to stay 1 after transition, got ${statsAfterInterested.callsToday}`);
  assert(statsAfterInterested.interestedToday === 1, `Expected interestedToday=1 after HESITANT->INTERESTED, got ${statsAfterInterested.interestedToday}`);

  expectOk(await request(`/leads/${lead.id}`, {
    method: 'PUT',
    token: salesToken,
    body: {
      name: lead.name,
      status: 'AGREED',
      notes: 'became agreed same day',
      gender: lead.gender || 'MALE',
      whatsappPhone: lead.whatsappPhone || null,
      profileDetails: lead.profileDetails || null,
    },
  }), 'Update lead INTERESTED->AGREED');

  const statsAfterAgreed = expectOk(await request('/stats', { token: salesToken }), 'Fetch stats after agreed');
  assert(statsAfterAgreed.callsToday === 1, `Expected callsToday to stay 1 after second transition, got ${statsAfterAgreed.callsToday}`);
  assert(statsAfterAgreed.approvalsToday === 1, `Expected approvalsToday=1 after INTERESTED->AGREED, got ${statsAfterAgreed.approvalsToday}`);

  console.log('Same-day status transition target verification passed.');
};

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
