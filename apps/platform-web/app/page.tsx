const projects = [
  ['PIMS', 'Project information management'],
  ['Sales', 'Sales management'],
  ['Broker', 'Broker operations'],
  ['Snagging', 'Snagging and defect tracking'],
  ['LeMS', 'Leasing management'],
  ['CAFM', 'Facilities and maintenance'],
  ['OA', 'Owners association and community operations'],
  ['Finance', 'Finance and financial workflows'],
  ['Support', 'Support and service operations'],
];

export default function Home() {
  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">REALCUBE · ENTERPRISE WORKSPACE</p>
        <h1>Enterprise Platform</h1>
        <p className="lede">Central administration for tenants, users, project access, roles, permissions and audit.</p>
        <p className="notice">Phase 1 scaffold: authentication and API-backed administration are not configured. Do not use this UI for production access decisions.</p>
      </header>
      <section>
        <div className="section-heading"><h2>Project registry preview</h2><p>9 independently managed business projects</p></div>
        <div className="grid">
          {projects.map(([name, description]) => (
            <article className="project-card" key={name}>
              <span className="project-mark">{name.slice(0, 1)}</span>
              <h3>{name}</h3><p>{description}</p><span className="status">Placeholder</span>
            </article>
          ))}
        </div>
      </section>
      <footer>Enterprise Platform · Initial scaffold · Not production-ready</footer>
    </main>
  );
}
