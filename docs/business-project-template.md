# Business Project Template

Apply these conventions to PIMS, Sales, Broker, Snagging, LeMS, CAFM, OA, Finance and Support.

Each project has a Next.js frontend, modular NestJS API, one owned PostgreSQL database, independent migrations, Docker images and CI/CD, local OIDC token validation, project/tenant authorization and operational dashboards.

Do not directly query another project's database. Use versioned APIs or documented asynchronous events. Keep shared code in versioned libraries, not a shared runtime dependency for every business request.
