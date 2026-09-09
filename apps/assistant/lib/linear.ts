// Linear integration for the Assistant — lets the member manage their Linear
// work queue (docs/LINEAR_WORKFLOW.md) from chat/WhatsApp: search issues,
// read one, create one, move its status, reassign it, or comment on it.
//
// Uses Linear's GraphQL API directly (https://developers.linear.app/docs/graphql)
// with a personal API key (LINEAR_API_KEY) rather than the SDK, since the
// assistant only needs a handful of operations. The key is sent unprefixed —
// Linear personal API keys go in the Authorization header as-is, not as a
// Bearer token.

const LINEAR_API_URL = "https://api.linear.app/graphql";
const DEFAULT_TEAM_KEY = "JF";

export class LinearNotConfiguredError extends Error {
  constructor() {
    super(
      "Linear is not configured. Set LINEAR_API_KEY to a personal API key from https://linear.app/settings/account/security.",
    );
    this.name = "LinearNotConfiguredError";
  }
}

export class LinearApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinearApiError";
  }
}

async function linearGraphQL<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) throw new LinearNotConfiguredError();

  const response = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (body.errors?.length) {
    throw new LinearApiError(body.errors.map((e) => e.message).join("; "));
  }
  if (!response.ok || !body.data) {
    throw new LinearApiError(`Linear API request failed (${response.status})`);
  }
  return body.data;
}

// ── Team/state/user resolution ──────────────────────────────────────

type TeamRef = { id: string; key: string; name: string };

const teamCache = new Map<string, TeamRef>();

export async function resolveTeam(teamKey?: string): Promise<TeamRef> {
  const key = (teamKey ?? DEFAULT_TEAM_KEY).trim().toUpperCase();
  const cached = teamCache.get(key);
  if (cached) return cached;

  const data = await linearGraphQL<{
    teams: { nodes: TeamRef[] };
  }>(
    `query TeamByKey($key: String!) {
      teams(filter: { key: { eq: $key } }, first: 1) {
        nodes { id key name }
      }
    }`,
    { key },
  );
  const team = data.teams.nodes[0];
  if (!team) throw new LinearApiError(`No Linear team with key "${key}"`);
  teamCache.set(key, team);
  return team;
}

async function resolveWorkflowState(teamId: string, statusQuery: string) {
  const data = await linearGraphQL<{
    workflowStates: { nodes: Array<{ id: string; name: string; type: string }> };
  }>(
    `query StatesForTeam($teamId: ID!) {
      workflowStates(filter: { team: { id: { eq: $teamId } } }, first: 50) {
        nodes { id name type }
      }
    }`,
    { teamId },
  );
  const q = statusQuery.trim().toLowerCase().replace(/_/g, " ");
  const aliases: Record<string, string> = {
    todo: "todo",
    "to do": "todo",
    doing: "in progress",
    "in progress": "in progress",
    done: "done",
    completed: "done",
    backlog: "backlog",
    canceled: "canceled",
    cancelled: "canceled",
  };
  const normalized = aliases[q] ?? q;
  const match =
    data.workflowStates.nodes.find(
      (s) => s.name.toLowerCase() === normalized,
    ) ??
    data.workflowStates.nodes.find((s) =>
      s.name.toLowerCase().includes(normalized),
    );
  if (!match) {
    const available = data.workflowStates.nodes.map((s) => s.name).join(", ");
    throw new LinearApiError(
      `No workflow status matching "${statusQuery}". Available: ${available}`,
    );
  }
  return match;
}

async function resolveAssignee(nameOrEmail: string) {
  const q = nameOrEmail.trim();
  const data = await linearGraphQL<{
    users: { nodes: Array<{ id: string; name: string; email: string }> };
  }>(
    `query FindUser($q: String!) {
      users(
        filter: { or: [{ name: { containsIgnoreCase: $q } }, { email: { containsIgnoreCase: $q } }] }
        first: 5
      ) {
        nodes { id name email }
      }
    }`,
    { q },
  );
  const match = data.users.nodes[0];
  if (!match) throw new LinearApiError(`No Linear user matching "${nameOrEmail}"`);
  return match;
}

/** Parses "JF-157" into its team key and issue number. */
export function parseIssueIdentifier(identifier: string) {
  const match = identifier.trim().toUpperCase().match(/^([A-Z]+)-(\d+)$/);
  if (!match) return null;
  return { teamKey: match[1], number: Number(match[2]) };
}

// ── Public operations ────────────────────────────────────────────────

export type LinearIssueSummary = {
  id: string;
  identifier: string;
  title: string;
  url: string;
  priority: number;
  state: string;
  assignee: string | null;
  team: string;
  updatedAt: string;
};

const ISSUE_SUMMARY_FIELDS = `
  id identifier title url priority updatedAt
  state { name }
  assignee { name }
  team { key }
`;

function toSummary(node: {
  id: string;
  identifier: string;
  title: string;
  url: string;
  priority: number;
  updatedAt: string;
  state: { name: string };
  assignee: { name: string } | null;
  team: { key: string };
}): LinearIssueSummary {
  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    url: node.url,
    priority: node.priority,
    state: node.state.name,
    assignee: node.assignee?.name ?? null,
    team: node.team.key,
    updatedAt: node.updatedAt,
  };
}

export async function searchLinearIssues(input: {
  query?: string;
  assignedToMe?: boolean;
  status?: string;
  teamKey?: string;
  limit?: number;
}): Promise<LinearIssueSummary[]> {
  const limit = Math.min(25, Math.max(1, Math.round(input.limit ?? 10)));

  if (input.assignedToMe) {
    const data = await linearGraphQL<{
      viewer: {
        assignedIssues: {
          nodes: Array<Parameters<typeof toSummary>[0]>;
        };
      };
    }>(
      `query MyIssues($first: Int!) {
        viewer {
          assignedIssues(first: $first, orderBy: updatedAt) {
            nodes { ${ISSUE_SUMMARY_FIELDS} }
          }
        }
      }`,
      { first: limit },
    );
    return data.viewer.assignedIssues.nodes.map(toSummary);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filter: Record<string, any> = {};
  if (input.query?.trim()) {
    filter.or = [
      { title: { containsIgnoreCase: input.query.trim() } },
      { description: { containsIgnoreCase: input.query.trim() } },
    ];
  }
  if (input.teamKey?.trim()) {
    filter.team = { key: { eq: input.teamKey.trim().toUpperCase() } };
  }
  if (input.status?.trim()) {
    filter.state = { name: { containsIgnoreCase: input.status.trim() } };
  }

  const data = await linearGraphQL<{
    issues: { nodes: Array<Parameters<typeof toSummary>[0]> };
  }>(
    `query SearchIssues($filter: IssueFilter, $first: Int!) {
      issues(filter: $filter, first: $first, orderBy: updatedAt) {
        nodes { ${ISSUE_SUMMARY_FIELDS} }
      }
    }`,
    { filter: Object.keys(filter).length ? filter : undefined, first: limit },
  );
  return data.issues.nodes.map(toSummary);
}

export type LinearIssueDetail = LinearIssueSummary & {
  description: string | null;
  comments: Array<{ body: string; author: string | null; createdAt: string }>;
};

export async function getLinearIssue(
  identifier: string,
): Promise<LinearIssueDetail | null> {
  const parsed = parseIssueIdentifier(identifier);
  if (!parsed) throw new LinearApiError(`"${identifier}" isn't a Linear issue key like JF-157`);

  const data = await linearGraphQL<{
    issues: {
      nodes: Array<
        Parameters<typeof toSummary>[0] & {
          description: string | null;
          comments: { nodes: Array<{ body: string; user: { name: string } | null; createdAt: string }> };
        }
      >;
    };
  }>(
    `query IssueByNumber($teamKey: String!, $number: Float!) {
      issues(filter: { team: { key: { eq: $teamKey } }, number: { eq: $number } }, first: 1) {
        nodes {
          ${ISSUE_SUMMARY_FIELDS}
          description
          comments(first: 10, orderBy: createdAt) {
            nodes { body createdAt user { name } }
          }
        }
      }
    }`,
    { teamKey: parsed.teamKey, number: parsed.number },
  );
  const node = data.issues.nodes[0];
  if (!node) return null;
  return {
    ...toSummary(node),
    description: node.description,
    comments: node.comments.nodes.map((c) => ({
      body: c.body,
      author: c.user?.name ?? null,
      createdAt: c.createdAt,
    })),
  };
}

export async function createLinearIssue(input: {
  title: string;
  description?: string;
  teamKey?: string;
  priority?: number;
  assignee?: string;
  status?: string;
}): Promise<LinearIssueSummary> {
  const team = await resolveTeam(input.teamKey);
  const [assignee, state] = await Promise.all([
    input.assignee ? resolveAssignee(input.assignee) : Promise.resolve(null),
    input.status ? resolveWorkflowState(team.id, input.status) : Promise.resolve(null),
  ]);

  const data = await linearGraphQL<{
    issueCreate: {
      success: boolean;
      issue: Parameters<typeof toSummary>[0];
    };
  }>(
    `mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { ${ISSUE_SUMMARY_FIELDS} }
      }
    }`,
    {
      input: {
        teamId: team.id,
        title: input.title,
        description: input.description,
        priority: input.priority,
        assigneeId: assignee?.id,
        stateId: state?.id,
      },
    },
  );
  if (!data.issueCreate.success) throw new LinearApiError("Linear rejected the issue create");
  return toSummary(data.issueCreate.issue);
}

export async function updateLinearIssue(input: {
  identifier: string;
  status?: string;
  assignee?: string;
  priority?: number;
}): Promise<LinearIssueSummary> {
  const parsed = parseIssueIdentifier(input.identifier);
  if (!parsed) throw new LinearApiError(`"${input.identifier}" isn't a Linear issue key like JF-157`);

  const [team, existing] = await Promise.all([
    resolveTeam(parsed.teamKey),
    getLinearIssue(input.identifier),
  ]);
  if (!existing) throw new LinearApiError(`No Linear issue ${input.identifier}`);

  const [assignee, state] = await Promise.all([
    input.assignee ? resolveAssignee(input.assignee) : Promise.resolve(null),
    input.status ? resolveWorkflowState(team.id, input.status) : Promise.resolve(null),
  ]);

  const data = await linearGraphQL<{
    issueUpdate: {
      success: boolean;
      issue: Parameters<typeof toSummary>[0];
    };
  }>(
    `mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue { ${ISSUE_SUMMARY_FIELDS} }
      }
    }`,
    {
      id: existing.id,
      input: {
        ...(assignee ? { assigneeId: assignee.id } : {}),
        ...(state ? { stateId: state.id } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
      },
    },
  );
  if (!data.issueUpdate.success) throw new LinearApiError("Linear rejected the issue update");
  return toSummary(data.issueUpdate.issue);
}

export async function addLinearComment(input: {
  identifier: string;
  body: string;
}): Promise<{ url: string }> {
  const existing = await getLinearIssue(input.identifier);
  if (!existing) throw new LinearApiError(`No Linear issue ${input.identifier}`);

  const data = await linearGraphQL<{
    commentCreate: { success: boolean };
  }>(
    `mutation AddComment($input: CommentCreateInput!) {
      commentCreate(input: $input) { success }
    }`,
    { input: { issueId: existing.id, body: input.body } },
  );
  if (!data.commentCreate.success) throw new LinearApiError("Linear rejected the comment");
  return { url: existing.url };
}
