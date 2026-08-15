import Combine
import Foundation

@MainActor
final class PersonsModel: ObservableObject {
    @Published private(set) var people: [Person] = []
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingMore = false
    @Published private(set) var errorMessage: String?
    private let dataSource: any PersonsDataSource
    private var cursor: String?
    private var hasMore = false
    private var currentQuery = ""

    init(dataSource: any PersonsDataSource) {
        self.dataSource = dataSource
    }

    func reload(query: String) async {
        let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines)
        currentQuery = normalized
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let page = try await dataSource.people(query: normalized, cursor: nil)
            guard currentQuery == normalized else { return }
            people = page.data
            cursor = page.nextCursor
            hasMore = page.hasMore
        } catch is CancellationError {
            return
        } catch {
            guard currentQuery == normalized else { return }
            errorMessage = "People could not be loaded. Pull to try again."
        }
    }

    func loadMoreIfNeeded(after person: Person) async {
        guard person.id == people.last?.id, hasMore, !isLoadingMore, let cursor else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await dataSource.people(query: currentQuery, cursor: cursor)
            let existing = Set(people.map(\.id))
            people.append(contentsOf: page.data.filter { !existing.contains($0.id) })
            self.cursor = page.nextCursor
            hasMore = page.hasMore
        } catch {
            errorMessage = "More people could not be loaded."
        }
    }
}
