import test from "node:test";
import assert from "node:assert/strict";
import {
  LinearNotConfiguredError,
  parseIssueIdentifier,
  searchLinearIssues,
} from "./linear";

test("parseIssueIdentifier accepts a team key and number", () => {
  assert.deepEqual(parseIssueIdentifier("JF-157"), { teamKey: "JF", number: 157 });
  assert.deepEqual(parseIssueIdentifier("jf-1"), { teamKey: "JF", number: 1 });
});

test("parseIssueIdentifier rejects anything else", () => {
  assert.equal(parseIssueIdentifier("157"), null);
  assert.equal(parseIssueIdentifier("JF157"), null);
  assert.equal(parseIssueIdentifier(""), null);
});

test("Linear tools fail with a clear error when LINEAR_API_KEY is unset", async () => {
  const previous = process.env.LINEAR_API_KEY;
  delete process.env.LINEAR_API_KEY;
  try {
    await assert.rejects(searchLinearIssues({ query: "test" }), LinearNotConfiguredError);
  } finally {
    if (previous !== undefined) process.env.LINEAR_API_KEY = previous;
  }
});
