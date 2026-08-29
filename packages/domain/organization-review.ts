import { registerReviewCommand } from "./review";
import { setInteractionGroup } from "./organizations";

let registered = false;

// Accepting a merchant→organization association does two things, and the second
// is the point: it attributes the interactions that prompted the question, and it
// records a Rule so the same judgement is never made again.
//
// Rules are created in "suggest" mode rather than "auto". A learned rule is
// durable — a wrong one keeps being wrong, quietly — and brand-to-parent is
// exactly where that bites (MAC and Clinique are Estée Lauder; Sephora is LVMH).
// Suggest mode turns a wrong guess into a second review instead of a silent mess;
// promote it once it has proven itself.
export function registerOrganizationReviewHandlers() {
  if (registered) return;
  registered = true;

  registerReviewCommand(
    "attributeMerchantToOrganization",
    async (input, context) => {
      const { db } = await import("@life-os/db");
      const groupId = String(input.groupId ?? "");
      const merchant = String(input.merchant ?? "").trim();
      if (!groupId || !merchant)
        throw new Error("A merchant and organization are required");

      const group = await db.group.findFirst({
        where: { id: groupId, workspaceId: context.workspaceId },
        select: { id: true, name: true },
      });
      if (!group) throw new Error("Organization not found");

      // Sweep the interactions this merchant string covers. One GraphEvent per
      // interaction, never one per batch — a single wrong row has to be traceable
      // and reversible on its own.
      const matches = await db.interaction.findMany({
        where: {
          workspaceId: context.workspaceId,
          type: "financial",
          summary: { contains: merchant, mode: "insensitive" as const },
        },
        select: { id: true },
      });
      for (const match of matches) {
        await setInteractionGroup(
          match.id,
          group.id,
          context.workspaceId,
          context.actor,
        );
      }

      await db.rule.create({
        data: {
          workspaceId: context.workspaceId,
          name: `Attribute "${merchant}" to ${group.name}`,
          description: `Learned from a review decision on ${new Date().toISOString().slice(0, 10)}. Attributes financial interactions whose summary contains "${merchant}".`,
          trigger: "interaction.create",
          mode: "suggest",
          status: "active",
          conditions: JSON.stringify([
            { field: "summary", operator: "contains", value: merchant },
          ]),
          actions: JSON.stringify([
            { type: "set_interaction_group", value: group.id },
          ]),
          createdByUserId: context.actor?.id ?? null,
        },
      });

      return { resultType: "Group", resultId: group.id };
    },
  );
}

/**
 * How many interactions a proposed merchant rule would touch. Shown before the
 * rule is created: "this will attribute 412 past transactions to Estée Lauder"
 * is the difference between an informed decision and a shrug.
 */
export async function merchantAttributionBlastRadius(
  merchant: string,
  workspaceId = "default-workspace",
) {
  const { db } = await import("@life-os/db");
  const trimmed = merchant.trim();
  if (!trimmed)
    return { interactions: 0, totalAmount: 0, alreadyAttributed: 0 };
  const [all, attributed] = await Promise.all([
    db.interaction.aggregate({
      where: {
        workspaceId,
        type: "financial",
        summary: { contains: trimmed, mode: "insensitive" as const },
      },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    db.interaction.count({
      where: {
        workspaceId,
        type: "financial",
        summary: { contains: trimmed, mode: "insensitive" as const },
        groupId: { not: null },
      },
    }),
  ]);
  return {
    interactions: all._count._all,
    totalAmount: all._sum.amount ?? 0,
    // Already-attributed rows would be *re*-attributed, which is the riskier half
    // of the change and worth surfacing separately.
    alreadyAttributed: attributed,
  };
}
