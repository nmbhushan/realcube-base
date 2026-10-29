const workspaces = [
  { title: 'Project Overview', detail: 'Project status, milestones and key indicators', icon: '01' },
  { title: 'Work Items', detail: 'Track actions, issues and project follow-ups', icon: '02' },
  { title: 'Documents', detail: 'Project files and controlled document records', icon: '03' },
  { title: 'Reports', detail: 'Progress summaries and project performance', icon: '04' },
];

export default function HomePage() {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">R</span><span>RealCube <b>PIMS</b></span></div>
        <div className="nav-label">WORKSPACE</div>
        <a className="nav-item active" href="#overview">Overview</a>
        <a className="nav-item" href="#work-items">Work items</a>
        <a className="nav-item" href="#documents">Documents</a>
        <a className="nav-item" href="#reports">Reports</a>
        <div className="sidebar-footer"><span className="status-dot" /> Pilot environment<br /><small>Identity integration pending</small></div>
      </aside>
      <section className="main">
        <header className="topbar"><div><span className="eyebrow">PROJECT INFORMATION MANAGEMENT</span><h1>Project workspace</h1></div><span className="environment">PILOT FOUNDATION</span></header>
        <section className="welcome" id="overview">
          <div><span className="eyebrow light">REALCUBE PROJECT SUITE</span><h2>Bring every project detail<br />into one clear view.</h2><p>A focused workspace for project delivery, records and progress visibility.</p></div>
          <div className="welcome-art" aria-hidden="true"><div className="art-card card-back" /><div className="art-card card-front"><span>PROJECT</span><strong>Delivery plan</strong><i /><i /><i /></div><div className="art-orbit" /></div>
        </section>
        <div className="section-heading"><div><span className="eyebrow">YOUR WORKSPACE</span><h2>Project tools</h2></div><span className="muted">Pilot UI scaffold</span></div>
        <div className="workspace-grid">
          {workspaces.map((item) => <article className="workspace-card" key={item.title} id={item.title.toLowerCase().replaceAll(' ', '-')}>
            <span className="card-icon">{item.icon}</span><h3>{item.title}</h3><p>{item.detail}</p><span className="card-link">Foundation view <span aria-hidden="true">↗</span></span>
          </article>)}
        </div>
        <section className="notice"><span className="notice-icon">i</span><div><strong>Secure access is being connected</strong><p>This UI foundation does not simulate sign-in or authorization. Live project data stays disabled until Platform entitlement checks, OIDC session handling and tenant-isolation tests pass.</p></div></section>
        <footer>RealCube PIMS · Independent frontend foundation</footer>
      </section>
    </main>
  );
}
