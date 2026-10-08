# Dependencies

What is current, what is held back, and why. Checked 8 October 2026.

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
| Prisma | 6.19.3 | See §2 |
| ESLint | 10.12.0 | Needed `@eslint/js` as a direct dependency; 10 no longer provides it transitively |
| Jest | 30.5.2 | |
| nodemailer | 10.0.16 | Upgraded for two high-severity advisories, one of them SMTP command injection |
| everything else | latest | |

## 2. Held back, with reasons

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

## 3. Advisories accepted, not fixed

`npm audit --omit=dev` reports five, all reached through two packages:

| Advisory | Why it is accepted |
|---|---|
| `prisma` → `@prisma/config` → `deepmerge-ts` (high, stack exhaustion) | Reached only when parsing a Prisma config file, which is ours and not user input. Fixed by Prisma 7 — see §2 |
| `@nestjs/swagger` → `js-yaml` (moderate, CPU) | Swagger is disabled in production (`main.ts`), so the code is unreachable there |

Both should be re-checked when either migration in §2 is taken on. Neither is
reachable by a request.

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
