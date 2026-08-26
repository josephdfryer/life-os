// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LevelUpFeature",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "LevelUpFeature", targets: ["LevelUpFeature"])],
    dependencies: [
        .package(path: "../LifeOSCompanionCore"),
    ],
    targets: [
        .target(
            name: "LevelUpFeature",
            dependencies: [.product(name: "LifeOSCompanionCore", package: "LifeOSCompanionCore")],
            resources: [.process("Resources")]
        ),
        .testTarget(name: "LevelUpFeatureTests", dependencies: ["LevelUpFeature"]),
    ]
)
