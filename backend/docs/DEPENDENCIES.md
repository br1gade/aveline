# Dependencies

What is current, what is held back, and why. Baseline reviewed 8 October 2026;
payment/mail launch dependency updates recorded 23 November 2026.

A pin with no stated reason gets removed by the next person who runs
`npm outdated`, discovers the breakage themselves, and reverts. So each one
below says what blocks it and what would unblock it.

---

## 1. Current

| | Version | Note |
|---|---|---|
| **Node** | 26 LTS | Entered LTS October 2026. `engines` states `>=24` so a contributor on 24, also LTS, is not blocked |
| TypeScript | 6.0.3 | See §2 |
| NestJS | 11.2.7 | See §2 |
| Prisma | 6.19.3 | Runtime dependency: the release image runs its own pinned migration CLI; see §2 |
| ESLint | 10.12.0 | Needed `@eslint/js` as a direct dependency; 10 no longer provides it transitively |
| Jest | 30.5.2 | |
| nodemailer | 10.1.4 | Launch mail update; recipients are validated before transport and send errors retain the existing controlled retry path |
| body-parser | 2.4.0 | Lockfile resolution through the existing Express dependency; no application parser override or module-system migration |
| sharp | 0.35.5 | Photo resizing. Ships prebuilt binaries for the Alpine image (`@img/sharp-linuxmusl-*`), so no build tools are needed in Docker |
| Other packages | See `package-lock.json` | Check the release tree; the older baseline is not a claim that every package is current |

## 2. Held back, with reasons

> **Decided (8 October 2026): both migrations below wait until after the
> pilot.** They are large rewrites of the module system and the data layer
> with no user-visible benefit, the current versions are supported, and doing
> them against a codebase real usage has not yet settled would mean doing parts
> of them twice. Revisit once the first real events have run.

### NestJS 12 — needs an ESM migration

`@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express` and
`@nestjs/testing` are all `"type": "module"` at v12 with **no `require`
export condition**. The backend compiles to CommonJS, so it cannot load them
at all. This is not a version bump; it is a module-system migration:

- `module` becomes `nodenext`, and every relative import needs a `.js`
  extension — several hundred of them
- `ts-jest` needs its experimental ESM mode, or the test runner changes
- `__dirname` and `require.resolve` call sites need replacing
- Prisma's client is CommonJS and would interop

`@nestjs/jwt@12`, `@nestjs/schedule@12`, `@nestjs/config@12` and `nanoid@6`
are blocked by exactly the same thing — which is why `@nestjs/jwt` and
`@nestjs/schedule` were already pinned before this review, for the same reason
that still holds.

**To unblock:** decide to migrate to ESM. Worth doing deliberately, as its own
piece of work, not as a side effect of an upgrade.

### Prisma 7 — needs a driver-adapter migration

Prisma 7 removes `url` from the schema's `datasource` block. The connection
URL moves to a `prisma.config.ts`, and `PrismaClient` must be constructed with
a driver adapter (`@prisma/adapter-pg`) or an Accelerate URL. That touches:

- `prisma/schema.prisma`, and a new `prisma.config.ts`
- `PrismaService`, which currently takes no constructor arguments
- `test/setup/test-database.ts` and every integration spec that builds a
  client — the harness all 134 integration and 224 e2e tests run on

**It was attempted during this review and reverted**, because changing the data
layer and its test harness together, at the end of other upgrades, is how the
part that works gets broken. The schema validation error is the whole of the
remaining work and is reproducible in one command: `npx prisma validate`.

**To unblock:** take it on its own, with the integration suite as the check.

### TypeScript 7 — blocked by ts-jest

`ts-jest@29.4.14`, the current stable, declares `typescript >=4.3 <7`. There is
no stable ts-jest that accepts 7. TypeScript 6.0.3 is therefore the newest
version the test runner supports.

**To unblock:** a ts-jest release that supports TypeScript 7, or moving the
test runner to `@swc/jest` or Vitest.

## 3. Current advisory review

The 23 November launch-tree `npm audit --omit=dev` reports **14 affected package
entries: six high and eight moderate, none critical**. This counts dependency
paths as well as their underlying advisories, not fourteen proven application
exploits. The earlier five-entry acceptance list is historical, not a blanket
acceptance of this result. Nodemailer and body-parser are absent from this
remaining report after the updates above.

| Remaining dependency path | Current reachability / work |
|---|---|
| Prisma → `@prisma/config` → `deepmerge-ts`, `effect` (high) | Configuration tooling remains in the release for migrations; repository-owned configuration is not HTTP input. Prisma 7 is the offered major-version remedy and still needs the separate adapter migration in §2 |
| Nest Express → `multer` (high) | Upload middleware is used by the application. The reported condition involves pending asynchronous `fileFilter` work; no asynchronous application `fileFilter` is configured. The dependency remains reported and needs a scoped compatibility/reachability decision; it is not silently accepted here |
| Nest Swagger → `js-yaml` (moderate) | Swagger setup is disabled in production by `application.ts`; documentation/build paths remain separately relevant |
| Sentry → bundler plugins → `glob` / `minimatch` (moderate) | Bundler/tooling paths are present in the production dependency tree. No claim of HTTP exploitability or completed upgrade is made |
| `fast-uri` (moderate) | Reached through AJV/schema tooling; review the exact production import/input path before deciding acceptance or a compatible dependency update |

Re-run the audit on the final release lockfile. Remaining entries are dependency
review work, separate from hosting credentials and provider acceptance; a clean
mail/parser update does not make this full report clean.

## 4. What changing TypeScript majors cost here

Recorded because the next upgrade will hit the same things:

- `baseUrl` was removed in TypeScript 6. The `@/*` path alias that depended on
  it was unused — every import in the codebase is relative — so it went
  rather than being rewritten.
- `@types` packages are no longer all included implicitly. `tsconfig.json` now
  names them: `node`, `jest`, `express`, `multer`. The last is there for the
  `Express.Multer.File` global that the upload endpoints are typed against,
  and its absence is a confusing error about a missing namespace.
- `rootDir` must be explicit in `tsconfig.build.json`, or the compiler refuses
  to infer the output layout.
- `@types/node` 26 types `fetch` strictly, which caught two test fakes that
  had been standing in for it with a narrower signature than it has.
