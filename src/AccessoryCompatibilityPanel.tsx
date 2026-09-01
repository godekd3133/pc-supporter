import { FiAlertTriangle, FiCheckCircle, FiInfo, FiTool, FiXCircle } from "react-icons/fi";
import type { AccessoryCompatibilityFinding, AccessoryCompatibilityResult, AccessoryConnectivityPlan, AccessoryFanHubTargetRecommendation, AccessoryPowerRail, AccessoryRgbConnectionPlan } from "../shared/types";

function severityLabel(severity: AccessoryCompatibilityFinding["severity"]) {
  return severity === "blocker" ? "차단" : severity === "warning" ? "주의" : "확인 필요";
}

function severityIcon(severity: AccessoryCompatibilityFinding["severity"]) {
  return severity === "blocker" ? FiXCircle : severity === "warning" ? FiAlertTriangle : FiInfo;
}

function statusLabel(status: AccessoryCompatibilityResult["status"]) {
  return status === "compatible" ? "호환 확인" : status === "incompatible" ? "주변 부품 구매 보류" : "주변 부품 확인 필요";
}

function planStatusLabel(status: AccessoryConnectivityPlan["status"]) {
  return status === "pass" ? "연결 계획 확인" : status === "blocked" ? "연결 계획 차단" : "연결 계획 확인 필요";
}

function planCurrentText(plan: AccessoryConnectivityPlan) {
  if (plan.totalCurrentA !== undefined && plan.maxFanCurrentA !== undefined) {
    const headroom = plan.currentHeadroomA ?? plan.maxFanCurrentA - plan.totalCurrentA;
    return `${plan.totalCurrentA.toFixed(2)}A / ${plan.maxFanCurrentA.toFixed(2)}A · ${headroom >= 0 ? `${headroom.toFixed(2)}A 여유` : `${Math.abs(headroom).toFixed(2)}A 초과`}`;
  }
  return plan.maxFanCurrentA !== undefined ? `허브 최대 ${plan.maxFanCurrentA.toFixed(2)}A · 팬별 전류 확인 필요` : "전류 근거 확인 필요";
}

function powerRailRoleLabel(role: AccessoryPowerRail["role"]) {
  return role === "fan" ? "팬" : role === "rgb" ? "RGB" : role === "shared" ? "공용" : "역할 확인 필요";
}

function powerRailText(powerRails?: AccessoryPowerRail[]) {
  if (!powerRails || powerRails.length === 0) return "전원 레일 원문 확인 필요";
  return powerRails.map((rail) => {
    const measurements = [
      rail.maxPowerW !== undefined ? `${rail.maxPowerW.toFixed(2)}W` : undefined,
      rail.maxCurrentA !== undefined ? `${rail.maxCurrentA.toFixed(2)}A` : undefined
    ].filter(Boolean).join(" · ");
    return `${rail.voltage} ${powerRailRoleLabel(rail.role)}${measurements ? ` · ${measurements}` : " · 용량 확인 필요"}`;
  }).join(" / ");
}

function planPortText(plan: AccessoryConnectivityPlan) {
  if (plan.portIssue === "unknown") return "허브 포트 수 확인 필요";
  if (plan.portIssue === "over_limit") return `${plan.assignedFanCount ?? 0}/${plan.hubFanPortCount ?? "?"} 사용 · ${plan.unassignedFanCount ?? "?"}개 미배치`;
  return `${plan.assignedFanCount ?? plan.fanCount}/${plan.hubFanPortCount ?? "?"} 사용 · 여유 ${Math.max(0, (plan.hubFanPortCount ?? 0) - (plan.assignedFanCount ?? plan.fanCount))}개`;
}

function rgbLoadText(plan: AccessoryRgbConnectionPlan) {
  if (plan.rgbLoadStatus === "unknown") return plan.rgbPerDeviceCurrentA !== undefined || plan.rgbPerDevicePowerW !== undefined ? "컨트롤러 레일 용량 확인 필요" : "장치당 부하 확인 필요";
  if (plan.rgbPowerHeadroomW !== undefined && plan.rgbTotalPowerW !== undefined) {
    return `${plan.rgbTotalPowerW.toFixed(2)}W · ${plan.rgbPowerHeadroomW >= 0 ? `${plan.rgbPowerHeadroomW.toFixed(2)}W 여유` : `${Math.abs(plan.rgbPowerHeadroomW).toFixed(2)}W 초과`}`;
  }
  if (plan.rgbCurrentHeadroomA !== undefined && plan.rgbTotalCurrentA !== undefined) {
    return `${plan.rgbTotalCurrentA.toFixed(2)}A · ${plan.rgbCurrentHeadroomA >= 0 ? `${plan.rgbCurrentHeadroomA.toFixed(2)}A 여유` : `${Math.abs(plan.rgbCurrentHeadroomA).toFixed(2)}A 초과`}`;
  }
  return "RGB 부하 확인 필요";
}

function rgbLoadEvidenceText(plan: AccessoryRgbConnectionPlan) {
  if (plan.rgbLoadStatus === "over_limit") return "RGB 장치 부하가 해당 전원 레일 한도를 초과했습니다.";
  if (plan.rgbLoadStatus === "known") return "장치당 RGB 부하와 해당 전원 레일 한도를 함께 계산했습니다.";
  return "RGB 장치 소비전력 원문이 없으면 5V/12V 레일 여유를 계산하지 않습니다.";
}

function targetCandidateStatusLabel(status: AccessoryFanHubTargetRecommendation["candidates"][number]["status"]) {
  return status === "pass" ? "추천" : status === "blocked" ? "차단" : "확인 필요";
}

function FanHubTargetRecommendationCard({ recommendation, onAssign }: { recommendation: AccessoryFanHubTargetRecommendation; onAssign?: (fanId: string, hubId: string) => void }) {
  return <article className="accessory-hub-target-recommendation"><div className="accessory-hub-target-recommendation-heading"><div><strong>{recommendation.fanName}</strong><small>추가 팬 {recommendation.fanCount}개 · 연결 대상 미지정</small></div><span>{recommendation.recommendedHubId ? "추천 후보 있음" : recommendation.suggestedHubId ? "우선 후보 있음" : "허브 비교 필요"}</span></div><p>{recommendation.summary}</p><div className="accessory-hub-target-candidates">{recommendation.candidates.length === 0 ? <small>현재 선택한 허브가 없습니다.</small> : recommendation.candidates.map((candidate) => <div key={candidate.hubId}><div><strong>{candidate.hubName}</strong><span className={candidate.status}>{targetCandidateStatusLabel(candidate.status)}</span></div><small>{candidate.reason}</small>{onAssign && candidate.status !== "blocked" && <button className="text-button" type="button" onClick={() => onAssign(recommendation.fanId, candidate.hubId)}>{candidate.hubId === recommendation.recommendedHubId ? "추천 허브 지정" : candidate.hubId === recommendation.suggestedHubId ? "우선 후보 지정" : "이 허브 지정"}</button>}</div>)}</div></article>;
}

function AccessoryConnectionPlanCard({ plan }: { plan: AccessoryConnectivityPlan }) {
  return <article className={`accessory-connection-plan ${plan.status}`}>
    <div className="accessory-connection-plan-heading"><div><strong>{plan.hubName}</strong><small>허브 출력 · {plan.hubFanOutputs.join(" · ") || "확인 필요"}</small></div><span>{planStatusLabel(plan.status)}</span></div>
    <div className="accessory-connection-plan-facts"><div><span>팬 연결 수</span><strong>{plan.fanCount}개</strong></div><div><span>포트 배치</span><strong>{planPortText(plan)}</strong></div><div><span>외부 전원</span><strong>{plan.externalPower ?? "확인 필요"}</strong></div><div><span>전류 계획</span><strong>{planCurrentText(plan)}</strong></div><div><span>전원 레일 (원문)</span><strong title={powerRailText(plan.powerRails)}>{powerRailText(plan.powerRails)}</strong></div></div>
    {plan.portAssignments.length > 0 && <div className="accessory-connection-plan-ports"><span>출력 배치</span>{plan.portAssignments.map((assignment) => <div key={`${assignment.accessoryId}-${assignment.portStart}`}><strong>{assignment.portStart === assignment.portEnd ? `P${assignment.portStart}` : `P${assignment.portStart}–P${assignment.portEnd}`}</strong><span>{assignment.name}{assignment.fanCount > 1 ? ` · ${assignment.fanCount}개` : ""}</span></div>)}</div>}
    {plan.unassignedFanCount !== undefined && plan.unassignedFanCount > 0 && <div className="accessory-connection-plan-unassigned">미배치 팬 {plan.unassignedFanCount}개{plan.unassignedFanNames && plan.unassignedFanNames.length > 0 ? ` · ${plan.unassignedFanNames.join(" · ")}` : ""}</div>}
    <div className="accessory-connection-plan-fans">{plan.fans.map((fan) => <div key={fan.accessoryId}><span>{fan.name}{fan.quantity > 1 ? ` ×${fan.quantity}` : ""}{fan.unitCount > 1 ? ` · ${fan.unitCount}개/상품` : ""}</span><small>{fan.connectorTypes.join(" · ")}{fan.currentA !== undefined ? ` · ${fan.currentA.toFixed(2)}A/팬` : " · 소비전류 확인 필요"}{fan.currentProvenance ? ` · 근거 ${fan.currentProvenance.manufacturerModel}` : ""}</small></div>)}</div>
    <p>{plan.summary}</p><small className="accessory-connection-plan-evidence">팬별 소비전류 근거가 없으면 12V 레일 여유를 계산하지 않습니다.</small>
  </article>;
}

function AccessoryRgbConnectionPlanCard({ plan }: { plan: AccessoryRgbConnectionPlan }) {
  return <article className={`accessory-connection-plan ${plan.status}`}><div className="accessory-connection-plan-heading"><div><strong>{plan.controllerName}</strong><small>RGB 출력 · {plan.controllerOutputs.join(" · ")}</small></div><span>{planStatusLabel(plan.status)}</span></div><div className="accessory-connection-plan-facts"><div><span>RGB 연결 장치</span><strong>{plan.deviceCount}개</strong></div><div><span>연결 구성</span><strong>{plan.additionalFanDeviceCount ? `케이스 ${plan.caseDeviceCount ?? 0} + 추가 팬 ${plan.additionalFanDeviceCount}` : "케이스 기본 RGB"}</strong></div><div><span>필요 전압</span><strong>{plan.requiredVoltages.join(" + ") || "확인 필요"}</strong></div><div><span>외부 전원</span><strong>{plan.externalPower ?? "확인 필요"}</strong></div><div><span>출력 포트</span><strong>{plan.outputCount === undefined ? "확인 필요" : `${plan.outputCount}개`}</strong></div><div><span>RGB 부하 계획</span><strong>{rgbLoadText(plan)}</strong></div><div><span>전원 레일 (원문)</span><strong title={powerRailText(plan.powerRails)}>{powerRailText(plan.powerRails)}</strong></div></div>{plan.devices && plan.devices.length > 0 && <div className="accessory-connection-plan-rgb-devices"><span>RGB 부하 대상</span>{plan.devices.map((device) => <div key={device.id}><strong>{device.kind === "case" ? "케이스" : "추가 팬"}</strong><span>{device.name} · {device.count}개{device.voltage ? ` · ${device.voltage}` : " · 전압 확인 필요"}</span></div>)}</div>}<p>{plan.summary}</p><small className="accessory-connection-plan-evidence">{rgbLoadEvidenceText(plan)}</small>{plan.rgbLoadProvenance && <small className="accessory-connection-plan-evidence">부하 근거: {plan.rgbLoadProvenance.manufacturerModel} · {plan.rgbLoadProvenance.sourceNote}</small>}</article>;
}

export function AccessoryCompatibilityPanel({ result, onEdit, onAssignHubTarget }: { result: AccessoryCompatibilityResult; onEdit?: () => void; onAssignHubTarget?: (fanId: string, hubId: string) => void }) {
  const hasFindings = result.findings.length > 0;
  return <section className={`accessory-compatibility-panel ${result.status}`} aria-label="주변 부품 호환 점검" data-testid="accessory-compatibility-panel">
    <div className="accessory-compatibility-heading"><div><p className="eyebrow">PERIPHERAL COMPATIBILITY</p><h2>주변 부품 호환 점검</h2><p>쿨링팬·팬 허브·RGB 컨트롤러·M.2 방열판처럼 실제 연결·장착 규격을 확인할 수 있는 선택 항목을 핵심 부품 판정과 분리해 검사합니다. 팬 3핀 DC·4핀 PWM, RGB 전압, 허브 외부 전원·허용전류·RGB 장치별 부하까지 근거가 있을 때만 연결을 확정합니다.</p></div><strong>{statusLabel(result.status)}</strong></div>
    <div className="accessory-compatibility-counts"><span><b>{result.blockerCount}</b> 차단</span><span><b>{result.warningCount}</b> 주의</span><span><b>{result.unknownCount}</b> 확인 필요</span></div>
    {result.fanHubTargetRecommendations && result.fanHubTargetRecommendations.length > 0 && <section className="accessory-connection-plans accessory-hub-target-recommendations" aria-label="팬 허브 연결 대상 추천"><div className="accessory-connection-plans-heading"><div><strong>팬 허브 연결 대상 추천</strong><small>포트·커넥터·전류·외부 전원 근거를 비교한 후보입니다. 추천이 있어도 실제 케이블 규격은 원문에서 확인하세요.</small></div><span>{result.fanHubTargetRecommendations.length}개 팬</span></div><div className="accessory-connection-plans-list">{result.fanHubTargetRecommendations.map((recommendation) => <FanHubTargetRecommendationCard key={recommendation.fanId} recommendation={recommendation} onAssign={onAssignHubTarget} />)}</div></section>}
    {result.connectionPlans && result.connectionPlans.length > 0 && <section className="accessory-connection-plans" aria-label="주변 부품 연결 계획"><div className="accessory-connection-plans-heading"><div><strong>연결 계획</strong><small>선택한 팬을 허브 어느 출력에 연결할지와 전류 근거를 요약합니다.</small></div><span>{result.connectionPlans.length}개 허브</span></div><div className="accessory-connection-plans-list">{result.connectionPlans.map((plan) => <AccessoryConnectionPlanCard key={plan.id} plan={plan} />)}</div></section>}
    {result.rgbConnectionPlans && result.rgbConnectionPlans.length > 0 && <section className="accessory-connection-plans accessory-rgb-connection-plans" aria-label="RGB 연결 계획"><div className="accessory-connection-plans-heading"><div><strong>RGB 연결 계획</strong><small>케이스 기본 RGB 장치를 어느 컨트롤러에 연결할지와 전압·출력 근거를 요약합니다.</small></div><span>{result.rgbConnectionPlans.length}개 컨트롤러</span></div><div className="accessory-connection-plans-list">{result.rgbConnectionPlans.map((plan) => <AccessoryRgbConnectionPlanCard key={plan.id} plan={plan} />)}</div></section>}
    {!hasFindings && <div className="accessory-compatibility-empty"><FiCheckCircle /><div><strong>현재 선택한 주변 부품에서 확인된 충돌이 없습니다.</strong><p>표시 가능한 주변 부품 규격 기준을 통과했습니다. 실제 장착 위치·나사 간격·케이블 경로는 제조사 원문과 실물 조립 전에 다시 확인하세요.</p></div></div>}
    {hasFindings && <div className="accessory-compatibility-list">{result.findings.map((finding) => { const Icon = severityIcon(finding.severity); return <article className={`accessory-compatibility-finding ${finding.severity}`} key={finding.id}><div className="accessory-compatibility-finding-top"><span><Icon /> {severityLabel(finding.severity)}</span><strong>{finding.accessoryName}</strong></div><h3>{finding.title}</h3><p>{finding.message}</p>{finding.facts.length > 0 && <div className="accessory-compatibility-facts">{finding.facts.map((fact, index) => <div key={`${fact.label}-${index}`}><span>{fact.label}</span><strong>{fact.actual ?? fact.expected ?? "확인 필요"}</strong>{fact.actual && fact.expected && <small>기대: {fact.expected}</small>}</div>)}</div>}<div className="accessory-compatibility-finding-footer"><span><FiTool /> {finding.action ?? "주변 부품 선택을 확인하세요."}</span>{onEdit && <button className="text-button" type="button" onClick={onEdit}>주변 부품 수정</button>}</div></article>; })}</div>}
    <p className="accessory-compatibility-note"><FiInfo /> 이 결과는 핵심 부품 호환 판정과 별도의 주변 부품 점검입니다. 표시되지 않은 커넥터·허브 전류·케이블 경로는 임의로 호환된다고 추정하지 않습니다.</p>
  </section>;
}
