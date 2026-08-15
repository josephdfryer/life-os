// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PersonsFeature",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "PersonsFeature", targets: ["PersonsFeature"])],
    dependencies: [.package(path: "../LifeOSCompanionCore")],
    targets: [
        .target(name: "PersonsFeature", dependencies: ["LifeOSCompanionCore"]),
        .testTarget(name: "PersonsFeatureTests", dependencies: ["PersonsFeature"]),
    ]
)
