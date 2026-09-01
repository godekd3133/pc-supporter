import type { ComponentType } from "react";
import { FiInfo, FiTool, FiTrash2 } from "react-icons/fi";
import type { AccessoryItem, AccessorySelection, Part, PartSelection } from "../shared/types";
import { ACCESSORY_CATEGORY_LABELS, isKnownPrice } from "../shared/types";
import { rgbFanDeviceCountFor } from "../shared/rgb-connectivity";

type AccessoryVisualRenderer = ComponentType<{ item: AccessoryItem }>;

function isM2TargetableAccessory(item: AccessoryItem | undefined) {
  if (!item) return false;
  return item.category === "m2_heatsink"
    || (item.category === "storage_accessory" && /m\.2/i.test(`${item.name} ${item.rawSpecText ?? ""}`));
}

function isFanTargetableAccessory(item: AccessoryItem | undefined) {
  return item?.category === "cooling_fan";
}

function hasRgbControllerEvidence(item: AccessoryItem) {
  return item.specs.rgbPortCount !== undefined
    || item.specs.rgbDeviceVoltage !== undefined
    || /(?:ARGB|RGB)\s*(?:컨트롤러|허브)|(?:ARGB|RGB)\s*\d\s*핀/i.test(`${item.name} ${item.rawSpecText ?? ""}`);
}

export function AccessoryCartPanel({ selections, accessoryMap, partMap, ssdSelections, rgbControllerAccessoryId, rgbDeviceCount, onChangeQuantity, onChangeTarget, onChangeHubTarget, onChangeRgbController, onRemove, AccessoryVisual }: { selections: AccessorySelection[]; accessoryMap: Map<string, AccessoryItem>; partMap: Map<string, Part>; ssdSelections: PartSelection[]; rgbControllerAccessoryId?: string; rgbDeviceCount?: number; onChangeQuantity: (index: number, quantity: number) => void; onChangeTarget: (index: number, targetPartId: string | undefined) => void; onChangeHubTarget: (index: number, targetAccessoryId: string | undefined) => void; onChangeRgbController: (targetAccessoryId: string | undefined) => void; onRemove: (index: number) => void; AccessoryVisual: AccessoryVisualRenderer }) {
  if (selections.length === 0) return null;
  const lines = selections.map((selection) => ({ selection, item: accessoryMap.get(selection.accessoryId) }));
  const total = lines.reduce((sum, line) => sum + (line.item?.priceWon ?? 0) * line.selection.quantity, 0);
  const priceComplete = lines.every((line) => isKnownPrice(line.item?.priceWon));
  const m2Targets = ssdSelections
    .map((selection) => ({ selection, part: partMap.get(selection.partId) }))
    .filter((entry): entry is { selection: PartSelection; part: Part } => Boolean(entry.part && entry.part.specs.formFactor?.toLocaleLowerCase("ko-KR").includes("m.2")));
  const fanHubTargets = lines
    .map(({ selection, item }) => ({ selection, item }))
    .filter((entry): entry is { selection: AccessorySelection; item: AccessoryItem } => entry.item?.category === "fan_hub");
  const rgbHubTargets = fanHubTargets.filter(({ item }) => hasRgbControllerEvidence(item));
  const rgbTargetKnown = fanHubTargets.some(({ selection }) => selection.accessoryId === rgbControllerAccessoryId);
  const additionalRgbFanDeviceCount = lines.reduce((total, { selection, item }) => total + (item ? (rgbFanDeviceCountFor(item) ?? 0) * selection.quantity : 0), 0);
  const totalRgbDeviceCount = rgbDeviceCount === undefined && additionalRgbFanDeviceCount === 0 ? undefined : (rgbDeviceCount ?? 0) + additionalRgbFanDeviceCount;
  const rgbTargetLabel = rgbHubTargets.length === 1 ? "자동 · RGB 기능 확인 허브 1개" : rgbHubTargets.length > 1 ? "선택 필요 · RGB 컨트롤러를 지정하세요" : "선택 필요 · RGB 연결 근거 확인";
  return <section className="accessory-cart-panel">
    <div className="accessory-cart-heading"><div><p className="eyebrow">ADDED PERIPHERALS</p><h2>추가한 주변 부품</h2></div><strong>{priceComplete ? `${total.toLocaleString("ko-KR")}원` : "가격 확인 필요"}</strong></div>
    {totalRgbDeviceCount !== undefined && totalRgbDeviceCount > 0 && fanHubTargets.length > 0 && <div className="accessory-cart-rgb-target"><label className="accessory-cart-target"><span>RGB 연결 컨트롤러 · 연결 장치 {totalRgbDeviceCount}개{additionalRgbFanDeviceCount > 0 ? ` · 추가 RGB 팬 ${additionalRgbFanDeviceCount}개` : ""}</span><select aria-label="케이스 RGB 연결 컨트롤러" value={rgbControllerAccessoryId ?? ""} onChange={(event) => onChangeRgbController(event.target.value || undefined)}><option value="">{rgbTargetLabel}</option>{rgbControllerAccessoryId && !rgbTargetKnown && <option value={rgbControllerAccessoryId}>대상 확인 필요 · {rgbControllerAccessoryId}</option>}{fanHubTargets.map(({ selection, item }) => <option value={selection.accessoryId} key={selection.accessoryId}>{item.name}{rgbHubTargets.some(({ selection: rgbSelection }) => rgbSelection.accessoryId === selection.accessoryId) ? " · RGB 근거 확인" : " · RGB 근거 확인 필요"}</option>)}</select></label><p className="accessory-cart-note"><FiInfo /> 케이스 기본 RGB 장치와 추가한 RGB 팬을 이 컨트롤러에 연결하는 것으로 검사합니다. 허브가 여러 개면 RGB 근거가 있는 컨트롤러 하나를 지정하세요.</p></div>}
    <div className="accessory-cart-list">{lines.map(({ selection, item }, index) => { const targetable = isM2TargetableAccessory(item); const fanTargetable = isFanTargetableAccessory(item); const targetKnown = m2Targets.some(({ part }) => part.id === selection.targetPartId); const hubTargetKnown = fanHubTargets.some(({ selection: hubSelection }) => hubSelection.accessoryId === selection.targetAccessoryId); return <article className="accessory-cart-line" key={`${selection.accessoryId}-${index}`}><span className="accessory-cart-image">{item ? <AccessoryVisual item={item} /> : <FiTool />}</span><div className="accessory-cart-copy"><strong>{item?.name ?? selection.accessoryId}</strong><small>{item ? ACCESSORY_CATEGORY_LABELS[item.category] : "주변 부품 정보를 불러오는 중"}</small>{targetable && <label className="accessory-cart-target"><span>연결 대상 SSD</span><select aria-label={`${item?.name ?? "주변 부품"} 연결 대상 SSD`} value={selection.targetPartId ?? ""} onChange={(event) => onChangeTarget(index, event.target.value || undefined)}><option value="">자동 · 선택한 M.2 SSD 전체</option>{selection.targetPartId && !targetKnown && <option value={selection.targetPartId}>대상 확인 필요 · {selection.targetPartId}</option>}{m2Targets.map(({ part }) => <option value={part.id} key={part.id}>{part.name}</option>)}</select></label>}{fanTargetable && <label className="accessory-cart-target"><span>연결 대상 팬 허브</span><select aria-label={`${item?.name ?? "쿨링팬"} 연결 대상 팬 허브`} value={selection.targetAccessoryId ?? ""} onChange={(event) => onChangeHubTarget(index, event.target.value || undefined)}><option value="">{fanHubTargets.length === 0 ? "허브 미선택 · 나중에 지정" : fanHubTargets.length === 1 ? "자동 · 선택한 허브 1개" : "선택 필요 · 허브를 지정하세요"}</option>{selection.targetAccessoryId && !hubTargetKnown && <option value={selection.targetAccessoryId}>대상 확인 필요 · {selection.targetAccessoryId}</option>}{fanHubTargets.map(({ selection: hubSelection, item: hub }) => <option value={hubSelection.accessoryId} key={hubSelection.accessoryId}>{hub.name}</option>)}</select></label>}</div><label className="accessory-cart-quantity"><span>수량</span><input type="number" min="1" max="99" value={selection.quantity} aria-label={`${item?.name ?? "주변 부품"} 수량`} onChange={(event) => onChangeQuantity(index, Number(event.target.value))} /></label><strong className="accessory-cart-line-price">{item?.priceWon !== undefined ? `${(item.priceWon * selection.quantity).toLocaleString("ko-KR")}원` : "가격 확인 필요"}</strong><button className="icon-button danger-button" type="button" aria-label={`${item?.name ?? "주변 부품"} 삭제`} onClick={() => onRemove(index)}><FiTrash2 /></button></article>; })}</div>
    {!priceComplete && <p className="accessory-cart-note"><FiInfo /> 가격을 확인하지 못한 주변 부품이 있어 전체 견적 금액을 확정할 수 없습니다.</p>}
    {fanHubTargets.length > 1 && lines.some(({ selection, item }) => isFanTargetableAccessory(item) && !selection.targetAccessoryId) && <p className="accessory-cart-note"><FiInfo /> 팬 허브가 여러 개 선택되어 연결 대상이 없는 팬은 어느 허브에 연결할지 지정해야 합니다.</p>}
  </section>;
}
