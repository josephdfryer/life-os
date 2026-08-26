import SwiftUI

struct ExerciseLibraryItem: Identifiable, Codable, Hashable {
    let key: String
    let label: String
    let category: String
    let modality: String
    let catalogKey: String?
    let defaultRestSec: Int
    let jointLoad: [String]

    var id: String { key }
    var symbol: String {
        if modality == "duration" { return "timer" }
        if modality == "bodyweight" { return "figure.core.training" }
        return "dumbbell"
    }

    var preparedExercise: PreparedExercise {
        PreparedExercise(
            id: "library-\(key)", key: key, label: label, modality: modality,
            catalogKey: catalogKey, defaultRestSec: defaultRestSec, jointLoad: jointLoad
        )
    }

    static let all: [ExerciseLibraryItem] = [
        .init(key: "box_jump", label: "Box jump", category: "Power", modality: "bodyweight", catalogKey: nil, defaultRestSec: 90, jointLoad: ["knee"]),
        .init(key: "broad_jump", label: "Broad jump", category: "Power", modality: "bodyweight", catalogKey: nil, defaultRestSec: 90, jointLoad: ["knee"]),
        .init(key: "pogo_hops", label: "Pogo hops", category: "Power", modality: "bodyweight", catalogKey: nil, defaultRestSec: 60, jointLoad: []),
        .init(key: "trap_bar_deadlift", label: "Trap-bar deadlift", category: "Lower body", modality: "load", catalogKey: "trap_bar_deadlift", defaultRestSec: 180, jointLoad: ["lumbar"]),
        .init(key: "back_squat", label: "Back squat", category: "Lower body", modality: "load", catalogKey: "back_squat", defaultRestSec: 180, jointLoad: ["knee", "lumbar"]),
        .init(key: "front_squat", label: "Front squat", category: "Lower body", modality: "load", catalogKey: "front_squat", defaultRestSec: 150, jointLoad: ["knee", "lumbar"]),
        .init(key: "bulgarian_split_squat", label: "Bulgarian split squat", category: "Lower body", modality: "load", catalogKey: "bulgarian_split_squat", defaultRestSec: 90, jointLoad: ["knee"]),
        .init(key: "romanian_deadlift", label: "Romanian deadlift", category: "Lower body", modality: "load", catalogKey: "romanian_deadlift", defaultRestSec: 120, jointLoad: ["lumbar"]),
        .init(key: "hip_thrust", label: "Hip thrust", category: "Lower body", modality: "load", catalogKey: "hip_thrust", defaultRestSec: 90, jointLoad: []),
        .init(key: "bench_press", label: "Bench press", category: "Upper body", modality: "load", catalogKey: "bench_press", defaultRestSec: 150, jointLoad: ["shoulder"]),
        .init(key: "incline_press", label: "Incline press", category: "Upper body", modality: "load", catalogKey: "incline_press", defaultRestSec: 120, jointLoad: ["shoulder"]),
        .init(key: "overhead_press", label: "Overhead press", category: "Upper body", modality: "load", catalogKey: "overhead_press", defaultRestSec: 120, jointLoad: ["shoulder", "lumbar"]),
        .init(key: "weighted_pullup", label: "Weighted pull-up", category: "Upper body", modality: "bodyweight", catalogKey: "weighted_pullup", defaultRestSec: 120, jointLoad: []),
        .init(key: "barbell_row", label: "Barbell row", category: "Upper body", modality: "load", catalogKey: "barbell_row", defaultRestSec: 90, jointLoad: ["lumbar"]),
        .init(key: "chest_supported_row", label: "Chest-supported row", category: "Upper body", modality: "load", catalogKey: nil, defaultRestSec: 90, jointLoad: []),
        .init(key: "lat_pulldown", label: "Lat pulldown", category: "Upper body", modality: "load", catalogKey: nil, defaultRestSec: 90, jointLoad: []),
        .init(key: "farmer_carry", label: "Farmer carry", category: "Carry & core", modality: "load_duration", catalogKey: nil, defaultRestSec: 90, jointLoad: ["lumbar"]),
        .init(key: "suitcase_carry", label: "Suitcase carry", category: "Carry & core", modality: "load_duration", catalogKey: nil, defaultRestSec: 90, jointLoad: ["lumbar"]),
        .init(key: "plank", label: "Plank", category: "Carry & core", modality: "duration", catalogKey: nil, defaultRestSec: 60, jointLoad: []),
        .init(key: "side_plank", label: "Side plank", category: "Carry & core", modality: "duration", catalogKey: nil, defaultRestSec: 60, jointLoad: []),
        .init(key: "dead_bug", label: "Dead bug", category: "Carry & core", modality: "duration", catalogKey: nil, defaultRestSec: 45, jointLoad: []),
    ]
}

struct CustomPlanExercise: Identifiable, Codable, Hashable {
    var id = UUID()
    let exerciseKey: String
    var sets: Int
    var reps: Int
    var durationSec: Int
    var restSec: Int

    var exercise: ExerciseLibraryItem? { ExerciseLibraryItem.all.first { $0.key == exerciseKey } }
}

struct CustomWorkoutPlan: Identifiable, Codable, Hashable {
    var id = UUID()
    var name: String
    var dayName: String
    var exercises: [CustomPlanExercise]
    var createdAt = Date()
}

@MainActor
final class WorkoutPlanStore: ObservableObject {
    @Published private(set) var plans: [CustomWorkoutPlan] = []
    private let defaultsKey = "level-up.custom-workout-plans.v1"

    init() {
        guard let data = UserDefaults.standard.data(forKey: defaultsKey),
              let saved = try? JSONDecoder().decode([CustomWorkoutPlan].self, from: data) else { return }
        plans = saved
    }

    func add(_ plan: CustomWorkoutPlan) {
        plans.insert(plan, at: 0)
        persist()
        DiagnosticLog.shared.record("custom_plan_created", category: "plans", detail: "exerciseCount=\(plan.exercises.count)")
    }

    func delete(_ plan: CustomWorkoutPlan) {
        plans.removeAll { $0.id == plan.id }
        persist()
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(plans) else { return }
        UserDefaults.standard.set(data, forKey: defaultsKey)
    }
}

struct PlansView: View {
    @ObservedObject var model: LevelUpModel
    @StateObject private var store = WorkoutPlanStore()
    @State private var showingBuilder = false

    var body: some View {
        ZStack {
            LevelUpStill.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    activePlanCard
                    actions
                    savedPlans
                }
                .padding(18)
            }
        }
        .navigationTitle("Plans")
        .task { if model.workout == nil { await model.load() } }
        .sheet(isPresented: $showingBuilder) { CreatePlanView(store: store) }
    }

    private var activePlanCard: some View {
        NavigationLink {
            AIPlanDetailView(todayWorkout: model.workout)
        } label: {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Label("Active AI plan", systemImage: "sparkles")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(LevelUpStill.camel)
                    Spacer()
                    Image(systemName: "chevron.right").foregroundStyle(LevelUpStill.onPetrolSecondary)
                }
                Text("Vertical — 3 day")
                    .font(.system(size: 29, design: .serif))
                    .foregroundStyle(LevelUpStill.onPetrol)
                Text("Jump higher, build useful strength, and adapt each session to your readiness and joints.")
                    .font(.subheadline)
                    .foregroundStyle(LevelUpStill.onPetrolSecondary)
                HStack(spacing: 16) {
                    Label("3 days", systemImage: "calendar")
                    Label("Full gym", systemImage: "dumbbell")
                }
                .font(.caption.weight(.medium))
                .foregroundStyle(LevelUpStill.camel)
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(LevelUpStill.petrol)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var actions: some View {
        VStack(spacing: 12) {
            Button { showingBuilder = true } label: {
                Label("Create a plan", systemImage: "plus")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(LevelUpStill.cognac)
            .clipShape(Capsule())

            NavigationLink {
                ExerciseLibraryView()
            } label: {
                HStack {
                    Label("Browse exercise library", systemImage: "books.vertical")
                    Spacer()
                    Text("\(ExerciseLibraryItem.all.count)").foregroundStyle(LevelUpStill.mutedInk)
                    Image(systemName: "chevron.right").foregroundStyle(LevelUpStill.mutedInk)
                }
                .foregroundStyle(LevelUpStill.ink)
            }
            .buttonStyle(.plain)
            .levelUpCard()
        }
    }

    @ViewBuilder private var savedPlans: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Your plans").font(.headline).foregroundStyle(LevelUpStill.ink)
            if store.plans.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("No custom plans yet").font(.body.weight(.medium)).foregroundStyle(LevelUpStill.ink)
                    Text("Build one from the exercise library and it will stay on this phone.")
                        .font(.subheadline).foregroundStyle(LevelUpStill.mutedInk)
                }
                .levelUpCard()
            } else {
                ForEach(store.plans) { plan in
                    NavigationLink {
                        CustomPlanDetailView(plan: plan, store: store)
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "list.clipboard")
                                .foregroundStyle(LevelUpStill.cognacDeep)
                                .frame(width: 42, height: 42)
                                .background(LevelUpStill.cognacSoft)
                                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(plan.name).font(.body.weight(.medium)).foregroundStyle(LevelUpStill.ink)
                                Text("\(plan.dayName) · \(plan.exercises.count) exercises")
                                    .font(.caption).foregroundStyle(LevelUpStill.mutedInk)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").foregroundStyle(LevelUpStill.mutedInk)
                        }
                    }
                    .buttonStyle(.plain)
                    .levelUpCard()
                }
            }
        }
    }
}

private struct AIPlanDetailView: View {
    let todayWorkout: TodayWorkout?

    private let days: [(String, [String])] = [
        ("A — Pull & press", ["Box jump", "Trap-bar deadlift", "Bench press", "Bulgarian split squat", "Farmer carry", "Plank"]),
        ("B — Squat & row", ["Pogo hops", "Back squat", "Weighted pull-up", "Romanian deadlift", "Barbell row", "Side plank"]),
        ("C — Power & overhead", ["Broad jump", "Front squat", "Overhead press", "Hip thrust", "Lat pulldown", "Suitcase carry"]),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Built around you", systemImage: "sparkles")
                        .font(.caption.weight(.semibold)).foregroundStyle(LevelUpStill.camel)
                    Text("Vertical — 3 day").font(.system(size: 32, design: .serif)).foregroundStyle(LevelUpStill.onPetrol)
                    Text("The AI planner owns the goal, exercise selection, working weights, and progression. Daily readiness can adjust the session without rewriting the plan.")
                        .font(.subheadline).foregroundStyle(LevelUpStill.onPetrolSecondary)
                }
                .padding(18)
                .background(LevelUpStill.petrol)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

                ForEach(Array(days.enumerated()), id: \.offset) { _, day in
                    VStack(alignment: .leading, spacing: 12) {
                        Text(day.0).font(.title3.weight(.semibold)).foregroundStyle(LevelUpStill.ink)
                        ForEach(day.1, id: \.self) { exercise in
                            HStack {
                                Image(systemName: "dumbbell").foregroundStyle(LevelUpStill.cognacDeep).frame(width: 24)
                                Text(exercise).foregroundStyle(LevelUpStill.secondaryInk)
                                Spacer()
                                if day.0 == todayWorkout?.dayName { Text("Today").font(.caption2.weight(.semibold)).foregroundStyle(LevelUpStill.success) }
                            }
                        }
                    }
                    .levelUpCard()
                }
            }
            .padding(18)
        }
        .background(LevelUpStill.background)
        .navigationTitle("AI plan")
#if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
#endif
    }
}

private struct ExerciseLibraryView: View {
    @State private var search = ""
    @State private var detailEntry: PreparedWorkoutEntry?

    private var filtered: [ExerciseLibraryItem] {
        search.isEmpty ? ExerciseLibraryItem.all : ExerciseLibraryItem.all.filter {
            $0.label.localizedCaseInsensitiveContains(search) || $0.category.localizedCaseInsensitiveContains(search)
        }
    }

    private var categories: [String] { Array(Set(filtered.map(\.category))).sorted() }

    var body: some View {
        List {
            ForEach(categories, id: \.self) { category in
                Section(category) {
                    ForEach(filtered.filter { $0.category == category }) { exercise in
                        Button { detailEntry = guideEntry(exercise) } label: {
                            ExerciseLibraryRow(exercise: exercise, trailing: "How to")
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(LevelUpStill.background)
        .navigationTitle("Exercise library")
        .searchable(text: $search, prompt: "Search exercises")
        .sheet(item: $detailEntry) { ExerciseDetailView(entry: $0) }
    }
}

private struct ExerciseLibraryRow: View {
    let exercise: ExerciseLibraryItem
    let trailing: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: exercise.symbol)
                .foregroundStyle(LevelUpStill.cognacDeep)
                .frame(width: 38, height: 38)
                .background(LevelUpStill.cognacSoft)
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(exercise.label).foregroundStyle(LevelUpStill.ink)
                Text(exercise.catalogKey == nil ? exercise.category : "\(exercise.category) · Rankable")
                    .font(.caption).foregroundStyle(LevelUpStill.mutedInk)
            }
            Spacer()
            Text(trailing).font(.caption.weight(.medium)).foregroundStyle(LevelUpStill.cognacDeep)
        }
        .padding(.vertical, 3)
    }
}

private struct CreatePlanView: View {
    @ObservedObject var store: WorkoutPlanStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var dayName = "Workout A"
    @State private var exercises: [CustomPlanExercise] = []
    @State private var showingLibrary = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Plan") {
                    TextField("Plan name", text: $name)
                    TextField("Workout day name", text: $dayName)
                }
                Section {
                    Button { showingLibrary = true } label: {
                        Label("Add exercises", systemImage: "plus.circle.fill")
                    }
                    .foregroundStyle(LevelUpStill.cognacDeep)
                }
                Section("Exercises") {
                    if exercises.isEmpty {
                        Text("Choose exercises from the library, then set the prescription for each one.")
                            .foregroundStyle(LevelUpStill.mutedInk)
                    }
                    ForEach($exercises) { $item in
                        PlanExerciseEditor(item: $item)
                    }
                    .onDelete { exercises.remove(atOffsets: $0) }
                    .onMove { exercises.move(fromOffsets: $0, toOffset: $1) }
                }
            }
            .scrollContentBackground(.hidden)
            .background(LevelUpStill.background)
            .navigationTitle("Create plan")
#if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
#endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
#if os(iOS)
                ToolbarItem(placement: .topBarLeading) { EditButton() }
#endif
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }.disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || exercises.isEmpty)
                }
            }
            .sheet(isPresented: $showingLibrary) {
                ExercisePickerView(existingKeys: Set(exercises.map(\.exerciseKey))) { selected in
                    for exercise in selected where !exercises.contains(where: { $0.exerciseKey == exercise.key }) {
                        exercises.append(defaultPlanExercise(exercise))
                    }
                }
            }
        }
        .preferredColorScheme(.light)
    }

    private func save() {
        store.add(CustomWorkoutPlan(
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            dayName: dayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Workout A" : dayName,
            exercises: exercises
        ))
        dismiss()
    }
}

private struct PlanExerciseEditor: View {
    @Binding var item: CustomPlanExercise

    var body: some View {
        if let exercise = item.exercise {
            VStack(alignment: .leading, spacing: 10) {
                Text(exercise.label).font(.body.weight(.semibold)).foregroundStyle(LevelUpStill.ink)
                Stepper("\(item.sets) sets", value: $item.sets, in: 1...10)
                if exercise.modality == "duration" || exercise.modality == "load_duration" {
                    Stepper("\(item.durationSec) seconds", value: $item.durationSec, in: 5...600, step: 5)
                } else {
                    Stepper("\(item.reps) reps", value: $item.reps, in: 1...30)
                }
                Stepper("\(item.restSec) seconds rest", value: $item.restSec, in: 15...600, step: 15)
            }
            .padding(.vertical, 6)
        }
    }
}

private struct ExercisePickerView: View {
    let existingKeys: Set<String>
    let onAdd: ([ExerciseLibraryItem]) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Set<String> = []
    @State private var search = ""

    private var filtered: [ExerciseLibraryItem] {
        search.isEmpty ? ExerciseLibraryItem.all : ExerciseLibraryItem.all.filter {
            $0.label.localizedCaseInsensitiveContains(search) || $0.category.localizedCaseInsensitiveContains(search)
        }
    }

    var body: some View {
        NavigationStack {
            List(filtered) { exercise in
                Button {
                    if selected.contains(exercise.key) { selected.remove(exercise.key) } else { selected.insert(exercise.key) }
                } label: {
                    ExerciseLibraryRow(
                        exercise: exercise,
                        trailing: existingKeys.contains(exercise.key) ? "Added" : selected.contains(exercise.key) ? "Selected" : "Add"
                    )
                }
                .buttonStyle(.plain)
                .disabled(existingKeys.contains(exercise.key))
            }
            .searchable(text: $search, prompt: "Search exercises")
            .navigationTitle("Add exercises")
#if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
#endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add \(selected.count)") {
                        onAdd(ExerciseLibraryItem.all.filter { selected.contains($0.key) })
                        dismiss()
                    }
                    .disabled(selected.isEmpty)
                }
            }
        }
        .preferredColorScheme(.light)
    }
}

private struct CustomPlanDetailView: View {
    let plan: CustomWorkoutPlan
    @ObservedObject var store: WorkoutPlanStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(plan.dayName).font(.caption.weight(.semibold)).foregroundStyle(LevelUpStill.cognacDeep)
                    Text(plan.name).font(.system(size: 32, design: .serif)).foregroundStyle(LevelUpStill.ink)
                    Text("\(plan.exercises.count) exercises · Custom plan").foregroundStyle(LevelUpStill.mutedInk)
                }
                .levelUpCard()

                ForEach(Array(plan.exercises.enumerated()), id: \.element.id) { index, item in
                    if let exercise = item.exercise {
                        HStack(alignment: .top, spacing: 12) {
                            Text("\(index + 1)").font(.caption.weight(.bold)).foregroundStyle(LevelUpStill.cognacDeep)
                                .frame(width: 28, height: 28).background(LevelUpStill.cognacSoft).clipShape(Circle())
                            VStack(alignment: .leading, spacing: 3) {
                                Text(exercise.label).font(.body.weight(.semibold)).foregroundStyle(LevelUpStill.ink)
                                Text(planPrescription(item, exercise: exercise)).font(.caption).foregroundStyle(LevelUpStill.mutedInk)
                            }
                        }
                        .levelUpCard()
                    }
                }

                Button("Delete plan", role: .destructive) {
                    store.delete(plan)
                    dismiss()
                }
                .frame(maxWidth: .infinity)
            }
            .padding(18)
        }
        .background(LevelUpStill.background)
        .navigationTitle("Plan")
#if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
#endif
    }
}

private func defaultPlanExercise(_ exercise: ExerciseLibraryItem) -> CustomPlanExercise {
    let timed = exercise.modality == "duration" || exercise.modality == "load_duration"
    return CustomPlanExercise(
        exerciseKey: exercise.key,
        sets: 3,
        reps: timed ? 0 : 8,
        durationSec: timed ? 45 : 0,
        restSec: exercise.defaultRestSec
    )
}

private func guideEntry(_ exercise: ExerciseLibraryItem) -> PreparedWorkoutEntry {
    let timed = exercise.modality == "duration" || exercise.modality == "load_duration"
    return PreparedWorkoutEntry(
        entryId: "guide-\(exercise.key)", order: 0, exercise: exercise.preparedExercise,
        substitutedFor: nil, targetSets: 3, targetReps: timed ? nil : 8,
        targetLoadKg: nil, targetDurationSec: timed ? 45 : nil,
        restSec: exercise.defaultRestSec, lastLoadKg: nil, lastReps: nil,
        lastDurationSec: nil, lastIsBodyweight: exercise.modality == "bodyweight"
    )
}

private func planPrescription(_ item: CustomPlanExercise, exercise: ExerciseLibraryItem) -> String {
    if exercise.modality == "duration" || exercise.modality == "load_duration" {
        return "\(item.sets) × \(item.durationSec)s · \(item.restSec)s rest"
    }
    return "\(item.sets) × \(item.reps) · \(item.restSec)s rest"
}
