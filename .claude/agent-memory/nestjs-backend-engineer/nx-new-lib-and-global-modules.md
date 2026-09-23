---
name: nx-new-lib-and-global-modules
description: Minimal template for a new libs/<name> Nx lib (no package.json/eslint needed); pattern for sharing one service instance across two @Global() consumers that don't import each other
metadata:
  type: project
---

## New Nx lib minimal template
Confirmed against `libs/auction-matching` and `libs/common` (both have zero `package.json`, zero eslint config):
```
libs/<name>/project.json       # { "name": "<name>-lib", sourceRoot: "libs/<name>/src", projectType: "library", tags, targets: {} }
libs/<name>/tsconfig.lib.json  # extends ../../tsconfig.base.json, adds outDir/declaration/decorators
libs/<name>/src/index.ts       # barrel
```
Then add the path mapping in `tsconfig.base.json`'s `compilerOptions.paths`:
```json
"@htownautos/<name>": ["libs/<name>/src/index.ts"],
```
No manual registration in `nx.json` needed — Nx auto-discovers projects via `project.json` presence.

## Sharing a stateful service singleton between two modules that don't import each other
Problem: `PresenceGateway` (in `apps/api/src/presence/`) needs to call `.setServer(socket)` on a service, and a *different* module's queue consumer needs to call `.emitLocal()` on the exact SAME instance — but neither module imports the other (would risk a circular import), and Nest gives each module its OWN instance of a class listed in its own `providers: []` unless they share a provider through export/import or a global module.

Solution used for `SocialRealtimeService` (Social Suite, 2026-09-23): put the service in a dedicated `@Global()` Nest module inside the shared lib itself:
```ts
// libs/social/src/realtime/social-realtime.module.ts
@Global()
@Module({ imports: [RabbitMQModule], providers: [SocialRealtimeService], exports: [SocialRealtimeService] })
export class SocialRealtimeModule {}
```
Import it exactly ONCE in each app's root `AppModule` (api and data-sync each need their own import — `@Global()` only broadcasts within the app/process it's registered in, not across apps). After that, ANY module in that process — including ones that never import each other — can inject the service via constructor and get the same singleton. `PresenceGateway` then just adds it as a 5th constructor param (same pattern as `SmsEventsService`/`StripeEventsService`/etc.) and calls `.setServer(this.server)` in `afterInit()`.

**Don't** also list the service in a second module's own `providers: []` — that creates a second, disconnected instance and silently breaks the bridge (no error, just nothing happens).

## Two-mode emit pattern for a service used by both api (has Socket.IO) and data-sync (doesn't)
Mirrors `apps/api/src/presence/sms-events.service.ts`: the service holds a nullable `server: Server | null`, exposes `setServer(server)` (called only where a real Socket.IO server exists — `PresenceGateway.afterInit()`), and `emit()` checks `if (this.server)` to push directly vs. falling back to publishing on a RabbitMQ queue. The process without a local server (data-sync) always takes the queue path; the process with one (api) needs a *consumer* for that same queue to re-emit what the other process couldn't deliver directly — that consumer lives wherever makes sense app-side (e.g. `SocialModule.onModuleInit()` calling `rabbitMQ.consume(QUEUE, ...)`), NOT inside the shared lib (the lib shouldn't assume it's safe to auto-consume — importing the module in data-sync too must not create a self-consuming loop).
