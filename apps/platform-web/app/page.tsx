'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

type Tenant = { id: string; externalKey: string; name: string; status: string };
type Project = { code: string; name: string; status: string };
type Member = { id: string; email: string | null; displayName: string | null; userStatus: string; membershipStatus: string };
type Entitlement = { userId: string; email: string | null; displayName: string | null; projectCode: string; projectName: string; status: string; entitlementVersion: string };
type Permission = { code: string; description: string };
type Role = { id: string; code: string; name: string; projectCode: string; permissionCodes: string[] };
type Assignment = { userId: string; email: string | null; displayName: string | null; projectCode: string; roleId: string; roleName: string; permissionCodes: string[] };
type Invite = { id: string; email: string; displayName: string | null; expiresAt: string; token: string };
type Tab = 'overview' | 'tenants' | 'members' | 'access' | 'roles';
type SessionUser = { sub: string; issuer: string; email?: string; name?: string; emailVerified: boolean };

const navigation: { id: Tab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '▦' },
  { id: 'tenants', label: 'Tenants', icon: '▤' },
  { id: 'members', label: 'Members & invites', icon: '♙' },
  { id: 'access', label: 'Project access', icon: '⌘' },
  { id: 'roles', label: 'Roles & permissions', icon: '◈' },
];
const errorMessage = (payload: unknown) => {
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message?: unknown }).message;
    return Array.isArray(message) ? message.join(', ') : String(message || 'Request failed');
  }
  return 'Request failed';
};

export default function Home() {
  const [connected, setConnected] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [projectCode, setProjectCode] = useState('PIMS');
  const [tenantName, setTenantName] = useState('');
  const [tenantKey, setTenantKey] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [invite, setInvite] = useState<Invite | null>(null);
  const [inviteToken, setInviteToken] = useState('');
  const [accessUser, setAccessUser] = useState('');
  const [accessStatus, setAccessStatus] = useState<'granted' | 'revoked'>('granted');
  const [roleCode, setRoleCode] = useState('');
  const [roleName, setRoleName] = useState('');
  const [rolePermissions, setRolePermissions] = useState<string[]>(['project:read']);
  const [assignUser, setAssignUser] = useState('');
  const [assignRole, setAssignRole] = useState('');
  const [assignStatus, setAssignStatus] = useState<'assigned' | 'revoked'>('assigned');

  useEffect(() => {
    const fromLink = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('invite');
    if (fromLink) setInviteToken(fromLink);
    else {
      const pending = sessionStorage.getItem('realcube:pending-invite');
      if (pending) {
        try {
          const parsed = JSON.parse(pending) as { token?: string; createdAt?: number };
          if (typeof parsed.token === 'string' && typeof parsed.createdAt === 'number' &&
              Date.now() - parsed.createdAt < 15 * 60 * 1000) {
            setInviteToken(parsed.token);
          } else {
            sessionStorage.removeItem('realcube:pending-invite');
          }
        } catch {
          sessionStorage.removeItem('realcube:pending-invite');
        }
      }
    }
    const url = new URL(window.location.href);
    const authError = url.searchParams.get('auth_error');
    if (authError) {
      setError(authError === 'configuration'
        ? 'Single sign-on is not configured. Ask the platform operator to configure the OIDC client.'
        : 'Sign-in could not be completed. Please try again or contact the platform operator.');
      url.searchParams.delete('auth_error');
      window.history.replaceState({}, '', url);
    }
  }, []);

  const api = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body) headers.set('Content-Type', 'application/json');
    const safePath = path.split('/').filter(Boolean).join('/');
    const response = await fetch('/api/platform/' + safePath, {
      ...init, headers, cache: 'no-store', credentials: 'same-origin',
    });
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = text; }
    }
    if (response.status === 401) {
      setConnected(false);
      setUser(null);
    }
    if (!response.ok) throw new Error(errorMessage(payload));
    return payload as T;
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(''); setNotice('');
    try {
      const data = await Promise.all([
        api<Tenant[]>('admin/tenants'),
        api<Project[]>('admin/projects'),
        api<Permission[]>('admin/permissions'),
      ]);
      setTenants(data[0]); setProjects(data[1]); setPermissions(data[2]);
      setTenantId(current => current || data[0][0]?.id || '');
      setProjectCode(current => data[1].some(p => p.code === current) ? current : data[1][0]?.code || 'PIMS');
      setConnected(true);
      setNotice('Connected. The API still enforces authorization on every request.');
    } catch (caught) {
      setConnected(false); setError(caught instanceof Error ? caught.message : 'Connection failed.');
    } finally { setLoading(false); }
  }, [api]);

  useEffect(() => {
    let current = true;
    void fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' })
      .then(async response => {
        if (!response.ok) return { authenticated: false as const };
        return await response.json() as { authenticated: boolean; user?: SessionUser };
      })
      .then(result => {
        if (!current) return;
        if (result.authenticated && result.user) {
          setUser(result.user);
          void load();
        } else {
          setConnected(false);
          setUser(null);
        }
      })
      .catch(() => {
        if (current) {
          setConnected(false);
          setUser(null);
        }
      });
    return () => { current = false; };
  }, [load]);

  const loadTenant = useCallback(async () => {
    if (!connected || !tenantId) return;
    setLoading(true);
    try {
      const data = await Promise.all([
        api<Member[]>('admin/members?tenantId=' + encodeURIComponent(tenantId)),
        api<Entitlement[]>('admin/entitlements?tenantId=' + encodeURIComponent(tenantId)),
        api<Assignment[]>('admin/user-project-roles?tenantId=' + encodeURIComponent(tenantId)),
      ]);
      setMembers(data[0]); setEntitlements(data[1]); setAssignments(data[2]);
      setAccessUser(current => data[0].some(m => m.id === current) ? current : data[0][0]?.id || '');
      setAssignUser(current => data[0].some(m => m.id === current) ? current : data[0][0]?.id || '');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load tenant data.');
    } finally { setLoading(false); }
  }, [connected, tenantId, api]);

  const loadRoles = useCallback(async () => {
    if (!connected || !tenantId || !projectCode) return;
    try {
      const data = await api<Role[]>('admin/roles?tenantId=' + encodeURIComponent(tenantId) + '&projectCode=' + encodeURIComponent(projectCode));
      setRoles(data);
      setAssignRole(current => data.some(r => r.id === current) ? current : data[0]?.id || '');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load roles.'); }
  }, [connected, tenantId, projectCode, api]);

  useEffect(() => { void loadTenant(); }, [loadTenant]);
  useEffect(() => { void loadRoles(); }, [loadRoles]);

  const chosenTenant = useMemo(() => tenants.find(t => t.id === tenantId), [tenants, tenantId]);
  const activeMembers = members.filter(m => m.membershipStatus === 'active' && m.userStatus === 'active');
  const granted = entitlements.filter(e => e.status === 'granted').length;

  async function submitTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      const item = await api<Tenant>('admin/tenants', { method: 'POST', body: JSON.stringify({ externalKey: tenantKey.trim(), name: tenantName.trim() }) });
      setTenants(current => [item, ...current]); setTenantId(item.id); setTenantKey(''); setTenantName('');
      setNotice('Tenant "' + item.name + '" created.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Tenant creation failed.'); }
    finally { setSaving(false); }
  }

  async function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId) { setError('Select a tenant first.'); return; }
    setSaving(true); setError(''); setNotice(''); setInvite(null);
    try {
      const result = await api<Invite>('admin/invitations', { method: 'POST', body: JSON.stringify({ tenantId, email: inviteEmail.trim(), displayName: inviteName.trim() || undefined }) });
      setInvite(result); setInviteEmail(''); setInviteName('');
      setNotice('Invitation created. Copy its one-time link and deliver it through an approved channel.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Invitation failed.'); }
    finally { setSaving(false); }
  }

  async function acceptInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      const result = await api<{ status: string; tenantId: string }>('invitations/accept', { method: 'POST', body: JSON.stringify({ token: inviteToken.trim() }) });
      setNotice('Invitation accepted for tenant ' + result.tenantId + '. You can close this page.');
      setInviteToken('');
      sessionStorage.removeItem('realcube:pending-invite');
      const cleanUrl = new URL(window.location.href);
      cleanUrl.hash = '';
      window.history.replaceState({}, '', cleanUrl);
      const url = new URL(window.location.href); url.searchParams.delete('invite'); url.hash = ''; window.history.replaceState({}, '', url);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Invitation acceptance failed.'); }
    finally { setSaving(false); }
  }

  async function submitAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId || !accessUser) { setError('Choose a tenant member first.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      await api('admin/project-access', { method: 'POST', body: JSON.stringify({ tenantId, userId: accessUser, projectCode, status: accessStatus }) });
      setNotice('Project access ' + accessStatus + ' for ' + projectCode + '.'); await loadTenant();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Access update failed.'); }
    finally { setSaving(false); }
  }

  async function submitRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId) { setError('Choose a tenant first.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      await api('admin/roles', { method: 'POST', body: JSON.stringify({ tenantId, projectCode, code: roleCode.trim(), name: roleName.trim(), permissionCodes: rolePermissions }) });
      setRoleCode(''); setRoleName(''); setNotice('Role created.'); await loadRoles();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Role creation failed.'); }
    finally { setSaving(false); }
  }

  async function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId || !assignUser || !assignRole) { setError('Choose a member and role first.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      await api('admin/user-project-roles', { method: 'POST', body: JSON.stringify({ tenantId, userId: assignUser, projectCode, roleId: assignRole, status: assignStatus }) });
      setNotice('Role ' + assignStatus + '.'); await loadTenant();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Role assignment failed.'); }
    finally { setSaving(false); }
  }

  function copy(value: string) {
    void navigator.clipboard.writeText(value).then(
      () => setNotice('Copied to clipboard.'),
      () => setError('Clipboard is unavailable. Select and copy the invitation link manually.'),
    );
  }

  const memberName = (member: Member) => member.displayName || member.email || member.id;
  const projectOptions = projects.map(p => <option value={p.code} key={p.code}>{p.name} ({p.code})</option>);

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">R</div><div><strong>RealCube</strong><span>Enterprise Workspace</span></div></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav aria-label="Platform navigation">{navigation.map(item => <button key={item.id} type="button" className={'nav-item ' + (tab === item.id ? 'active' : '')} onClick={() => setTab(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}{item.id === 'members' && invite ? <span className="nav-dot" /> : null}</button>)}</nav>
        <div className="sidebar-bottom"><span className={'connection-dot ' + (connected ? 'online' : '')} /><div><strong>{connected ? 'API connected' : 'Not connected'}</strong><span>{connected ? 'Server-checked access' : 'Connect with OIDC token'}</span></div></div>
      </aside>
      <section className="main-area">
        <header className="topbar"><div className="crumb"><span>Platform</span><span className="crumb-divider">/</span><strong>{navigation.find(n => n.id === tab)?.label}</strong></div><div className="topbar-right"><span className="environment"><i /> CONTROL PLANE</span><span className="avatar">EP</span></div></header>
        <div className="content">
          <div className="page-title-row"><div><p className="eyebrow">REALCUBE / PLATFORM ADMINISTRATION</p><h1>{tab === 'overview' ? 'Enterprise Platform' : navigation.find(n => n.id === tab)?.label}</h1><p className="lede">Identity, tenant membership and project entitlements in one control plane.</p></div><div className="tenant-picker"><label htmlFor="tenant-context">Active tenant<select id="tenant-context" value={tenantId} onChange={e => setTenantId(e.target.value)} disabled={!tenants.length}><option value="">Select tenant</option>{tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label></div></div>
          {inviteToken && <section className="invite-accept-panel"><div><span className="kicker">MEMBER INVITATION</span><h2>Accept your workspace invitation</h2><p>Sign in through your trusted OIDC provider first. The API checks that the signed-in identity has a verified email matching this invitation.</p></div><form className="inline-form" onSubmit={acceptInvite}><label>Invitation token<input value={inviteToken} onChange={e => setInviteToken(e.target.value)} required /></label><button className="button primary" disabled={saving || !connected}>{saving ? 'Processing…' : 'Accept invitation'}</button></form></section>}
          <section className="connect-panel">
            <div className="connect-copy">
              <span className={'status-pill ' + (connected ? 'success' : 'neutral')}><i />{connected ? 'AUTHENTICATED' : 'SINGLE SIGN-ON'}</span>
              <h2>{connected ? 'Administrator session' : 'Sign in to Enterprise Platform'}</h2>
              <p>{connected
                ? 'Signed in as ' + (user?.email || user?.name || user?.sub || 'authenticated administrator') + '. The API checks your permissions on every request.'
                : 'Use your organization identity provider. Authorization code + PKCE keeps provider tokens on the server and out of browser JavaScript.'}</p>
            </div>
            <div className="auth-actions">
              {!connected ? (
                <a className="button primary" href="/api/auth/login" onClick={() => {
                  if (inviteToken) sessionStorage.setItem('realcube:pending-invite', JSON.stringify({ token: inviteToken, createdAt: Date.now() }));
                }}>Sign in with SSO <span>→</span></a>
              ) : (
                <>
                  <button type="button" className="button secondary" disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh data'}</button>
                  <form action="/api/auth/logout" method="post">
                    <button type="submit" className="button secondary">Sign out</button>
                  </form>
                </>
              )}
            </div>
          </section>
          {error && <div className="feedback error" role="alert"><span>!</span><p>{error}</p><button type="button" aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
          {notice && <div className="feedback success" role="status"><span>✓</span><p>{notice}</p><button type="button" aria-label="Dismiss notice" onClick={() => setNotice('')}>×</button></div>}

          {!connected ? <section className="welcome-panel"><div className="welcome-art" aria-hidden="true"><div className="ring ring-one" /><div className="ring ring-two" /><div className="art-core">R</div><div className="art-node node-one">ID</div><div className="art-node node-two">ACL</div><div className="art-node node-three">API</div></div><div className="welcome-content"><span className="kicker">CONTROL PLANE OVERVIEW</span><h2>One secure foundation for every RealCube project.</h2><p>Connect to load live tenants, active members, project access and permission-aware roles from the Platform API.</p><div className="feature-row"><span>✓ OIDC protected</span><span>✓ Tenant-scoped roles</span><span>✓ Audited changes</span></div></div></section>
          : tab === 'overview' ? <>
            <div className="stats-grid"><article className="stat-card"><span className="stat-icon blue">▤</span><span className="stat-label">ACTIVE TENANTS</span><strong>{tenants.filter(t => t.status === 'active').length}</strong><p>{tenants.length} total registered</p></article><article className="stat-card"><span className="stat-icon violet">♙</span><span className="stat-label">ACTIVE MEMBERS</span><strong>{activeMembers.length}</strong><p>{chosenTenant ? chosenTenant.name : 'Choose a tenant'}</p></article><article className="stat-card"><span className="stat-icon teal">⌘</span><span className="stat-label">PROJECT GRANTS</span><strong>{granted}</strong><p>{entitlements.length} grants and revocations</p></article><article className="stat-card"><span className="stat-icon amber">◈</span><span className="stat-label">ROLE ASSIGNMENTS</span><strong>{assignments.length}</strong><p>Scoped to active tenant</p></article></div>
            <div className="section-title"><div><h2>Project registry</h2><p>Independent business applications governed by this control plane.</p></div><span className="count-tag">{projects.length} PROJECTS</span></div><div className="project-grid">{projects.map((p, i) => <article className="project-card" key={p.code}><div className={'project-symbol symbol-' + (i % 5)}>{p.code.slice(0, 2)}</div><div className="project-info"><h3>{p.name}</h3><span>{p.code}</span></div><span className={'mini-status ' + (p.status === 'active' ? 'is-active' : '')}>{p.status}</span><p>{p.status === 'active' ? 'Available for tenant entitlement assignment' : 'Not currently assignable'}</p></article>)}</div>
          </> : tab === 'tenants' ? <div className="two-column">
            <section className="panel"><div className="panel-heading"><div><span className="kicker">REGISTRY</span><h2>Tenant directory</h2><p>Organizations enabled in the workspace.</p></div><span className="count-tag">{tenants.length} TOTAL</span></div><div className="data-list">{tenants.map(t => <button type="button" className={'list-row ' + (tenantId === t.id ? 'selected' : '')} key={t.id} onClick={() => setTenantId(t.id)}><span className="list-avatar">{t.name.slice(0, 1).toUpperCase()}</span><span className="list-main"><strong>{t.name}</strong><small>{t.externalKey}</small></span><span className={'mini-status ' + (t.status === 'active' ? 'is-active' : '')}>{t.status}</span></button>)}{!tenants.length && <div className="empty-state">No tenants yet. Create one with the form.</div>}</div></section>
            <section className="panel"><div className="panel-heading"><div><span className="kicker">CREATE</span><h2>New tenant</h2><p>Register an organization before inviting members.</p></div></div><form className="form-stack" onSubmit={submitTenant}><label>Tenant name<input value={tenantName} onChange={e => setTenantName(e.target.value)} required maxLength={200} placeholder="e.g. Asteco Properties" /></label><label>External key<input value={tenantKey} onChange={e => setTenantKey(e.target.value)} required maxLength={100} placeholder="e.g. ASTECO" /></label><p className="form-hint">External keys must be unique.</p><button className="button primary" disabled={saving}>{saving ? 'Creating…' : 'Create tenant'} <span>→</span></button></form></section>
          </div> : tab === 'members' ? <div className="two-column">
            <section className="panel"><div className="panel-heading"><div><span className="kicker">TENANT MEMBERSHIP</span><h2>{chosenTenant?.name || 'Choose a tenant'}</h2><p>Members are linked to OIDC identities only after a verified-email invitation is accepted.</p></div><span className="count-tag">{members.length} MEMBERS</span></div><div className="data-list">{members.map(m => <div className="list-row" key={m.id}><span className="list-avatar user">{memberName(m).slice(0, 1).toUpperCase()}</span><span className="list-main"><strong>{memberName(m)}</strong><small>{m.email || 'No email'} · {m.id.slice(0, 8)}</small></span><span className={'mini-status ' + (m.membershipStatus === 'active' && m.userStatus === 'active' ? 'is-active' : '')}>{m.membershipStatus}</span></div>)}{!members.length && <div className="empty-state">No memberships for this tenant.</div>}</div></section>
            <section className="panel"><div className="panel-heading"><div><span className="kicker">ONBOARDING</span><h2>Invite a member</h2><p>Creates a one-time link tied to the recipient’s verified OIDC email.</p></div></div><form className="form-stack" onSubmit={submitInvite}><label>Full name <span className="optional">OPTIONAL</span><input value={inviteName} onChange={e => setInviteName(e.target.value)} maxLength={200} placeholder="Recipient name" /></label><label>Work email<input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} required maxLength={320} placeholder="name@company.com" /></label><button className="button primary" disabled={saving || !tenantId}>{saving ? 'Creating invitation…' : 'Generate invitation'} <span>→</span></button></form>
            {invite && <div className="invite-result"><div className="result-top"><strong>Invitation ready</strong><span className="mini-status is-pending">One-time token</span></div><p>For <strong>{invite.email}</strong>, expires {new Date(invite.expiresAt).toLocaleString()}.</p><label>Invite URL<input readOnly value={typeof window === 'undefined' ? '' : window.location.origin + '/#invite=' + invite.token} /></label><button type="button" className="button secondary full" onClick={() => copy(window.location.origin + '/?invite=' + invite.token)}>Copy invitation link</button><p className="security-note">Token is returned only once. Deliver to the intended recipient. Email delivery is not configured.</p></div>}</section>
          </div> : tab === 'access' ? <>
            <section className="filter-bar"><div><label>Tenant<select value={tenantId} onChange={e => setTenantId(e.target.value)}><option value="">Select tenant</option>{tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label>Project<select value={projectCode} onChange={e => setProjectCode(e.target.value)}>{projectOptions}</select></label></div><span className="count-tag">{entitlements.length} ACCESS RECORDS</span></section>
            <div className="two-column access-layout"><section className="panel"><div className="panel-heading"><div><span className="kicker">ENTITLEMENTS</span><h2>Project access</h2><p>Revocation also removes role assignments for the project.</p></div></div><form className="form-stack" onSubmit={submitAccess}><label>Tenant member<select value={accessUser} onChange={e => setAccessUser(e.target.value)} required><option value="">Select member</option>{members.map(m => <option key={m.id} value={m.id}>{memberName(m)} ({m.membershipStatus})</option>)}</select></label><label>Action<select value={accessStatus} onChange={e => setAccessStatus(e.target.value as 'granted' | 'revoked')}><option value="granted">Grant access</option><option value="revoked">Revoke access</option></select></label><button className={'button ' + (accessStatus === 'revoked' ? 'danger' : 'primary')} disabled={saving || !accessUser}>{saving ? 'Updating…' : accessStatus === 'granted' ? 'Grant project access' : 'Revoke project access'}</button></form></section>
            <section className="panel"><div className="panel-heading"><div><span className="kicker">CURRENT STATE</span><h2>Access ledger</h2><p>Current status in the control-plane database.</p></div></div><div className="data-list">{entitlements.map((e, i) => <div className="list-row" key={e.userId + e.projectCode + i}><span className="list-avatar user">{(e.displayName || e.email || '?').slice(0, 1).toUpperCase()}</span><span className="list-main"><strong>{e.displayName || e.email || e.userId}</strong><small>{e.projectName} · v{e.entitlementVersion}</small></span><span className={'mini-status ' + (e.status === 'granted' ? 'is-active' : '')}>{e.status}</span></div>)}{!entitlements.length && <div className="empty-state">No project-access records yet.</div>}</div></section></div>
          </> : <>
            <section className="filter-bar"><div><label>Tenant<select value={tenantId} onChange={e => setTenantId(e.target.value)}><option value="">Select tenant</option>{tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label>Project scope<select value={projectCode} onChange={e => setProjectCode(e.target.value)}>{projectOptions}</select></label></div><span className="count-tag">{permissions.length} PERMISSIONS</span></section>
            <div className="two-column"><section className="panel"><div className="panel-heading"><div><span className="kicker">ROLE DESIGNER</span><h2>Create a role</h2><p>Permissions are scoped to this tenant and project.</p></div></div><form className="form-stack" onSubmit={submitRole}><label>Role name<input value={roleName} onChange={e => setRoleName(e.target.value)} required maxLength={100} placeholder="e.g. Leasing Manager" /></label><label>Role code<input value={roleCode} onChange={e => setRoleCode(e.target.value.toLowerCase().replace(/\s+/g, '-'))} required maxLength={64} pattern="[a-z][a-z0-9_-]{1,63}" placeholder="leasing-manager" /></label><div className="permission-list"><div className="permission-title">Permission set</div>{permissions.map(p => <label className="permission-option" key={p.code}><input type="checkbox" checked={rolePermissions.includes(p.code)} onChange={e => setRolePermissions(current => e.target.checked ? [...current, p.code] : current.filter(c => c !== p.code))} /><span><strong>{p.code}</strong><small>{p.description}</small></span></label>)}</div><button className="button primary" disabled={saving || !rolePermissions.length}>{saving ? 'Creating…' : 'Create scoped role'} <span>→</span></button></form></section>
            <section className="panel"><div className="panel-heading"><div><span className="kicker">ROLE ASSIGNMENT</span><h2>Assign to a member</h2><p>A granted project entitlement is required first.</p></div></div><form className="form-stack" onSubmit={submitAssignment}><label>Tenant member<select value={assignUser} onChange={e => setAssignUser(e.target.value)} required><option value="">Select member</option>{members.map(m => <option key={m.id} value={m.id}>{memberName(m)}</option>)}</select></label><label>Role<select value={assignRole} onChange={e => setAssignRole(e.target.value)} required><option value="">Select role</option>{roles.map(r => <option key={r.id} value={r.id}>{r.name} · {r.code}</option>)}</select></label><label>Action<select value={assignStatus} onChange={e => setAssignStatus(e.target.value as 'assigned' | 'revoked')}><option value="assigned">Assign role</option><option value="revoked">Revoke role</option></select></label><button className={'button ' + (assignStatus === 'revoked' ? 'danger' : 'primary')} disabled={saving || !assignUser || !assignRole}>{saving ? 'Saving…' : assignStatus === 'assigned' ? 'Assign role' : 'Revoke role'}</button></form><div className="subsection-heading"><h3>Current assignments</h3><span>{assignments.length}</span></div><div className="data-list compact">{assignments.filter(a => a.projectCode === projectCode).map((a, i) => <div className="list-row" key={a.userId + a.roleId + i}><span className="list-avatar user">{(a.displayName || a.email || '?').slice(0, 1).toUpperCase()}</span><span className="list-main"><strong>{a.displayName || a.email}</strong><small>{a.roleName} · {a.permissionCodes.length} permissions</small></span><span className="mini-status is-active">{a.projectCode}</span></div>)}{!assignments.some(a => a.projectCode === projectCode) && <div className="empty-state slim">No role assignments for this project.</div>}</div></section></div>
            <section className="panel roles-panel"><div className="panel-heading"><div><span className="kicker">CONFIGURED ROLES</span><h2>{projectCode} roles</h2><p>Each role is tenant- and project-scoped.</p></div><span className="count-tag">{roles.length} ROLES</span></div><div className="role-grid">{roles.map(r => <article className="role-card" key={r.id}><div className="role-card-head"><span className="role-mark">◈</span><span className="mini-status is-active">ACTIVE</span></div><h3>{r.name}</h3><p>{r.code}</p><div className="chips">{r.permissionCodes.map(p => <span key={p}>{p}</span>)}</div></article>)}{!roles.length && <div className="empty-state">No roles yet for this scope. Create one above.</div>}</div></section>
          </>}
          <footer className="footer"><span>REALCUBE ENTERPRISE PLATFORM</span><span>API checks permissions on every request · UI state is not an authorization boundary</span></footer>
        </div>
      </section>
    </main>
  );
}
