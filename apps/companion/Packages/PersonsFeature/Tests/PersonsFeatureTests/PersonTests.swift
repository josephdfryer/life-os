import Foundation
import Testing
@testable import PersonsFeature

@Test func decodesCanonicalPersonResource() throws {
    let data = Data(#"{"id":"person-1","createdAt":"2026-08-15T12:00:00.000Z","updatedAt":"2026-08-15T12:00:00.000Z","first":"Ada","last":"Lovelace","nickname":null,"title":"Countess","headline":"Mathematician","company":null,"emails":["ada@example.com"],"phones":[],"birthday":null,"closeness":4,"tags":["friend"],"values":[],"notes":null,"location":"London","linkedin":null,"twitter":null,"website":null,"facebook":null,"instagram":null,"color":null,"colorSoft":null}"#.utf8)
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    let person = try decoder.decode(Person.self, from: data)
    #expect(person.displayName == "Ada Lovelace")
    #expect(person.initials == "AL")
    #expect(person.contextLine == "Mathematician")
}
