import LifeOSCompanionCore
import SwiftUI

public struct PersonsRootView: View {
    @StateObject private var model: PersonsModel
    @State private var query = ""

    public init(api: APIClient) {
        _model = StateObject(wrappedValue: PersonsModel(dataSource: PersonsClient(api: api)))
    }

    init(dataSource: any PersonsDataSource) {
        _model = StateObject(wrappedValue: PersonsModel(dataSource: dataSource))
    }

    public var body: some View {
        NavigationStack {
            ZStack {
                Still.background.ignoresSafeArea()
                content
            }
            .navigationTitle("People")
            .searchable(text: $query, prompt: "Name, company, email")
            .task(id: query) {
                if !query.isEmpty {
                    try? await Task.sleep(for: .milliseconds(250))
                    guard !Task.isCancelled else { return }
                }
                await model.reload(query: query)
            }
            .refreshable { await model.reload(query: query) }
        }
        .tint(Still.cognac)
    }

    @ViewBuilder private var content: some View {
        if model.isLoading && model.people.isEmpty {
            ProgressView("Loading people…")
                .tint(Still.cognac)
                .foregroundStyle(Still.secondaryInk)
        } else if let error = model.errorMessage, model.people.isEmpty {
            ContentUnavailableView("People unavailable", systemImage: "person.crop.circle.badge.exclamationmark", description: Text(error))
        } else if model.people.isEmpty {
            ContentUnavailableView.search(text: query)
        } else {
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(model.people) { person in
                        NavigationLink(value: person) { PersonRow(person: person) }
                            .buttonStyle(.plain)
                            .task { await model.loadMoreIfNeeded(after: person) }
                    }
                    if model.isLoadingMore { ProgressView().padding() }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
            }
            .navigationDestination(for: Person.self) { PersonDetailView(person: $0) }
        }
    }
}

private struct PersonRow: View {
    let person: Person
    var body: some View {
        HStack(spacing: 14) {
            Text(person.initials)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Still.cognacDeep)
                .frame(width: 44, height: 44)
                .background(LinearGradient(colors: [Still.cognacSoft, Still.camelSoft], startPoint: .topLeading, endPoint: .bottomTrailing))
                .clipShape(Circle())
            VStack(alignment: .leading, spacing: 3) {
                Text(person.displayName)
                    .font(.system(size: 19, design: .serif))
                    .foregroundStyle(Still.ink)
                if let context = person.contextLine {
                    Text(context).font(.subheadline).foregroundStyle(Still.mutedInk).lineLimit(1)
                }
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Still.mutedInk)
        }
        .padding(14)
        .background(Still.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Still.border.opacity(0.45), lineWidth: 0.5))
    }
}

private struct PersonDetailView: View {
    let person: Person
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack(spacing: 16) {
                    Text(person.initials)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Still.cognacDeep)
                        .frame(width: 64, height: 64)
                        .background(LinearGradient(colors: [Still.cognacSoft, Still.camelSoft], startPoint: .topLeading, endPoint: .bottomTrailing))
                        .clipShape(Circle())
                    VStack(alignment: .leading, spacing: 4) {
                        Text(person.displayName).font(.system(size: 30, design: .serif)).foregroundStyle(Still.ink)
                        if let context = person.contextLine { Text(context).foregroundStyle(Still.mutedInk) }
                    }
                }
                detailSection("Contact", rows: contactRows)
                detailSection("Context", rows: contextRows)
                if let notes = person.notes, !notes.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Notes").font(.headline).foregroundStyle(Still.ink)
                        Text(notes).foregroundStyle(Still.secondaryInk).textSelection(.enabled)
                    }
                    .card()
                }
                if !person.tags.isEmpty {
                    FlowLayout(spacing: 8) {
                        ForEach(person.tags, id: \.self) { tag in
                            Text(tag).font(.caption).foregroundStyle(Still.cognacDeep).padding(.horizontal, 10).padding(.vertical, 5).background(Still.cognacSoft).clipShape(Capsule())
                        }
                    }
                }
            }
            .padding(20)
        }
        .background(Still.background)
    }

    private var contactRows: [(String, String)] {
        person.emails.map { ("Email", $0) } + person.phones.map { ("Phone", $0) }
    }
    private var contextRows: [(String, String)] {
        [("Company", person.company), ("Title", person.title), ("Location", person.location), ("Birthday", person.birthday)]
            .compactMap { label, value in value.map { (label, $0) } }
    }
    @ViewBuilder private func detailSection(_ title: String, rows: [(String, String)]) -> some View {
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text(title).font(.headline).foregroundStyle(Still.ink)
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.0).font(.caption).foregroundStyle(Still.mutedInk)
                        Text(row.1).foregroundStyle(Still.secondaryInk).textSelection(.enabled)
                    }
                }
            }
            .card()
        }
    }
}

private extension View {
    func card() -> some View {
        padding(16).frame(maxWidth: .infinity, alignment: .leading).background(Still.surface).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private struct FlowLayout: Layout {
    let spacing: CGFloat
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        layout(proposal: proposal, subviews: subviews).size
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = layout(proposal: ProposedViewSize(width: bounds.width, height: proposal.height), subviews: subviews)
        for (index, point) in result.points.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + point.x, y: bounds.minY + point.y), proposal: .unspecified)
        }
    }
    private func layout(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, points: [CGPoint]) {
        let width = proposal.width ?? .infinity
        var points: [CGPoint] = [], x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            points.append(CGPoint(x: x, y: y)); x += size.width + spacing; rowHeight = max(rowHeight, size.height)
        }
        return (CGSize(width: width.isFinite ? width : x, height: y + rowHeight), points)
    }
}
