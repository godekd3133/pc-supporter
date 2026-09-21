import type { PriceTrendPoint } from "../shared/price-trend";

function formatWon(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function shortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.getMonth() + 1}.${String(date.getDate()).padStart(2, "0")}`;
}

export function PriceTrendChart({ points, ariaLabel, testId }: { points: PriceTrendPoint[]; ariaLabel: string; testId?: string }) {
  if (points.length === 0) return null;
  const width = 320;
  const height = 132;
  const padding = { top: 12, right: 10, bottom: 16, left: 10 };
  const minValue = Math.min(...points.map((point) => point.priceWon));
  const maxValue = Math.max(...points.map((point) => point.priceWon));
  const valueRange = Math.max(1, maxValue - minValue);
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const xFor = (index: number) => padding.left + (points.length === 1 ? chartWidth / 2 : (index / (points.length - 1)) * chartWidth);
  const yFor = (value: number) => padding.top + ((maxValue - value) / valueRange) * chartHeight;
  const line = points.map((point, index) => `${xFor(index).toFixed(1)},${yFor(point.priceWon).toFixed(1)}`).join(" ");
  const area = `${padding.left},${height - padding.bottom} ${line} ${padding.left + chartWidth},${height - padding.bottom}`;
  const guideValues = [maxValue, minValue + valueRange / 2, minValue];
  const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];

  return <div className="price-trend-chart" data-testid={testId}>
    <svg className="price-trend-chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${ariaLabel} · 현재 ${formatWon(points.at(-1)!.priceWon)}`}>
      {guideValues.map((value, index) => <line className="price-trend-chart-guide" x1={padding.left} x2={padding.left + chartWidth} y1={yFor(value)} y2={yFor(value)} key={`${value}-${index}`} />)}
      <polygon className="price-trend-chart-area" points={area} />
      <polyline className="price-trend-chart-line" points={line} />
      {points.map((point, index) => <circle className={index === points.length - 1 ? "price-trend-chart-point current" : "price-trend-chart-point"} cx={xFor(index)} cy={yFor(point.priceWon)} r={index === points.length - 1 ? 4.5 : 3.2} key={`${point.at}-${index}`}><title>{`${shortDate(point.at)} · ${formatWon(point.priceWon)}`}</title></circle>)}
    </svg>
    <div className="price-trend-chart-labels" aria-hidden="true">{labelIndexes.map((index) => <span key={`${points[index].at}-${index}`}>{shortDate(points[index].at)}</span>)}</div>
  </div>;
}
