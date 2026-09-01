export function checklistItemIdsForAction(actionId: string) {
  if (actionId.startsWith("finding:") || actionId.startsWith("accessory:") || actionId.startsWith("data-") || actionId.startsWith("connectivity:") || actionId === "price:total" || actionId === "repair:best-plan") return [actionId];
  if (actionId === "physical:gpu-case") return ["manual:gpu-physical-evidence", "manual:physical-clearance"];
  if (actionId === "physical:psu-cable") return ["manual:pcie-cable-topology", "manual:power-cabling"];
  if (actionId === "assembly:final-check") return ["manual:post-build-test", "manual:manufacturer-support"];
  return [];
}

export function actionChecklistIdsFor(actionId: string, availableChecklistIds: ReadonlySet<string>) {
  return checklistItemIdsForAction(actionId).filter((id) => availableChecklistIds.has(id));
}

export function actionChecklistCheckedFor(actionId: string, availableChecklistIds: ReadonlySet<string>, checkedChecklistIds: ReadonlySet<string>) {
  const checklistIds = actionChecklistIdsFor(actionId, availableChecklistIds);
  return checklistIds.length > 0 && checklistIds.some((id) => checkedChecklistIds.has(id));
}

export function actionChecklistProgressFor(actions: ReadonlyArray<{ id: string }>, availableChecklistIds: ReadonlySet<string>, checkedChecklistIds: ReadonlySet<string>) {
  const trackedActions = actions.filter((action) => actionChecklistIdsFor(action.id, availableChecklistIds).length > 0);
  const checked = trackedActions.filter((action) => actionChecklistCheckedFor(action.id, availableChecklistIds, checkedChecklistIds)).length;
  return { total: trackedActions.length, checked, percent: trackedActions.length === 0 ? 0 : Math.round((checked / trackedActions.length) * 100) };
}

export function checkedChecklistIdsAfterAction(currentChecklistIds: ReadonlyArray<string>, actionId: string, availableChecklistIds: ReadonlySet<string>, checked: boolean) {
  const next = new Set(currentChecklistIds);
  actionChecklistIdsFor(actionId, availableChecklistIds).forEach((id) => checked ? next.add(id) : next.delete(id));
  return Array.from(next).slice(0, 100);
}
