# Frontend

The Dinsight dashboard — Next.js 15 (App Router), TypeScript, Tailwind, React Query, Plotly. Talks to the Go API at `:8080`.

For project-wide setup, prerequisites, and architecture, see the [root README](../README.md). For the design system, see [`docs/design-system.md`](../docs/design-system.md).

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

The dev server uses Turbopack. The BE must be running on `:8080` (or set `NEXT_PUBLIC_API_URL`).

For the containerized full stack (FE + BE + Postgres + reverse proxy in one `docker compose up`), see [`../deploy/vm-test/`](../deploy/vm-test/README.md).

## Scripts

```bash
pnpm dev              # dev server (Turbopack)
pnpm build            # production build
pnpm start            # serve production build
pnpm lint             # next lint
pnpm lint:fix         # next lint --fix
pnpm type-check       # tsc --noEmit
pnpm format           # prettier --write
pnpm format:check     # prettier --check
pnpm test             # vitest run
pnpm test:watch       # vitest (watch mode)
pnpm test:coverage    # vitest run --coverage
pnpm test:e2e         # playwright test
pnpm test:e2e:ui      # playwright test --ui
pnpm test:all         # lint + type-check + unit + e2e
```

## Source layout

```
src/
├── app/                  # Next.js App Router pages + layouts
│   ├── dashboard/        # Authenticated app (5 main sections)
│   │   ├── account/      # Profile, security, license, alerts, audit, validation
│   │   ├── data/         # Catalog + ingestion
│   │   ├── insights/     # Wear-trend analysis
│   │   ├── live/         # Live monitor with streaming polling
│   │   └── page.tsx      # Machine status overview
│   ├── login/            # Password + SSO entry
│   ├── register/
│   ├── forgot-password/
│   ├── reset-password/
│   └── verify-email/
├── components/
│   ├── alerts/           # Active alerts feed + rules CRUD
│   ├── audit/            # Audit log viewer (admin-only)
│   ├── auth/             # RequirePermission, route guards
│   ├── charts/           # Plotly wrappers
│   ├── datasets/         # Catalog tables + validation rules panel
│   ├── layout/           # Sidebar, header, dashboard shell, org switcher
│   └── ui/               # Primitives (Button, Input, Table, Badge, Alert, ...)
├── context/              # AuthContext (currentOrg, role, login/logout)
├── hooks/                # useDashboardOverview, useUploadWorkflow, prefs hooks, ...
├── lib/                  # api-client, permissions, navigation config, normalizers
├── types/                # TypeScript types (User, OrgRole, MetadataEntry, ...)
└── utils/                # cn(), formatters, metadata helpers
```

## Conventions

- **Permissions** — gate UI on `usePermission(Actions.X)` from `@/components/auth/require-permission`. The vocabulary mirrors `Dinsight_API_Enhanced/internal/policy/policy.go`. The BE is authoritative; the FE is cosmetic.
- **API calls** — go through `@/lib/api-client`. The axios instance stamps `Authorization: Bearer …` and `X-Org-ID` from the `current_org_id` cookie.
- **Active org** — `useAuth().currentOrg` and `currentOrgRole`. `setCurrentOrg(id)` updates the cookie and re-renders.
- **Tokens for design** — use the semantic Tailwind tokens (`bg-surface`, `text-fg`, `border-strong`, `text-success-text`, `bg-warning-bg`, `border-focus`, etc.) — never raw `text-gray-900` / `bg-blue-500`. See [design system §4 + §5](../docs/design-system.md).
- **Component states** — every primitive ships the seven-state model from [design system §11.5](../docs/design-system.md): default, hover, focus, active, disabled, loading, error.

## Testing

- **Unit + component** — Vitest + Testing Library. Run with `pnpm test`. Setup at `src/test/setup.ts`. MSW handlers at `src/test/server.ts`.
- **E2E** — Playwright. Run with `pnpm test:e2e`. Auth fixtures regenerate via `e2e/auth.setup.ts`. Specs in `e2e/`.
- **IA regression** — `src/lib/__tests__/ia-regression.test.ts` asserts the four-section nav stays trimmed. Live coordinates and deterioration analysis share Asset Monitor; alerts and audit remain under Settings.

## Environment variables

Copy `.env.local.example` → `.env.local` and adjust:

```
NEXT_PUBLIC_API_URL=http://localhost:8080/api/v1
```

For local UI testing against a remote API without relaxing production CORS, use:

```
NEXT_PUBLIC_API_URL=/api
DINSIGHT_API_PROXY_TARGET=http://135.149.57.99/api/v1
```

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md) for the per-week feature arc.
