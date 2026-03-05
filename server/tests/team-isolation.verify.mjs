const API_BASE = process.env.API_BASE || 'http://localhost:5000/api';
const RUN_ID = Date.now();

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
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

const login = async (email, password) => {
  const { response, data } = await request('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  assert(response.ok, `Login failed for ${email}: ${data?.error || response.status}`);
  return data;
};

const createTeam = async (adminToken, name) => {
  const { response, data } = await request('/teams', {
    method: 'POST',
    token: adminToken,
    body: { name },
  });
  assert(response.ok, `Create team failed: ${data?.error || response.status}`);
  return data;
};

const createUser = async (token, payload) => {
  const { response, data } = await request('/users', {
    method: 'POST',
    token,
    body: payload,
  });
  assert(response.ok, `Create user failed: ${data?.error || response.status}`);
  return data;
};

const createPoolLead = async (token, teamId, phone) => {
  const { response, data } = await request('/leads/bulk', {
    method: 'POST',
    token,
    body: { teamId, leads: [{ name: `Lead-${phone}`, phone }] },
  });
  assert(response.ok, `Bulk upload failed: ${data?.error || response.status}`);
  return data;
};

const claimLead = async (token) => {
  const { response, data } = await request('/leads/claim', { method: 'POST', token });
  assert(response.ok, `Claim lead failed: ${data?.error || response.status}`);
  return data;
};

const run = async () => {
  console.log('Running team isolation verification...');
  const admin = await login('admin@edicon.com', 'admin123');
  const adminToken = admin.token;

  const teamA = await createTeam(adminToken, `QA Team A ${RUN_ID}`);
  const teamB = await createTeam(adminToken, `QA Team B ${RUN_ID}`);

  const leadAUser = await createUser(adminToken, {
    name: `Lead A ${RUN_ID}`,
    email: `lead-a-${RUN_ID}@qa.local`,
    password: 'pass1234',
    role: 'TEAM_LEAD',
    teamId: teamA.id,
  });
  const leadBUser = await createUser(adminToken, {
    name: `Lead B ${RUN_ID}`,
    email: `lead-b-${RUN_ID}@qa.local`,
    password: 'pass1234',
    role: 'TEAM_LEAD',
    teamId: teamB.id,
  });

  const leadALogin = await login(`lead-a-${RUN_ID}@qa.local`, 'pass1234');
  const leadAToken = leadALogin.token;
  const salesA = await createUser(leadAToken, {
    name: `Sales A ${RUN_ID}`,
    email: `sales-a-${RUN_ID}@qa.local`,
    password: 'pass1234',
    role: 'SALES',
    employeeProfile: { dailyCallTarget: 17, department: 'Inside Sales' },
  });
  assert(salesA.teamId === teamA.id, 'Sales A must be created inside Team A');

  const leadBLogin = await login(`lead-b-${RUN_ID}@qa.local`, 'pass1234');
  const leadBToken = leadBLogin.token;
  const salesB = await createUser(leadBToken, {
    name: `Sales B ${RUN_ID}`,
    email: `sales-b-${RUN_ID}@qa.local`,
    password: 'pass1234',
    role: 'SALES',
    employeeProfile: { dailyCallTarget: 19, department: 'Inside Sales' },
  });
  assert(salesB.teamId === teamB.id, 'Sales B must be created inside Team B');

  await createPoolLead(adminToken, teamA.id, `010${String(RUN_ID).slice(-8)}`);
  await createPoolLead(adminToken, teamB.id, `011${String(RUN_ID).slice(-8)}`);

  const salesALogin = await login(`sales-a-${RUN_ID}@qa.local`, 'pass1234');
  const salesBLogin = await login(`sales-b-${RUN_ID}@qa.local`, 'pass1234');
  const salesAToken = salesALogin.token;
  const salesBToken = salesBLogin.token;

  const claimedA = await claimLead(salesAToken);
  const claimedB = await claimLead(salesBToken);
  assert(claimedA.teamId === teamA.id, 'Sales A must only claim Team A lead');
  assert(claimedB.teamId === teamB.id, 'Sales B must only claim Team B lead');

  const leadListA = await request('/leads', { token: salesAToken });
  assert(leadListA.response.ok, 'Sales A list leads failed');
  assert((leadListA.data || []).every((lead) => lead.teamId === teamA.id), 'Sales A saw leads from another team');

  const forbiddenView = await request(`/leads/${claimedB.id}`, { token: salesAToken });
  assert(forbiddenView.response.status === 403, 'Sales A should not access Team B lead details');

  const teamLeadAList = await request('/leads', { token: leadAToken });
  assert(teamLeadAList.response.ok, 'Team lead A list leads failed');
  assert((teamLeadAList.data || []).every((lead) => lead.teamId === teamA.id), 'Team lead A saw other team leads');

  const updateOwnTeam = await request(`/admin/employees/${salesA.id}/profile`, {
    method: 'PUT',
    token: leadAToken,
    body: { dailyCallTarget: 25, department: 'Inside Sales', timezone: 'Africa/Cairo', isActive: true },
  });
  assert(updateOwnTeam.response.ok, 'Team lead A should update own team sales profile');

  const updateOtherTeam = await request(`/admin/employees/${salesB.id}/profile`, {
    method: 'PUT',
    token: leadAToken,
    body: { dailyCallTarget: 25, department: 'Inside Sales', timezone: 'Africa/Cairo', isActive: true },
  });
  assert(updateOtherTeam.response.status === 403, 'Team lead A must not update other team profile');

  const statsLeadA = await request('/stats', { token: leadAToken });
  assert(statsLeadA.response.ok, 'Team lead A stats request failed');
  assert(statsLeadA.data?.scope === 'TEAM', 'Team lead stats scope must be TEAM');

  console.log('Team isolation verification passed.');
};

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
