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

const health = await jsonResponse(`${baseUrl}/api/health`);
assert(health.response.ok && typeof health.payload?.engineVersion === "string", `health 응답을 확인하지 못했습니다. status=${health.response.status}`);

const meta = await jsonResponse(`${baseUrl}/api/meta`);
assert(meta.response.ok && meta.payload?.storageMode === "postgres", `PostgreSQL 저장소가 활성화되지 않았습니다. storageMode=${meta.payload?.storageMode ?? "missing"}`);

const input = {
  name: "PostgreSQL 후보 비교 smoke",
  category: "그래픽카드",
  currentPartName: "기존 GPU",
  currentPartSummary: "PCIe 4.0 · VRAM 8GB",
  currentPartPrice: "450,000원",
  catalogSnapshotAt: "2026-09-05T01:02:03.000Z",
  engineVersion: health.payload.engineVersion,
  candidates: [
    {
      name: "PostgreSQL 후보 1",
      category: "gpu",
      partId: "postgres-smoke-gpu-1",
      summary: "12GB · 220W · 244mm",
      price: "899,000원",
      priceWon: 899000,
      similarity: "동급 88점",
      performance: "비교 근거 확인",
      compatibility: "호환 가능",
      dataQuality: "수동 검수"
    },
    {
      name: "PostgreSQL 후보 2",
      category: "gpu",
      partId: "postgres-smoke-gpu-2",
      summary: "16GB · 250W · 300mm",
      price: "999,000원",
      priceWon: 999000,
      similarity: "유사 82점",
      performance: "비교 근거 확인",
      compatibility: "확인 필요",
      dataQuality: "수동 검수"
    }
  ],
  expiresInDays: 7
};

let created;
try {
  const createdResult = await jsonResponse(`${baseUrl}/api/comparisons`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  created = createdResult.payload;
  assert(createdResult.response.status === 201 && typeof created?.id === "string" && typeof created?.ownerToken === "string", `후보 비교를 저장하지 못했습니다. status=${createdResult.response.status}`);

  const comparisonUrl = `${baseUrl}/api/comparisons/${encodeURIComponent(created.id)}`;
  const restoredResult = await jsonResponse(comparisonUrl);
  const restored = restoredResult.payload;
  assert(restoredResult.response.ok, `후보 비교를 재조회하지 못했습니다. status=${restoredResult.response.status}`);
  for (const field of ["name", "currentPartName", "currentPartSummary", "currentPartPrice", "catalogSnapshotAt", "engineVersion"]) {
    assert(restored[field] === input[field], `${field}가 저장 후 달라졌습니다. expected=${input[field]} actual=${restored[field]}`);
  }
  assert(restored.candidates?.length === 2 && restored.candidates[0]?.partId === "postgres-smoke-gpu-1", "후보 목록이 저장 후 복원되지 않았습니다.");
  assert(!Object.hasOwn(restored, "ownerToken") && !Object.hasOwn(restored, "ownerTokenHash"), "공개 후보 비교 응답에 owner credential이 포함되었습니다.");

  console.log(JSON.stringify({
    ok: true,
    storageMode: meta.payload.storageMode,
    comparisonId: created.id,
    restored: {
      currentPartName: restored.currentPartName,
      currentPartSummary: restored.currentPartSummary,
      currentPartPrice: restored.currentPartPrice,
      engineVersion: restored.engineVersion,
      candidateCount: restored.candidates.length
    }
  }, null, 2));
} finally {
  if (created?.id && created?.ownerToken) {
    const deleted = await fetch(`${baseUrl}/api/comparisons/${encodeURIComponent(created.id)}`, {
      method: "DELETE",
      headers: { "X-Share-Owner-Token": created.ownerToken }
    });
    assert(deleted.ok, `smoke 후보 비교 정리에 실패했습니다. status=${deleted.status}`);
  }
}
