const baseUrl = (process.env.PC_SUPPORTER_API_BASE_URL ?? "http://127.0.0.1:4174").replace(/\/+$/, "");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function jsonResponse(url, init) {
  const response = await fetch(url, init);
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  return { response, payload };
}

const metaResult = await jsonResponse(`${baseUrl}/api/meta`);
assert(metaResult.response.ok && metaResult.payload?.storageMode === "postgres", `PostgreSQL 저장소가 활성화되지 않았습니다. storageMode=${metaResult.payload?.storageMode ?? "missing"}`);

function normalizeSelection(selection) {
  return selection ? { partId: selection.partId, quantity: selection.quantity } : null;
}

function normalizeSelections(selections) {
  return (selections ?? []).map((selection) => normalizeSelection(selection));
}

function normalizeAccessorySelections(selections) {
  return (selections ?? []).map((selection) => ({
    partId: selection.accessoryId,
    quantity: selection.quantity,
    targetPartId: selection.targetPartId ?? null,
    targetAccessoryId: selection.targetAccessoryId ?? null
  }));
}

function normalizeSlotSelection(selection) {
  return Object.entries(selection ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([slotId, partId]) => [slotId, partId]);
}

// Keep the external smoke input identical to the shared fingerprint contract.
function buildFingerprintFor(build, preferences) {
  return JSON.stringify({
    build: {
      cpu: normalizeSelection(build.cpu),
      cooler: normalizeSelection(build.cooler),
      motherboard: normalizeSelection(build.motherboard),
      memory: normalizeSelections(build.memory),
      gpu: normalizeSelection(build.gpu),
      ssd: normalizeSelections(build.ssd),
      hdd: normalizeSelections(build.hdd),
      case: normalizeSelection(build.case),
      psu: normalizeSelection(build.psu),
      accessories: normalizeAccessorySelections(build.accessories),
      m2SlotSelection: normalizeSlotSelection(build.m2SlotSelection),
      rgbControllerAccessoryId: build.rgbControllerAccessoryId ?? null,
      useIntegratedGraphics: build.useIntegratedGraphics
    },
    recommendationPreferences: {
      profile: preferences.profile,
      priority: preferences.priority,
      listingPolicy: preferences.listingPolicy ?? "retail_only",
      budgetWon: preferences.budgetWon ?? null,
      gamingResolution: preferences.gamingResolution ?? null,
      gamingRefreshRate: preferences.profile === "gaming" ? preferences.gamingRefreshRate ?? 144 : null
    }
  });
}

const selection = {
  cpu: { partId: "cpu-7500f", quantity: 1 },
  cooler: { partId: "cooler-tower-am5-1700", quantity: 1 },
  motherboard: { partId: "mb-b650-4x3", quantity: 1 },
  memory: [{ partId: "memory-ddr5-16-5600", quantity: 2 }],
  gpu: { partId: "gpu-rtx-4060", quantity: 1 },
  ssd: [{ partId: "ssd-nvme-1tb", quantity: 1 }],
  hdd: [],
  case: { partId: "case-compact-matx", quantity: 1 },
  psu: { partId: "psu-650w", quantity: 1 },
  accessories: [],
  useIntegratedGraphics: true
};

const preferences = {
  profile: "gaming",
  priority: "balanced",
  listingPolicy: "retail_only",
  budgetWon: 1_500_000,
  gamingResolution: "1080p",
  gamingRefreshRate: 144
};
const inputFingerprint = buildFingerprintFor(selection, preferences);
const rowKeys = ["row:cpu", "row:gpu"];
let created;

function ownerHeaders() {
  return { "Content-Type": "application/json", "X-Share-Owner-Token": created.ownerToken };
}

try {
  const createResult = await jsonResponse(`${baseUrl}/api/builds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "PostgreSQL 저장 견적 smoke",
      decisionNote: "실제 PostgreSQL에서 선택 이유와 구매 상태를 복원해야 합니다.",
      selection,
      recommendationPreferences: preferences
    })
  });
  created = createResult.payload;
  assert(createResult.response.status === 201 && typeof created?.id === "string" && typeof created?.ownerToken === "string", `저장 견적을 생성하지 못했습니다. status=${createResult.response.status}`);

  const buildUrl = `${baseUrl}/api/builds/${encodeURIComponent(created.id)}`;
  const initialResult = await jsonResponse(buildUrl);
  assert(initialResult.response.ok, `저장 견적을 생성 후 재조회하지 못했습니다. status=${initialResult.response.status}`);
  assert(initialResult.payload?.decisionNote === "실제 PostgreSQL에서 선택 이유와 구매 상태를 복원해야 합니다.", "생성 시 선택 이유가 복원되지 않았습니다.");
  assert(initialResult.payload?.checkSnapshot?.engineVersion === created.checkSnapshot?.engineVersion, "생성 시 검사 snapshot이 저장되지 않았습니다.");
  assert(!Object.hasOwn(initialResult.payload, "ownerToken") && !Object.hasOwn(initialResult.payload, "ownerTokenHash"), "공개 저장 견적 응답에 owner credential이 포함되었습니다.");

  const patchResult = await jsonResponse(buildUrl, {
    method: "PATCH",
    headers: ownerHeaders(),
    body: JSON.stringify({ name: "PostgreSQL 저장 견적 smoke · 수정", decisionNote: "수정된 선택 이유도 metadata history에 남아야 합니다." })
  });
  assert(patchResult.response.ok && patchResult.payload?.name === "PostgreSQL 저장 견적 smoke · 수정" && patchResult.payload?.decisionNote === "수정된 선택 이유도 metadata history에 남아야 합니다.", `저장 견적 metadata를 수정하지 못했습니다. status=${patchResult.response.status}`);

  const metadataHistoryResult = await jsonResponse(`${buildUrl}/metadata-history`, { headers: ownerHeaders() });
  assert(metadataHistoryResult.response.ok && metadataHistoryResult.payload?.total === 1, "metadata history가 PostgreSQL에서 복원되지 않았습니다.");
  assert(metadataHistoryResult.payload.items[0]?.previousName === "PostgreSQL 저장 견적 smoke" && metadataHistoryResult.payload.items[0]?.nextName === "PostgreSQL 저장 견적 smoke · 수정", "metadata history의 이전·현재 이름이 일치하지 않습니다.");

  const progressBase = {
    inputFingerprint,
    rowKeys,
    checkedIds: ["row:cpu"],
    itemStates: [
      { rowKey: "row:cpu", status: "received", updatedAt: "2026-09-05T01:00:00.000Z" },
      { rowKey: "row:gpu", status: "ordered", updatedAt: "2026-09-05T01:00:00.000Z" }
    ]
  };
  const progressFirstResult = await jsonResponse(`${buildUrl}/purchase-progress`, {
    method: "PUT",
    headers: ownerHeaders(),
    body: JSON.stringify({ progress: progressBase })
  });
  assert(progressFirstResult.response.ok && progressFirstResult.payload?.purchaseProgress?.revision === 1, `구매 진행률 첫 revision 저장에 실패했습니다. status=${progressFirstResult.response.status}`);

  const progressSecondResult = await jsonResponse(`${buildUrl}/purchase-progress`, {
    method: "PUT",
    headers: ownerHeaders(),
    body: JSON.stringify({
      expectedRevision: 1,
      progress: {
        ...progressBase,
        checkedIds: rowKeys,
        itemStates: progressBase.itemStates.map((item) => ({ ...item, status: "received" }))
      }
    })
  });
  assert(progressSecondResult.response.ok && progressSecondResult.payload?.purchaseProgress?.revision === 2 && progressSecondResult.payload.purchaseProgress.history?.some((entry) => entry.revision === 1), "구매 진행률 revision/history가 PostgreSQL에서 보존되지 않았습니다.");

  const priceBase = {
    inputFingerprint,
    rowKeys,
    priceHistory: {
      "row:cpu": [{ checkedAt: "2026-09-05T01:00:00.000Z", unitPriceWon: 182000 }],
      "row:gpu": [{ checkedAt: "2026-09-05T01:00:00.000Z", unitPriceWon: 420000 }]
    }
  };
  const priceFirstResult = await jsonResponse(`${buildUrl}/purchase-price-history`, {
    method: "PUT",
    headers: ownerHeaders(),
    body: JSON.stringify({ priceHistory: priceBase })
  });
  assert(priceFirstResult.response.ok && priceFirstResult.payload?.purchasePriceHistory?.revision === 1, `가격 이력 첫 revision 저장에 실패했습니다. status=${priceFirstResult.response.status}`);

  const priceSecondResult = await jsonResponse(`${buildUrl}/purchase-price-history`, {
    method: "PUT",
    headers: ownerHeaders(),
    body: JSON.stringify({
      expectedRevision: 1,
      priceHistory: {
        ...priceBase,
        priceHistory: {
          "row:cpu": [...priceBase.priceHistory["row:cpu"], { checkedAt: "2026-09-05T02:00:00.000Z", unitPriceWon: 179000 }],
          "row:gpu": [...priceBase.priceHistory["row:gpu"], { checkedAt: "2026-09-05T02:00:00.000Z", unitPriceWon: 415000 }]
        }
      }
    })
  });
  assert(priceSecondResult.response.ok && priceSecondResult.payload?.purchasePriceHistory?.revision === 2 && priceSecondResult.payload.purchasePriceHistory.history?.some((entry) => entry.revision === 1), "가격 이력 revision/history가 PostgreSQL에서 보존되지 않았습니다.");

  const restoredResult = await jsonResponse(buildUrl);
  const restored = restoredResult.payload;
  assert(restoredResult.response.ok, `최종 저장 견적 재조회에 실패했습니다. status=${restoredResult.response.status}`);
  assert(restored.name === "PostgreSQL 저장 견적 smoke · 수정" && restored.decisionNote === "수정된 선택 이유도 metadata history에 남아야 합니다.", "최종 metadata가 PostgreSQL에서 복원되지 않았습니다.");
  assert(restored.purchaseProgress?.revision === 2 && restored.purchaseProgress.itemStates?.every((item) => item.status === "received"), "최종 구매 진행률 상태가 복원되지 않았습니다.");
  assert(restored.purchasePriceHistory?.revision === 2 && restored.purchasePriceHistory.priceHistory?.["row:gpu"]?.at(-1)?.unitPriceWon === 415000, "최종 가격 확인 이력이 복원되지 않았습니다.");
  assert(!Object.hasOwn(restored, "ownerToken") && !Object.hasOwn(restored, "ownerTokenHash"), "최종 공개 응답에 owner credential이 포함되었습니다.");

  console.log(JSON.stringify({
    ok: true,
    storageMode: metaResult.payload.storageMode,
    savedBuildId: created.id,
    restored: {
      name: restored.name,
      metadataHistoryCount: metadataHistoryResult.payload.total,
      purchaseProgressRevision: restored.purchaseProgress.revision,
      purchaseProgressHistoryCount: restored.purchaseProgress.history?.length ?? 0,
      purchasePriceHistoryRevision: restored.purchasePriceHistory.revision,
      purchasePriceHistoryHistoryCount: restored.purchasePriceHistory.history?.length ?? 0,
      gpuLatestPriceWon: restored.purchasePriceHistory.priceHistory["row:gpu"].at(-1).unitPriceWon
    }
  }, null, 2));
} finally {
  if (created?.id && created?.ownerToken) {
    const deleted = await fetch(`${baseUrl}/api/builds/${encodeURIComponent(created.id)}`, {
      method: "DELETE",
      headers: { "X-Share-Owner-Token": created.ownerToken }
    });
    assert(deleted.ok, `smoke 저장 견적 정리에 실패했습니다. status=${deleted.status}`);
  }
}
