import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

struct ExerciseGuide {
    let symbol: String
    let imageBase: String?
    let setup: [String]
    let execution: [String]
    let mistakes: [String]
    let rangeOfMotion: String

    init(
        symbol: String,
        imageBase: String? = nil,
        setup: [String],
        execution: [String],
        mistakes: [String],
        rangeOfMotion: String
    ) {
        self.symbol = symbol
        self.imageBase = imageBase
        self.setup = setup
        self.execution = execution
        self.mistakes = mistakes
        self.rangeOfMotion = rangeOfMotion
    }

    static func forExercise(_ exercise: PreparedExercise) -> ExerciseGuide {
        switch exercise.key {
        case "box_jump":
            ExerciseGuide(
                symbol: "figure.cross.training",
                imageBase: "box-jump",
                setup: ["Use a stable box at a height you can land on without tucking your knees sharply.", "Stand about one foot from the box with feet near hip width."],
                execution: ["Brace, hinge slightly, and swing your arms back.", "Drive through the floor and jump onto the box.", "Land softly with your whole foot supported, then stand tall and step down."],
                mistakes: ["Choosing a box that forces a deep, collapsed landing.", "Letting the knees cave inward.", "Jumping down instead of stepping down."],
                rangeOfMotion: "Finish in a balanced standing position on the box. Reduce the height if you cannot land quietly with knees tracking over the feet."
            )
        case "pogo_hops":
            ExerciseGuide(
                symbol: "figure.jumprope",
                setup: ["Stand tall with feet under the hips and knees softly unlocked."],
                execution: ["Make quick, low hops from the ankles.", "Keep the torso quiet and land on the midfoot.", "Think light, springy contacts rather than maximum height."],
                mistakes: ["Turning each hop into a deep squat.", "Landing loudly or losing rhythm."],
                rangeOfMotion: "Use only the height you can control with quick, quiet contacts. Stop if the knee flare increases."
            )
        case "trap_bar_deadlift":
            ExerciseGuide(
                symbol: "figure.strengthtraining.traditional",
                imageBase: "hex-bar-deadlift",
                setup: ["Stand centered inside the trap bar with the handles aligned over midfoot.", "Hinge and bend the knees to grip while keeping a long, neutral spine."],
                execution: ["Brace before the plates leave the floor.", "Push the floor away and let hips and shoulders rise together.", "Stand tall with ribs stacked over pelvis, then lower by sending the hips back."],
                mistakes: ["Jerking the bar from a loose start.", "Rounding the lower back.", "Leaning backward at lockout."],
                rangeOfMotion: "Pull from the available handle height without losing spinal position. Use high handles or blocks when needed."
            )
        case "bench_press":
            ExerciseGuide(
                symbol: "figure.strengthtraining.traditional",
                imageBase: "bench-press",
                setup: ["Set the rack so you can unrack without losing your shoulder position.", "Plant the feet and draw the shoulder blades gently down and back."],
                execution: ["Unrack with wrists stacked over elbows.", "Lower under control toward the lower chest with elbows roughly 30–60° from the torso.", "Press up and slightly back while keeping the feet planted."],
                mistakes: ["Letting wrists fold backward.", "Bouncing the bar off the chest.", "Losing shoulder-blade tension to reach lockout."],
                rangeOfMotion: "Lower only as far as the shoulders remain comfortable and controlled. Use safeties or a spotter for challenging sets."
            )
        case "bulgarian_split_squat":
            ExerciseGuide(
                symbol: "figure.strengthtraining.traditional",
                imageBase: "bulgarian-split-squat",
                setup: ["Place the rear foot on a low bench and set the front foot far enough forward to keep the heel planted.", "Square the hips and brace before descending."],
                execution: ["Lower the hips with control while the front knee tracks over the toes.", "Keep most of the pressure through the front foot.", "Drive through the front foot to stand."],
                mistakes: ["Using a stance so short that the front heel lifts.", "Letting the front knee collapse inward.", "Pushing primarily from the rear leg."],
                rangeOfMotion: "Descend as far as you can keep the front foot planted, knee tracking, and pelvis controlled."
            )
        case "hip_thrust":
            ExerciseGuide(
                symbol: "figure.core.training",
                imageBase: "hip-thrust",
                setup: ["Place the upper back against a stable bench and position the feet about hip width.", "Pad the load and keep the chin gently tucked."],
                execution: ["Brace and drive through the whole foot.", "Lift until the torso and thighs form a straight line.", "Pause with glutes tight, then lower under control."],
                mistakes: ["Finishing by arching the lower back.", "Placing the feet so far away that the hamstrings dominate.", "Flaring the ribs at the top."],
                rangeOfMotion: "Finish with ribs and pelvis stacked; more height is not better if it comes from lumbar extension."
            )
        case "farmer_carry":
            ExerciseGuide(
                symbol: "figure.walk.motion",
                setup: ["Stand between the implements and lift them with the same braced position you would use for a deadlift."],
                execution: ["Stand tall with ribs over pelvis and arms long.", "Take short, controlled steps while breathing behind the brace.", "Set the weights down with control at the end."],
                mistakes: ["Shrugging continuously toward the ears.", "Leaning to one side.", "Rushing into long, unstable steps."],
                rangeOfMotion: "Walk only as far as you can maintain an even, upright posture and secure grip."
            )
        case "plank":
            ExerciseGuide(
                symbol: "figure.core.training",
                setup: ["Place elbows under shoulders and extend the legs with feet about hip width."],
                execution: ["Tighten the glutes and quads.", "Keep ribs and pelvis stacked so the body forms one long line.", "Breathe slowly without losing the brace."],
                mistakes: ["Letting the lower back sag.", "Piking the hips too high.", "Holding the breath or shrugging into the shoulders."],
                rangeOfMotion: "End the set when you can no longer maintain a neutral trunk. A shorter clean hold is the better set."
            )
        default:
            ExerciseGuide(
                symbol: exercise.modality == "duration" ? "timer" : "figure.strengthtraining.traditional",
                setup: ["Set up in a stable position and use a load you can control."],
                execution: ["Move smoothly through the intended pattern.", "Keep each repetition controlled and repeatable."],
                mistakes: ["Using momentum to force the movement.", "Continuing through sharp or increasing pain."],
                rangeOfMotion: "Use the largest comfortable range you can control without changing position."
            )
        }
    }
}

struct ExerciseDetailView: View {
    let entry: PreparedWorkoutEntry
    @Environment(\.dismiss) private var dismiss

    private var guide: ExerciseGuide { .forExercise(entry.exercise) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    movementPreview
                    guideSection("Set up", items: guide.setup)
                    guideSection("Do the movement", items: guide.execution)
                    guideSection("Watch for", items: guide.mistakes)
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Range of motion").font(.headline).foregroundStyle(LevelUpStill.ink)
                        Text(guide.rangeOfMotion).foregroundStyle(LevelUpStill.secondaryInk)
                    }
                    .levelUpCard()

                    Label("Stop if you feel sharp, sudden, or increasing pain.", systemImage: "heart.text.square")
                        .font(.footnote)
                        .foregroundStyle(LevelUpStill.cognacDeep)
                        .levelUpCard()
                }
                .padding(18)
            }
            .background(LevelUpStill.background)
            .navigationTitle(entry.exercise.label)
#if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
#endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .preferredColorScheme(.light)
    }

    private var movementPreview: some View {
        Group {
            if let imageBase = guide.imageBase {
                VStack(spacing: 10) {
                    HStack(spacing: 2) {
                        phaseImage("\(imageBase)-start")
                        phaseImage("\(imageBase)-peak")
                    }
                    .overlay {
                        Image(systemName: "arrow.right")
                            .font(.headline)
                            .foregroundStyle(LevelUpStill.cognacDeep)
                            .padding(9)
                            .background(LevelUpStill.surface)
                            .clipShape(Circle())
                            .shadow(radius: 2, y: 1)
                    }
                    Text("Start position → controlled finish")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(LevelUpStill.mutedInk)
                }
                .padding(8)
                .background(LevelUpStill.surface)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            } else {
                symbolicMovementPreview
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Static movement preview for \(entry.exercise.label)")
    }

    private var symbolicMovementPreview: some View {
        VStack(spacing: 14) {
            HStack(spacing: 22) {
                Image(systemName: guide.symbol)
                    .font(.system(size: 52, weight: .light))
                Image(systemName: "arrow.right")
                    .font(.title2)
                    .foregroundStyle(LevelUpStill.camel)
                Image(systemName: guide.symbol)
                    .font(.system(size: 52, weight: .semibold))
            }
            Text("Start position → controlled finish")
                .font(.caption.weight(.medium))
                .foregroundStyle(LevelUpStill.onPetrolSecondary)
        }
        .foregroundStyle(LevelUpStill.onPetrol)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
        .background(LevelUpStill.petrol)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    @ViewBuilder
    private func phaseImage(_ name: String) -> some View {
#if canImport(UIKit)
        if let url = Bundle.module.url(forResource: name, withExtension: "png"),
           let image = UIImage(contentsOfFile: url.path) {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        } else {
            missingPhaseImage
        }
#elseif canImport(AppKit)
        if let url = Bundle.module.url(forResource: name, withExtension: "png"),
           let image = NSImage(contentsOf: url) {
            Image(nsImage: image)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        } else {
            missingPhaseImage
        }
#else
        missingPhaseImage
#endif
    }

    private var missingPhaseImage: some View {
        Image(systemName: guide.symbol)
            .font(.system(size: 46, weight: .light))
            .foregroundStyle(LevelUpStill.cognacDeep)
            .frame(maxWidth: .infinity, minHeight: 130)
            .background(LevelUpStill.cognacSoft)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func guideSection(_ title: String, items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline).foregroundStyle(LevelUpStill.ink)
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                HStack(alignment: .top, spacing: 10) {
                    Text("\(index + 1)")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(LevelUpStill.cognacDeep)
                        .frame(width: 24, height: 24)
                        .background(LevelUpStill.cognacSoft)
                        .clipShape(Circle())
                    Text(item).foregroundStyle(LevelUpStill.secondaryInk)
                }
            }
        }
        .levelUpCard()
    }
}
