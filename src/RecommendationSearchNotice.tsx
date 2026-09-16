import { useEffect, useState } from "react";
import { FiInfo } from "react-icons/fi";
import type { Finding, PartCategory, RecommendationSearchSummary } from "../shared/types";
import { CATEGORY_LABELS } from "../shared/types";

export function RecommendationSearchNotice({ search, findings, onOpenPicker }: { search: RecommendationSearchSummary; findings: Finding[]; onOpenPicker: (category: PartCategory, findingRuleId?: string, findingTitle?: string, affectedPartIds?: string[]) => void }) {
  const precisionTargets = findings
    .filter((finding) => finding.severity !== "info")
    .flatMap((finding) => finding.actions
      .filter((action) => action.type === "replace_part" && action.targetCategory)
      .map((action) => ({
        key: `${finding.ruleId}:${action.targetCategory}`,
        ruleId: finding.ruleId,
        title: finding.title,
        category: action.targetCategory as PartCategory,
        affectedPartIds: finding.affectedPartIds
      })))
    .filter((target, index, all) => all.findIndex((candidate) => candidate.key === target.key) === index)
    .slice(0, 8);
  const [selectedTargetKey, setSelectedTargetKey] = useState(precisionTargets[0]?.key ?? "");
  useEffect(() => {
    if (!precisionTargets.some((target) => target.key === selectedTargetKey)) setSelectedTargetKey(precisionTargets[0]?.key ?? "");
  }, [precisionTargets, selectedTargetKey]);
  if (search.mode !== "bounded") return null;
  const selectedTarget = precisionTargets.find((target) => target.key === selectedTargetKey);
  return <div className="recommendation-search-note" data-testid="recommendation-search-note" role="note">
    <FiInfo />
    <span>부품이 많아 {search.candidateSetCount}개 문제별 묶음에서 확실한 조건을 먼저 확인한 뒤, 비교 범위와 점수를 반영한 유사도·가격 우선 부품 {search.evaluatedCandidateCount.toLocaleString("ko-KR")}개를 전체 호환 규칙으로 다시 검사했어요. 추천 부품은 실제 조립 환경과 제조사 페이지 확인을 대신하지 않아요.</span>
    <div className="recommendation-search-controls">
      <label><span>탐색 대상</span><select aria-label="검사 대상" value={selectedTargetKey} onChange={(event) => setSelectedTargetKey(event.target.value)}>{precisionTargets.map((target) => <option value={target.key} key={target.key}>{target.title} · {CATEGORY_LABELS[target.category]}</option>)}</select></label>
      <button className="text-button" type="button" disabled={!selectedTarget} onClick={() => { if (selectedTarget) onOpenPicker(selectedTarget.category, `precision:${selectedTarget.ruleId}`, selectedTarget.title, selectedTarget.affectedPartIds); }}>전체 부품 검사</button>
    </div>
  </div>;
}
