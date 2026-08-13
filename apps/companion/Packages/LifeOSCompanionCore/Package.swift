// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LifeOSCompanionCore",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [.library(name: "LifeOSCompanionCore", targets: ["LifeOSCompanionCore"])],
    targets: [
        .target(name: "LifeOSCompanionCore", linkerSettings: [.linkedLibrary("sqlite3"), .linkedFramework("Security")]),
        .testTarget(name: "LifeOSCompanionCoreTests", dependencies: ["LifeOSCompanionCore"]),
    ]
)
