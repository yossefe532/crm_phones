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

const createTeam = async (token, name) => {
  const { response, data } = await request('/teams', {
    method: 'POST',
    token,
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
  return { response, data };
};

const createLead = async (token, payload) => {
  const { response, data } = await request('/leads', {
    method: 'POST',
    token,
    body: payload,
  });
  assert(response.ok, `Create lead failed: ${data?.error || response.status}`);
  return data;
};

const run = async () => {
  console.log('Running tenant isolation verification...');
  const adminA = await login('admin@edicon.com', 'admin123');
  const adminB = await login('admin@crm.com', 'admin123');
  const tokenA = adminA.token;
  const tokenB = adminB.token;

  const teamA = await createTeam(tokenA, `Tenant-A-Team-${RUN_ID}`);
  const teamB = await createTeam(tokenB, `Tenant-B-Team-${RUN_ID}`);

  const adminACreateCrossTenantUser = await createUser(tokenA, {
    name: `Cross User ${RUN_ID}`,
    email: `cross-${RUN_ID}@qa.local`,
    password: 'pass1234',
    role: 'SALES',
    teamId: teamB.id,
  });
  assert(
    adminACreateCrossTenantUser.response.status === 404,
    'Admin A must not be able to create users in tenant B teams',
  );

  const usersA = await request('/users', { token: tokenA });
  const usersB = await request('/users', { token: tokenB });
  assert(usersA.response.ok && usersB.response.ok, 'Users list failed for admins');
  assert((usersA.data || []).every((user) => user.tenantId === adminA.user.tenantId), 'Admin A saw users from another tenant');
  assert((usersB.data || []).every((user) => user.tenantId === adminB.user.tenantId), 'Admin B saw users from another tenant');

  const leadB = await createLead(tokenB, {
    name: `Tenant B Lead ${RUN_ID}`,
    phone: `010${String(RUN_ID).slice(-8)}`,
    status: 'NEW',
    source: 'CALL',
    teamId: teamB.id,
    gender: 'UNKNOWN',
  });
  assert(leadB.tenantId === adminB.user.tenantId, 'Lead tenant assignment failed for admin B');

  const forbiddenLeadView = await request(`/leads/${leadB.id}`, { token: tokenA });
  assert(forbiddenLeadView.response.status === 403, 'Admin A must not access tenant B lead details');

  const leadsA = await request('/leads', { token: tokenA });
  const leadsB = await request('/leads', { token: tokenB });
  assert(leadsA.response.ok && leadsB.response.ok, 'Leads list failed for admins');
  assert((leadsA.data || []).every((lead) => lead.tenantId === adminA.user.tenantId), 'Admin A saw leads from another tenant');
  assert((leadsB.data || []).every((lead) => lead.tenantId === adminB.user.tenantId), 'Admin B saw leads from another tenant');

  const teamsA = await request('/teams', { token: tokenA });
  const teamsB = await request('/teams', { token: tokenB });
  assert(teamsA.response.ok && teamsB.response.ok, 'Teams list failed for admins');
  const teamAIds = new Set((teamsA.data || []).map((team) => team.id));
  const teamBIds = new Set((teamsB.data || []).map((team) => team.id));
  const overlap = [...teamAIds].filter((id) => teamBIds.has(id));
  assert(overlap.length === 0, 'Tenants should not share visible teams');

  const statsA = await request('/stats', { token: tokenA });
  const statsB = await request('/stats', { token: tokenB });
  assert(statsA.response.ok && statsB.response.ok, 'Stats endpoint failed for admins');
  assert(statsA.data?.scope === 'TENANT', 'Admin stats scope for tenant A must be TENANT');
  assert(statsB.data?.scope === 'TENANT', 'Admin stats scope for tenant B must be TENANT');

  console.log('Tenant isolation verification passed.');
};

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
