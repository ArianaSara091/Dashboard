import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowLeft, ArrowRight, ArrowUpDown, CalendarDays, Check,
  ChevronDown, ChevronLeft, CircleHelp, Clock3, Command, ExternalLink, LayoutDashboard,
  LogOut, Menu, Search, Settings2, Shield, ShieldAlert, ShieldCheck, ShieldPlus,
  SlidersHorizontal, Users, X,
} from 'lucide-react';
import {
  getGetGuildDashboardQueryKey, getGetGuildSettingsQueryKey,
  getListManagedGuildsQueryKey, useGetAuthSession, useGetGuildDashboard, useGetGuildReports,
  useGetGuildSettings, useHealthCheck, useListGuildStaff, useListManagedGuilds,
  useLogout, useUpdateGuildSettings, useUpdateGuildStaff,
} from '@workspace/api-client-react';
import type { Guild, StaffMember } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Route, Switch, useLocation, useParams, Router as WouterRouter, Link,
} from 'wouter';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand-mark ${compact ? 'brand-mark-small' : ''}`} aria-label="Vampire">
    <div className="brand-symbol"><span /><span /><span /></div>
    {!compact && <span className="brand-word">VAMPIRE<span className="brand-period">.</span></span>}
  </div>;
}

function Avatar({ src, name, size = 'md' }: { src?: string | null; name: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'V';
  return <span className={`avatar avatar-${size}`} aria-label={name}>
    {src ? <img src={src} alt="" /> : initials}
  </span>;
}

function StatusPill({ status }: { status: Guild['botStatus'] }) {
  if (status === 'installed') return <span className="status-pill status-live"><i />Vampire installed</span>;
  if (status === 'not_installed') return <span className="status-pill status-off"><i />Not installed</span>;
  return <span className="status-pill status-unknown"><i />Status unverified</span>;
}

function LoadState({ label = 'Loading your dashboard' }: { label?: string }) {
  return <div className="loading-panel" role="status">
    <div className="skeleton-line skeleton-wide" /><div className="skeleton-line skeleton-mid" />
    <span>{label}</span>
  </div>;
}

function ErrorState({ message = 'We could not load this information.', retry }: { message?: string; retry: () => void }) {
  return <div className="state-panel state-error">
    <span className="state-icon"><ShieldAlert size={20} /></span>
    <h3>Something went wrong</h3><p>{message}</p>
    <button className="button button-secondary button-small" onClick={retry} data-testid="button-retry">Try again</button>
  </div>;
}

function EmptyState({ title, description, icon: Icon = ShieldCheck }: { title: string; description: string; icon?: typeof ShieldCheck }) {
  return <div className="state-panel">
    <span className="state-icon"><Icon size={21} /></span>
    <h3>{title}</h3><p>{description}</p>
  </div>;
}

function LoginPage({ authLoading, authError }: { authLoading: boolean; authError: boolean }) {
  const params = new URLSearchParams(window.location.search);
  const feedback = params.get('error') || params.get('auth');
  const [connecting, setConnecting] = useState(false);
  return <main className="login-page">
    <div className="login-noise" />
    <header className="login-header"><Brand /><span className="secure-tag"><ShieldCheck size={14} /> SECURE CONTROL ROOM</span></header>
    <section className="login-hero">
      <div className="login-kicker"><span className="pulse-dot" /> DISCORD SERVER OPERATIONS</div>
      <h1>Your servers.<br /><em>Your command.</em></h1>
      <p className="login-copy">A focused control room for the communities you manage. Sign in with Discord to continue.</p>
      {(authError || feedback) && <div className="notice notice-warn" role="status" data-testid="status-auth-feedback">
        <ShieldAlert size={17} /><span>{feedback === 'access_denied' ? 'Discord access was not granted. You can try again whenever you are ready.' : 'We could not complete that sign-in. Please try again.'}</span>
      </div>}
      <a className={`button button-primary login-button ${connecting ? 'is-loading' : ''}`} href="/api/auth/discord" onClick={() => setConnecting(true)} data-testid="link-discord-login">
        <DiscordGlyph /><span>{connecting ? 'Connecting to Discord…' : 'Continue with Discord'}</span><ArrowRight size={18} />
      </a>
      <div className="login-security"><span><Shield size={15} /> No password stored</span><span className="security-divider" /><span>Discord handles your sign-in</span></div>
      {authLoading && <div className="login-session-note">Checking your session…</div>}
    </section>
    <aside className="login-aside">
      <div className="orbit-orb orb-one" /><div className="orbit-orb orb-two" /><div className="orbit-orb orb-three" />
      <div className="orbit-ring ring-one" /><div className="orbit-ring ring-two" />
      <div className="orbit-center"><Brand compact /></div>
      <div className="orbit-caption"><span className="orbit-caption-line" /> PRIVATE BY DESIGN</div>
    </aside>
    <footer className="login-footer"><span>VAMPIRE / SERVER MANAGEMENT</span><span>AUTHENTICATED THROUGH DISCORD</span></footer>
  </main>;
}

function DiscordGlyph() {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.7 5.4a18.7 18.7 0 0 0-4.6-1.4l-.6 1.2a17.3 17.3 0 0 0-5 0L8.9 4a18.6 18.6 0 0 0-4.6 1.4C1.4 9.7.6 13.8 1 17.8a18.8 18.8 0 0 0 5.7 2.9l1.2-2a12.2 12.2 0 0 1-1.9-.9l.5-.4a13.4 13.4 0 0 0 11 0l.5.4-1.9.9 1.2 2a18.8 18.8 0 0 0 5.7-2.9c.5-4.6-.8-8.6-3.3-12.4ZM8.8 14.7c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2Zm6.4 0c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2Z" />
  </svg>;
}

function Sidebar({ guild, health, mobileOpen, closeMobile }: { guild?: Guild; health?: string; mobileOpen: boolean; closeMobile: () => void }) {
  const [location] = useLocation();
  const guildId = location.match(/^\/server\/([^/]+)/)?.[1];
  const activePrefix = guildId ? `/server/${guildId}` : '';
  const items = guildId ? [
    { href: activePrefix, label: 'Overview', icon: LayoutDashboard, suffix: '' },
    { href: `${activePrefix}/staff`, label: 'Staff', icon: Users, suffix: '/staff' },
    { href: `${activePrefix}/reports`, label: 'Reports', icon: Activity, suffix: '/reports' },
    { href: `${activePrefix}/settings`, label: 'Settings', icon: Settings2, suffix: '/settings' },
  ] : [{ href: '/servers', label: 'Servers', icon: LayoutDashboard, suffix: '' }];
  return <>
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={closeMobile} />}
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <div className="sidebar-top"><Link href="/servers" className="brand-link" onClick={closeMobile}><Brand /></Link>
        <button className="icon-button mobile-close" aria-label="Close navigation" onClick={closeMobile}><X size={18} /></button></div>
      <div className="workspace-label">WORKSPACE</div>
      {guild ? <Link className="active-server" href={`/server/${guild.id}`} onClick={closeMobile}>
        <Avatar src={guild.iconUrl} name={guild.name} size="sm" /><span className="active-server-name">{guild.name}</span><ChevronDown size={14} />
      </Link> : <Link className="server-switcher" href="/servers" onClick={closeMobile}><span className="switcher-icon"><Command size={15} /></span><span>Choose a server</span><ChevronDown size={14} /></Link>}
      <div className="nav-label">CONTROL</div>
      <nav className="main-nav" aria-label="Main navigation">
        {items.map(({ href, label, icon: Icon, suffix }) => {
          const active = suffix ? location.endsWith(suffix) : location === '/servers' || location === activePrefix || location === `${activePrefix}/`;
          return <Link key={label} href={href} className={`nav-link ${active ? 'nav-active' : ''}`} onClick={closeMobile} data-testid={`link-nav-${label.toLowerCase()}`}>
            <Icon size={17} strokeWidth={1.8} /><span>{label}</span>{active && <span className="nav-current" />}
          </Link>;
        })}
      </nav>
      <div className="sidebar-bottom">
        <div className="health-indicator"><span className={`health-dot ${health === 'ok' ? 'health-good' : ''}`} /><div><strong>System status</strong><small>{health === 'ok' ? 'All systems operational' : health || 'Checking status'}</small></div></div>
        <div className="sidebar-footnote"><span>VAMPIRE DASHBOARD</span><span>PRIVATE ACCESS</span></div>
      </div>
    </aside>
  </>;
}

type SessionUser = { username: string; displayName: string | null; avatarUrl: string | null } | null;
function Topbar({ user, onLogout, loggingOut }: { user: SessionUser; onLogout: () => void; loggingOut: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const name = user?.displayName || user?.username || 'Discord user';
  return <>
    <div className="topbar">
      <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={19} /></button>
      <div className="breadcrumb"><span>VAMPIRE</span><ChevronLeft size={14} /><strong>Control room</strong></div>
      <div className="topbar-actions">
        <span className="topbar-secure"><span className="pulse-dot" /> SECURE SESSION</span>
        <button className="user-menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} data-testid="button-user-menu">
          <Avatar src={user?.avatarUrl} name={name} size="sm" /><span className="user-menu-name">{name}</span><ChevronDown size={14} />
        </button>
        {menuOpen && <div className="user-dropdown">
          <div className="dropdown-profile"><Avatar src={user?.avatarUrl} name={name} /><span><strong>{name}</strong><small>@{user?.username || 'discord'}</small></span></div>
          <button onClick={onLogout} disabled={loggingOut} className="dropdown-action" data-testid="button-logout"><LogOut size={16} />{loggingOut ? 'Signing out…' : 'Sign out'}</button>
        </div>}
      </div>
    </div>
    <SidebarMobileToggle open={mobileOpen} onClose={() => setMobileOpen(false)} />
  </>;
}

function SidebarMobileToggle({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [location] = useLocation();
  const id = location.match(/^\/server\/([^/]+)/)?.[1];
  const { data: guilds } = useListManagedGuilds({ query: { enabled: !!id, queryKey: getListManagedGuildsQueryKey() } });
  const guild = guilds?.guilds.find((item) => item.id === id);
  return open ? <div className="mobile-sidebar-layer"><Sidebar guild={guild} mobileOpen={open} closeMobile={onClose} /></div> : null;
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action && <div className="heading-action">{action}</div>}</div>;
}

function ServerCard({ guild }: { guild: Guild }) {
  const isInstalled = guild.botStatus === 'installed';
  const notInstalled = guild.botStatus === 'not_installed';
  const href = isInstalled ? `/server/${guild.id}` : guild.inviteUrl || undefined;
  return <article className="server-card" data-testid={`card-server-${guild.id}`}>
    <div className="server-card-top"><Avatar src={guild.iconUrl} name={guild.name} size="lg" /><StatusPill status={guild.botStatus} /></div>
    <div className="server-card-info"><h2>{guild.name}</h2><p><ShieldCheck size={14} />{guild.permissionLabel}</p></div>
    {isInstalled ? <Link href={href!} className="button button-primary card-button" data-testid={`link-manage-server-${guild.id}`}>Manage server<ArrowRight size={16} /></Link>
      : notInstalled && href ? <a href={href} target="_blank" rel="noreferrer" className="button button-secondary card-button" data-testid={`link-add-vampire-${guild.id}`}>Add Vampire<ExternalLink size={15} /></a>
      : notInstalled ? <button className="button button-secondary card-button" disabled data-testid={`button-add-unavailable-${guild.id}`}>Invite unavailable</button>
      : <div className="verification-note"><CircleHelp size={15} />Installation status cannot be verified</div>}
  </article>;
}

function ServerPicker() {
  const { data, isLoading, isError, error, refetch } = useListManagedGuilds();
  const [search, setSearch] = useState('');
  const guilds = useMemo(() => (data?.guilds || []).filter((guild) => guild.name.toLowerCase().includes(search.toLowerCase())), [data?.guilds, search]);
  if (isLoading) return <main className="content-wrap"><PageHeader eyebrow="SERVER ACCESS" title="Your servers" description="Choose a Discord server you manage." /><LoadState label="Finding your managed servers" /></main>;
  if (isError) return <main className="content-wrap"><PageHeader eyebrow="SERVER ACCESS" title="Your servers" description="Choose a Discord server you manage." /><ErrorState message={(error as Error)?.message} retry={() => { void refetch(); }} /></main>;
  return <main className="content-wrap">
    <PageHeader eyebrow="SERVER ACCESS" title="Your servers" description="Choose a Discord server you manage." />
    <div className="picker-toolbar"><div className="toolbar-copy"><span className="tiny-count">{data?.guilds.length ?? 0}</span><span>servers available to your account</span></div>
      <label className="search-control"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a server" aria-label="Search servers" data-testid="input-search-servers" />{search && <button type="button" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}</label>
    </div>
    {data?.integrationConfigured === false && <div className="notice notice-violet"><CircleHelp size={17} /><span>Activity integration is not configured. Server access remains available; staff and reports require the configured data integration.</span></div>}
    {guilds.length ? <div className="server-grid">{guilds.map((guild) => <ServerCard key={guild.id} guild={guild} />)}</div>
      : <EmptyState title={search ? 'No matching servers' : 'No managed servers found'} description={search ? 'Try another server name.' : 'No Discord servers you can manage are available to this account.'} icon={search ? Search : ShieldPlus} />}
  </main>;
}

function ServerLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const id = location.match(/^\/server\/([^/]+)/)?.[1];
  const { data: dashboard } = useGetGuildDashboard(id || '', { query: { enabled: !!id, queryKey: getGetGuildDashboardQueryKey(id || '') } });
  const { data: list } = useListManagedGuilds();
  const guild = dashboard?.guild || list?.guilds.find((item) => item.id === id);
  return <div className="app-shell"><Sidebar guild={guild} mobileOpen={false} closeMobile={() => {}} /><section className="main-column">{children}</section></div>;
}

function OverviewPage() {
  const { guildId = '' } = useParams<{ guildId: string }>();
  const { data, isLoading, isError, error, refetch } = useGetGuildDashboard(guildId);
  if (isLoading) return <main className="content-wrap"><LoadState /></main>;
  if (isError || !data) return <main className="content-wrap"><ErrorState message={(error as Error)?.message} retry={() => { void refetch(); }} /></main>;
  const guild = data.guild;
  const base = `/server/${guildId}`;
  return <main className="content-wrap">
    <div className="server-hero">
      <div className="server-hero-image"><Avatar src={guild.iconUrl} name={guild.name} size="lg" /></div>
      <div className="server-hero-copy"><div className="eyebrow">SERVER OVERVIEW</div><h1>{guild.name}</h1><div className="server-meta"><StatusPill status={guild.botStatus} /><span className="permission-label"><ShieldCheck size={14} />{guild.permissionLabel}</span></div></div>
      <div className="hero-actions">{guild.botStatus === 'installed' ? <span className="hero-ready"><Check size={15} />Ready to manage</span>
        : guild.botStatus === 'not_installed' && guild.inviteUrl ? <a href={guild.inviteUrl} target="_blank" rel="noreferrer" className="button button-primary" data-testid="link-add-vampire-overview">Add Vampire<ExternalLink size={15} /></a>
          : guild.botStatus === 'unknown' ? <span className="hero-ready hero-unknown"><CircleHelp size={15} />Installation status cannot be verified</span> : <span className="hero-ready hero-unknown">Invite link unavailable</span>}</div>
    </div>
    {data.integrationAvailable ? <section className="overview-layout">
      <div className="overview-main">
        <div className="section-heading"><div><span className="eyebrow">COMMAND CENTER</span><h2>Server management</h2></div><span className="section-stamp"><ShieldCheck size={14} />AUTHORIZED SERVER</span></div>
        <div className="management-list">
          <Link href={`${base}/staff`} className="management-row" data-testid="link-overview-staff">
            <span className="management-icon icon-mint"><Users size={18} /></span><span className="management-copy"><strong>Staff management</strong><small>Review your server's staff roster and access</small></span><span className="management-arrow"><ArrowRight size={17} /></span>
          </Link>
          <Link href={`${base}/reports`} className="management-row" data-testid="link-overview-reports">
            <span className="management-icon icon-violet"><Activity size={18} /></span><span className="management-copy"><strong>Staff activity</strong><small>Explore real activity over a selected period</small></span><span className="management-arrow"><ArrowRight size={17} /></span>
          </Link>
          <Link href={`${base}/settings`} className="management-row" data-testid="link-overview-settings">
            <span className="management-icon icon-yellow"><SlidersHorizontal size={18} /></span><span className="management-copy"><strong>Server settings</strong><small>Configure reporting and staff integration</small></span><span className="management-arrow"><ArrowRight size={17} /></span>
          </Link>
        </div>
      </div>
      <aside className="overview-aside">
        <div className="aside-card"><span className="aside-card-mark"><ShieldCheck size={16} /></span><span className="eyebrow">ACCESS VERIFIED</span><h3>Connected to Discord</h3><p>You're viewing this server with the permissions shown below.</p><div className="access-detail"><span>Discord permission</span><strong>{guild.permissionLabel}</strong></div><div className="access-detail"><span>Server ID</span><strong className="mono-text">{guild.id}</strong></div></div>
        <div className="integration-card"><div className="integration-card-title"><span className={`health-dot ${data.integrationAvailable ? 'health-good' : ''}`} /><strong>{data.integrationAvailable ? 'Data integration connected' : 'Data integration unavailable'}</strong></div><p>{data.integrationMessage}</p></div>
      </aside>
    </section> : <div className="integration-empty">
      <div className="integration-empty-visual"><span><Activity size={24} /></span></div><div><div className="eyebrow">INTEGRATION NEEDED</div><h2>Staff data is not available</h2><p>{data.integrationMessage || 'Staff management and reporting are unavailable because the server data integration is not available.'}</p></div>
      <div className="integration-links"><Link href={`${base}/staff`} className="button button-secondary">Staff management<ArrowRight size={15} /></Link><Link href={`${base}/reports`} className="button button-secondary">Reports<ArrowRight size={15} /></Link></div>
    </div>}
  </main>;
}

function StaffPage() {
  const { guildId = '' } = useParams<{ guildId: string }>();
  const { data: dashboard, isLoading: dashboardLoading, isError: dashboardError, refetch: retryDashboard } = useGetGuildDashboard(guildId);
  const listStaff = useListGuildStaff();
  const updateStaff = useUpdateGuildStaff();
  const [search, setSearch] = useState('');
  const [requested, setRequested] = useState(false);
  const [confirmUser, setConfirmUser] = useState<StaffMember | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (dashboard?.integrationAvailable && !requested) {
      setRequested(true);
      listStaff.mutate({ guildId, data: { search: '' } });
    }
  }, [dashboard?.integrationAvailable, guildId, requested]);
  const response = listStaff.data;
  const runSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    listStaff.mutate({ guildId, data: { search: search.trim() } });
  };
  const revoke = () => {
    if (!confirmUser) return;
    updateStaff.mutate({ guildId, userId: confirmUser.discordUserId, data: { action: 'revoke' } }, {
      onSuccess: (result) => {
        setMessage(result.message);
        setConfirmUser(null);
        listStaff.mutate({ guildId, data: { search: search.trim() } });
      },
      onError: (error) => setMessage((error as Error).message || 'Staff access could not be updated.'),
    });
  };
  if (dashboardLoading) return <main className="content-wrap"><LoadState label="Loading server access" /></main>;
  if (dashboardError || !dashboard) return <main className="content-wrap"><ErrorState retry={() => { void retryDashboard(); }} /></main>;
  const base = `/server/${guildId}`;
  return <main className="content-wrap">
    <div className="back-link-row"><Link href={base} className="back-link"><ArrowLeft size={15} />{dashboard.guild.name}</Link><span className="crumb-slash">/</span><span>Staff</span></div>
    <PageHeader eyebrow="ACCESS CONTROL" title="Staff management" description="Review staff access provided by your server integration." action={<span className="section-stamp"><ShieldCheck size={14} />{dashboard.guild.permissionLabel}</span>} />
    {!dashboard.integrationAvailable ? <div className="integration-empty staff-unavailable">
      <div className="integration-empty-visual"><span><Users size={23} /></span></div><div><div className="eyebrow">NO STAFF DATA</div><h2>Staff management is unavailable</h2><p>{dashboard.integrationMessage || 'This server does not have an available staff data integration. No roster or activity is being shown.'}</p></div>
      <Link href={`${base}/settings`} className="button button-secondary">Review server settings<ArrowRight size={15} /></Link>
    </div> : <>
      <form className="staff-toolbar" onSubmit={runSearch}>
        <label className="search-control staff-search"><Search size={16} /><input value={search} maxLength={80} onChange={(event) => setSearch(event.target.value)} placeholder="Search staff by name" aria-label="Search staff" data-testid="input-search-staff" />{search && <button type="button" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}</label>
        <button className="button button-primary" type="submit" disabled={listStaff.isPending} data-testid="button-search-staff"><Search size={15} />{listStaff.isPending ? 'Searching…' : 'Search staff'}</button>
      </form>
      {message && <div className="notice notice-violet" role="status">{message}</div>}
      {listStaff.isError ? <ErrorState message={(listStaff.error as Error)?.message} retry={() => listStaff.mutate({ guildId, data: { search: search.trim() } })} />
        : listStaff.isPending && !response ? <LoadState label="Loading staff records" />
          : response?.available === false ? <div className="notice notice-violet"><CircleHelp size={17} /><span>{response.message || 'Staff data is not available for this server.'}</span></div>
            : response?.available && response.staff.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>STAFF MEMBER</th><th>ACCESS</th><th>MESSAGES</th><th>TIMEOUTS</th><th>BANS</th><th>CLAIMS</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{response.staff.map((member) => <tr key={member.discordUserId} data-testid={`row-staff-${member.discordUserId}`}>
                <td data-label="Staff member"><div className="table-person"><Avatar src={member.avatarUrl} name={member.displayName || member.username} size="sm" /><span><strong>{member.displayName || member.username}</strong><small>@{member.username}</small></span></div></td>
                <td data-label="Access"><span className="role-label">{member.roleLabel}</span></td><td data-label="Messages">{member.messages.toLocaleString()}</td><td data-label="Timeouts">{member.timeouts.toLocaleString()}</td><td data-label="Bans">{member.bans.toLocaleString()}</td><td data-label="Claims">{member.claims.toLocaleString()}</td>
                <td data-label="Actions"><button className="text-action" onClick={() => setConfirmUser(member)} data-testid={`button-revoke-${member.discordUserId}`}>Revoke access</button></td>
              </tr>)}</tbody></table></div>
              : response && <EmptyState title="No staff matched" description={search ? 'Try a different search term.' : 'The integration returned no staff records for this server.'} icon={Users} />}
    </>}
    {confirmUser && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmUser(null); }}>
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="revoke-heading">
        <span className="state-icon state-icon-danger"><ShieldAlert size={20} /></span><button className="dialog-close" onClick={() => setConfirmUser(null)} aria-label="Close"><X size={17} /></button>
        <h2 id="revoke-heading">Revoke staff access?</h2><p>This will ask the connected server integration to remove access for <strong>{confirmUser.displayName || confirmUser.username}</strong>.</p>
        {updateStaff.isError && <div className="notice notice-warn dialog-notice"><ShieldAlert size={15} />{(updateStaff.error as Error)?.message || 'Staff access could not be updated.'}</div>}
        <div className="dialog-actions"><button className="button button-secondary" onClick={() => setConfirmUser(null)}>Cancel</button><button className="button button-danger" disabled={updateStaff.isPending} onClick={revoke} data-testid="button-confirm-revoke">{updateStaff.isPending ? 'Revoking…' : 'Revoke access'}</button></div>
      </div>
    </div>}
  </main>;
}

function ReportsPage() {
  const { guildId = '' } = useParams<{ guildId: string }>();
  const { data: dashboard, isLoading: dashboardLoading, isError: dashboardError, refetch: retryDashboard } = useGetGuildDashboard(guildId);
  const reports = useGetGuildReports();
  const [from, setFrom] = useState(() => dateOffset(30));
  const [to, setTo] = useState(() => dateOffset(0));
  const [sort, setSort] = useState<'messages' | 'timeouts' | 'bans' | 'claims'>('messages');
  const [requested, setRequested] = useState(false);
  useEffect(() => {
    if (dashboard?.integrationAvailable && !requested) {
      setRequested(true);
      const initialFrom = dateOffset(dashboard.settings.reportRangeDays);
      const initialTo = dateOffset(0);
      setFrom(initialFrom);
      setTo(initialTo);
      reports.mutate({ guildId, data: { from: initialFrom, to: initialTo, sort } });
    }
  }, [dashboard?.integrationAvailable, requested, guildId]);
  const queryReport = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (from > to) return;
    reports.mutate({ guildId, data: { from, to, sort } });
  };
  if (dashboardLoading) return <main className="content-wrap"><LoadState label="Loading server access" /></main>;
  if (dashboardError || !dashboard) return <main className="content-wrap"><ErrorState retry={() => { void retryDashboard(); }} /></main>;
  const response = reports.data;
  const base = `/server/${guildId}`;
  return <main className="content-wrap">
    <div className="back-link-row"><Link href={base} className="back-link"><ArrowLeft size={15} />{dashboard.guild.name}</Link><span className="crumb-slash">/</span><span>Reports</span></div>
    <PageHeader eyebrow="SERVER INTELLIGENCE" title="Staff activity" description="A clear view of activity returned by your server integration." />
    {!dashboard.integrationAvailable ? <div className="integration-empty">
      <div className="integration-empty-visual"><span><Activity size={23} /></span></div><div><div className="eyebrow">NO REPORT DATA</div><h2>Reports are unavailable</h2><p>{dashboard.integrationMessage || 'This server does not have an available reporting integration. No metrics or staff activity are being shown.'}</p></div>
      <Link href={`${base}/settings`} className="button button-secondary">Review server settings<ArrowRight size={15} /></Link>
    </div> : <>
      <form className="report-toolbar" onSubmit={queryReport}>
        <div className="date-control"><CalendarDays size={16} /><label>From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} data-testid="input-report-from" /></label></div>
        <div className="date-control"><CalendarDays size={16} /><label>To<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} data-testid="input-report-to" /></label></div>
        <label className="sort-control"><ArrowUpDown size={15} /><span>Sort by</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} data-testid="select-report-sort">
          <option value="messages">Messages</option><option value="timeouts">Timeouts</option><option value="bans">Bans</option><option value="claims">Claims</option>
        </select><ChevronDown size={14} /></label>
        <button className="button button-primary" type="submit" disabled={reports.isPending || from > to} data-testid="button-run-report">{reports.isPending ? 'Updating…' : 'Apply range'}</button>
      </form>
      {from > to && <div className="field-error">The start date must be before the end date.</div>}
      {reports.isError ? <ErrorState message={(reports.error as Error)?.message} retry={() => reports.mutate({ guildId, data: { from, to, sort } })} />
        : reports.isPending && !response ? <LoadState label="Preparing activity report" />
          : response?.available === false ? <div className="notice notice-violet"><CircleHelp size={17} /><span>{response.message || 'Reports are not available for this server.'}</span></div>
            : response?.available && response.totals ? <>
              <div className="report-period"><span className="period-marker" />REPORT PERIOD <strong>{formatDate(response.from)} — {formatDate(response.to)}</strong><span className="period-note">Real data from your integration</span></div>
              <div className="metric-strip">
                <Metric label="Messages" value={response.totals.messages} tone="mint" icon={Activity} />
                <Metric label="Timeouts" value={response.totals.timeouts} tone="violet" icon={Clock3} />
                <Metric label="Mutes" value={response.totals.mutes} tone="yellow" icon={Shield} />
                <Metric label="Bans" value={response.totals.bans} tone="violet" icon={ShieldAlert} />
                <Metric label="Claims" value={response.totals.claims} tone="mint" icon={ShieldCheck} />
              </div>
              <div className="report-table-heading"><div><span className="eyebrow">STAFF BREAKDOWN</span><h2>Activity by member</h2></div><span className="sort-context">Ordered by {sort}</span></div>
              {response.staff.length ? <div className="data-table-wrap"><table className="data-table report-table"><thead><tr><th>STAFF MEMBER</th><th>ROLE</th><th>MESSAGES</th><th>TIMEOUTS</th><th>BANS</th><th>CLAIMS</th></tr></thead>
                <tbody>{response.staff.map((member) => <tr key={member.discordUserId} data-testid={`row-report-${member.discordUserId}`}><td data-label="Staff member"><div className="table-person"><Avatar src={member.avatarUrl} name={member.displayName || member.username} size="sm" /><span><strong>{member.displayName || member.username}</strong><small>@{member.username}</small></span></div></td><td data-label="Role"><span className="role-label">{member.roleLabel}</span></td><td data-label="Messages">{member.messages.toLocaleString()}</td><td data-label="Timeouts">{member.timeouts.toLocaleString()}</td><td data-label="Bans">{member.bans.toLocaleString()}</td><td data-label="Claims">{member.claims.toLocaleString()}</td></tr>)}</tbody></table></div>
                : <EmptyState title="No activity in this period" description="The integration returned no staff activity for the selected dates." icon={Activity} />}
            </> : response && <EmptyState title="No report totals returned" description={response.message || 'No report data was returned for the selected date range.'} icon={Activity} />}
    </>}
  </main>;
}

function Metric({ label, value, tone, icon: Icon }: { label: string; value: number; tone: string; icon: typeof Activity }) {
  return <div className="metric-item" data-testid={`metric-${label.toLowerCase()}`}><span className={`metric-icon metric-${tone}`}><Icon size={17} /></span><span className="metric-label">{label}</span><strong>{value.toLocaleString()}</strong></div>;
}

function SettingsPage() {
  const { guildId = '' } = useParams<{ guildId: string }>();
  const { data: dashboard, isLoading: dashboardLoading, isError: dashboardError, refetch: retryDashboard } = useGetGuildDashboard(guildId);
  const settingsQuery = useGetGuildSettings(guildId);
  const updateSettings = useUpdateGuildSettings();
  const [staffRoleId, setStaffRoleId] = useState('');
  const [timezone, setTimezone] = useState('');
  const [rangeDays, setRangeDays] = useState<'7' | '14' | '30'>('30');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (settingsQuery.data) {
      setStaffRoleId(settingsQuery.data.staffRoleId || '');
      setTimezone(settingsQuery.data.timezone);
      setRangeDays(String(settingsQuery.data.reportRangeDays) as '7' | '14' | '30');
    }
  }, [settingsQuery.data]);
  const submitSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice('');
    updateSettings.mutate({ guildId, data: { staffRoleId: staffRoleId.trim() || null, timezone: timezone.trim(), reportRangeDays: Number(rangeDays) as 7 | 14 | 30 } }, {
      onSuccess: (result) => {
        queryClient.setQueryData(getGetGuildSettingsQueryKey(guildId), result);
        queryClient.setQueryData(getGetGuildDashboardQueryKey(guildId), (old: typeof dashboard) => old ? { ...old, settings: result } : old);
        setNotice('Settings saved successfully.');
      },
      onError: (error) => setNotice((error as Error).message || 'Settings could not be saved.'),
    });
  };
  if (dashboardLoading || settingsQuery.isLoading) return <main className="content-wrap"><LoadState label="Loading server settings" /></main>;
  if (dashboardError || settingsQuery.isError || !dashboard || !settingsQuery.data) return <main className="content-wrap"><ErrorState message={(settingsQuery.error as Error)?.message} retry={() => { void retryDashboard(); void settingsQuery.refetch(); }} /></main>;
  const roleValid = !staffRoleId.trim() || /^[0-9]{17,20}$/.test(staffRoleId.trim());
  const dirty = staffRoleId !== (settingsQuery.data.staffRoleId || '') || timezone !== settingsQuery.data.timezone || Number(rangeDays) !== settingsQuery.data.reportRangeDays;
  return <main className="content-wrap">
    <div className="back-link-row"><Link href={`/server/${guildId}`} className="back-link"><ArrowLeft size={15} />{dashboard.guild.name}</Link><span className="crumb-slash">/</span><span>Settings</span></div>
    <PageHeader eyebrow="SERVER CONFIGURATION" title="Settings" description="Configure the reporting preferences for this Discord server." />
    <form className="settings-form" onSubmit={submitSettings}>
      {!dashboard.integrationAvailable && <div className="notice notice-violet settings-integration-note"><CircleHelp size={17} /><span>{dashboard.integrationMessage || 'Staff data integration is unavailable. Staff management and reports will remain empty until data is provided.'}</span></div>}
      <section className="settings-section"><div className="settings-section-heading"><span className="settings-section-icon icon-yellow"><SlidersHorizontal size={18} /></span><div><h2>Reporting preferences</h2><p>These preferences apply only to {dashboard.guild.name}.</p></div></div>
        <div className="settings-fields">
          <label className="form-field"><span>Staff role ID <small>OPTIONAL</small></span><input value={staffRoleId} onChange={(event) => setStaffRoleId(event.target.value)} placeholder="Paste a Discord role ID" inputMode="numeric" aria-invalid={!roleValid} data-testid="input-staff-role-id" /><small className="field-hint">Leave blank to use the integration's default staff role.</small>{!roleValid && <small className="field-error">Enter a valid Discord role ID (17–20 digits).</small>}</label>
          <label className="form-field"><span>Timezone</span><input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="e.g. Europe/London" maxLength={80} required data-testid="input-timezone" /><small className="field-hint">Use an IANA timezone name for report dates.</small></label>
          <label className="form-field"><span>Default report range</span><span className="select-wrap"><select value={rangeDays} onChange={(event) => setRangeDays(event.target.value as typeof rangeDays)} data-testid="select-report-range"><option value="7">Last 7 days</option><option value="14">Last 14 days</option><option value="30">Last 30 days</option></select><ChevronDown size={15} /></span><small className="field-hint">Used as the initial range when opening staff activity.</small></label>
        </div>
      </section>
      <section className="settings-section settings-access"><div className="settings-section-heading"><span className="settings-section-icon icon-violet"><ShieldCheck size={18} /></span><div><h2>Server access</h2><p>Authorization comes from Discord and is checked for each request.</p></div></div>
        <div className="access-detail"><span>Authorized as</span><strong>{dashboard.guild.permissionLabel}</strong></div><div className="access-detail"><span>Server</span><strong>{dashboard.guild.name}</strong></div>
      </section>
      {notice && <div className={`notice ${notice.includes('successfully') ? 'notice-success' : 'notice-warn'}`} role="status">{notice.includes('successfully') ? <Check size={16} /> : <ShieldAlert size={16} />}{notice}</div>}
      <div className="settings-savebar"><span>{settingsQuery.data.updatedAt ? `Last saved ${formatDateTime(settingsQuery.data.updatedAt)}` : 'Changes are saved for this server only.'}</span><button className="button button-primary" disabled={!dirty || !roleValid || !timezone.trim() || updateSettings.isPending} data-testid="button-save-settings"><Check size={16} />{updateSettings.isPending ? 'Saving…' : 'Save changes'}</button></div>
    </form>
  </main>;
}

function dateOffset(daysAgo: number) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function AuthenticatedApp() {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const session = useGetAuthSession();
  const health = useHealthCheck();
  const logout = useLogout();
  const authenticated = !!session.data?.authenticated && !!session.data.user;
  const onLogout = () => logout.mutate(undefined, {
    onSuccess: () => {
      queryClient.clear();
      setLocation('/');
    },
  });
  if (location === '/' || location.startsWith('/?')) {
    if (authenticated) {
      return <div className="app-shell"><Sidebar health={health.data?.status} mobileOpen={false} closeMobile={() => {}} /><section className="main-column"><Topbar user={session.data?.user || null} onLogout={onLogout} loggingOut={logout.isPending} /><ServerPicker /></section></div>;
    }
    return <LoginPage authLoading={session.isLoading} authError={session.isError} />;
  }
  if (!authenticated) return <LoginPage authLoading={session.isLoading} authError={session.isError} />;
  return <div className="app-shell">
    <SidebarForLocation health={health.data?.status} />
    <section className="main-column"><Topbar user={session.data?.user || null} onLogout={onLogout} loggingOut={logout.isPending} />
      <RoutedErrorBoundary resetKey={location}><Switch>
        <Route path="/servers"><ServerPicker /></Route>
        <Route path="/server/:guildId"><OverviewPage /></Route>
        <Route path="/server/:guildId/staff"><StaffPage /></Route>
        <Route path="/server/:guildId/reports"><ReportsPage /></Route>
        <Route path="/server/:guildId/settings"><SettingsPage /></Route>
        <Route component={NotFoundPage} />
      </Switch></RoutedErrorBoundary>
    </section>
  </div>;
}

function SidebarForLocation({ health }: { health?: string }) {
  const [location] = useLocation();
  const id = location.match(/^\/server\/([^/]+)/)?.[1];
  const { data: dashboard } = useGetGuildDashboard(id || '', { query: { enabled: !!id, queryKey: getGetGuildDashboardQueryKey(id || '') } });
  const { data: guildList } = useListManagedGuilds();
  const guild = dashboard?.guild || guildList?.guilds.find((item) => item.id === id);
  return <Sidebar guild={guild} health={health} mobileOpen={false} closeMobile={() => {}} />;
}

function RoutedErrorBoundary({ children, resetKey }: { children: ReactNode; resetKey: string }) {
  return <ErrorBoundary resetKey={resetKey}>{children}</ErrorBoundary>;
}

function NotFoundPage() {
  return <main className="content-wrap"><div className="state-panel not-found"><span className="eyebrow">404 / NOT FOUND</span><h1>This route is not available.</h1><p>Choose an authorized server or return to your server overview.</p><Link href="/servers" className="button button-primary">Back to servers<ArrowRight size={16} /></Link></div></main>;
}

function Router() {
  return <AuthenticatedApp />;
}

function App() {
  return <QueryClientProvider client={queryClient}>
    <TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider>
  </QueryClientProvider>;
}

export default App;
