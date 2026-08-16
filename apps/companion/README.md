# Life OS Companion

Open `LifeOSCompanion.xcodeproj` in Xcode 16+. The project contains macOS, embedded login-item, and two iOS targets plus local Swift packages:

- `Life OS Companion iOS` installs as **Life OS** and owns HealthKit, significant-location, and new-photo metadata collection.
- `Persons iOS` installs as **Persons** and owns the personal CRM surface without device-data permissions.

See `docs/COMPANION_ARCHITECTURE.md`, `docs/IOS_PLATFORM_PLAN.md`, and `docs/runbooks/COMPANION_RELEASE.md` before changing privacy boundaries or shipping.

No target needs the monorepo, Node, Homebrew, Python, local environment files, or LaunchAgent installation at runtime.
