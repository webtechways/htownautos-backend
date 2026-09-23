---
name: jest-and-tsc-verification
description: Root jest config was broken (rootDir pointed at nonexistent dir); tsconfig.app.json include globs type-check ALL of libs/**, which poisons naive baseline-vs-after tsc comparisons
metadata:
  type: project
---

## Root jest config was dead before 2026-09-23
`package.json`'s `"jest"` block had `"rootDir": "src"` — there is no top-level `src/` in this repo (Nx monorepo, apps live in `apps/*/src`). `npx jest <anything>` failed with a Validation Error ("Directory .../src in the rootDir option was not found") for the WHOLE repo, not just new libs. Existing `*.spec.ts` files (`apps/api/src/meta/*.spec.ts` etc.) were presumably never run via bare `npx jest`.

Fixed by setting `rootDir: "."` and adding `testPathIgnorePatterns: ["/node_modules/", "/dist/"]`. This makes `npx jest <pattern>` treat `<pattern>` as a testPathPattern regex over the whole repo — works, but scans broadly (fine performance-wise).

**Also needed**: the base `tsconfig.base.json` sets `"module": "nodenext"` — if ts-jest inherits that, compiled tests emit ESM `import`/`export` syntax that Jest's default CJS runtime can't execute ("Cannot use import statement outside a module"). Fix: override per-transform in the jest config itself:
```json
"transform": {
  "^.+\\.(t|j)s$": ["ts-jest", { "tsconfig": { "module": "commonjs", "moduleResolution": "node", "resolvePackageJsonExports": false, "esModuleInterop": true, "experimentalDecorators": true, "emitDecoratorMetadata": true } }]
}
```
`resolvePackageJsonExports: false` is required too — TS5098 error otherwise ("resolvePackageJsonExports can only be used when moduleResolution is node16/nodenext/bundler"), because ts-jest merges your override onto the *discovered* tsconfig.json (which has `resolvePackageJsonExports: true` from the base file) rather than replacing it wholesale.

**Whenever asked to "make `npx jest <lib>` work"**: check this config first before writing new jest.config files — the fix belongs in the root `package.json`, not a per-lib config (there's no per-project jest setup in this repo; libs like `auction-matching`/`common` have no jest.config at all).

## tsconfig.app.json type-checks the WHOLE libs/ tree, not just imports
`apps/api/tsconfig.app.json` and `apps/data-sync/tsconfig.app.json` both have:
```json
"include": ["src/**/*.ts", "../../libs/**/*.ts"]
```
This means `npx tsc --noEmit -p apps/api/tsconfig.app.json` type-checks EVERY `.ts` file under `apps/api/src/**` and `libs/**`, whether or not anything actually imports it — not just files reachable from `main.ts`.

**Consequence for baseline-vs-after comparisons**: if you create new untracked files (new lib, new module dir) and then `git stash` only the *tracked* modified files to get a "before" error count, the untracked new files are STILL on disk and STILL get type-checked — against the reverted (pre-your-change) schema/lib exports, producing spurious errors that make the baseline look dirty even though main is actually clean. This happened during the social-suite B1 build: a naive baseline showed 9/6 errors that were actually caused by my own new files referencing not-yet-restored `@htownautos/social` path mapping and not-yet-regenerated Prisma types.

**Fix**: use `git stash -u` (stash untracked too) for the baseline run, not just `git stash push -- <tracked files>`. Re-run `npx prisma generate` before AND after each stash toggle if the schema changed, since the generated client on disk isn't tracked by git and won't follow the stash.

## RolesGuard IS used via `@UseGuards` at the method level — this is not the forbidden pattern
The house rule "Never `@UseGuards(...)` on a controller" (which crash-loops the API when a guard needs `PrismaService` but its module didn't import `PrismaModule`) refers to guards that AREN'T already wired to run safely. `RolesGuard` (`@htownautos/auth`) injects `PrismaService` too, but it's an established, safe, *method-level* (not controller-level) pattern used throughout the codebase: `apps/api/src/tenant/tenant.controller.ts`, `apps/api/src/api-keys/api-keys.controller.ts`, `apps/api/src/portal/portal-settings.controller.ts` all do:
```ts
@UseGuards(RolesGuard)
@RequireRoles(...ADMIN_ROLES)
@Patch()
update(...) { ... }
```
Safe as long as the controller's own module imports `PrismaModule` (RolesGuard needs it). Confirmed no crash risk — the global guard chain (`ApiKeyGuard → ClerkJwtGuard → TenantGuard`) runs first and doesn't check roles at all; `RolesGuard` is the *only* thing enforcing `@RequireRoles`, and it is NOT global (checked `libs/auth/src/auth.module.ts` — only the three global guards are registered as `APP_GUARD`; `RolesGuard` is exported for manual `@UseGuards` use).
