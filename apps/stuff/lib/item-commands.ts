import {
  createItem as sharedCreateItem,
  deleteItem as sharedDeleteItem,
  updateItem as sharedUpdateItem,
  type AuditActor,
  type GraphEventActor,
  type ItemCreateData,
  type ItemUpdateData,
} from "@life-os/domain"
import { runRulesForTarget } from "@life-os/automation"

export type ItemCommandActor = GraphEventActor & AuditActor

export async function fireItemCreateRules(
  item: { id: string; name: string; assetId: string },
  workspaceId: string,
  actor?: ItemCommandActor,
) {
  const ruleActor = actor ?? { type: "system" as const, workspaceId }
  await runRulesForTarget({
    trigger: "item.create",
    targetType: "item",
    targetId: item.id,
    payload: { itemId: item.id, name: item.name, assetId: item.assetId },
    actor: ruleActor,
  })
}

export async function fireItemUpdateRules(
  itemId: string,
  fields: string[],
  workspaceId: string,
  actor?: ItemCommandActor,
) {
  const ruleActor = actor ?? { type: "system" as const, workspaceId }
  await runRulesForTarget({
    trigger: "item.update",
    targetType: "item",
    targetId: itemId,
    payload: { itemId, fields },
    actor: ruleActor,
  })
}

export async function createItem(data: ItemCreateData, workspaceId: string, actor?: ItemCommandActor) {
  const item = await sharedCreateItem(data, workspaceId, actor)
  await fireItemCreateRules(item, workspaceId, actor)
  return item
}

export async function updateItem(id: string, data: ItemUpdateData, workspaceId: string, actor?: ItemCommandActor) {
  const item = await sharedUpdateItem(id, data, workspaceId, actor)
  await fireItemUpdateRules(id, Object.keys(data), workspaceId, actor)
  return item
}

export function deleteItem(id: string, workspaceId: string, actor?: ItemCommandActor) {
  return sharedDeleteItem(id, workspaceId, actor)
}
