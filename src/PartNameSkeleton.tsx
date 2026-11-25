import "./part-name-skeleton.css";

export const MISSING_PART_NAME = "부품 정보를 불러오지 못했어요";

/** 부품 이름 자리에 쓰는 로딩 막대. 초안 부품을 서버에서 채우는 동안만 보인다. */
export function PartNameSkeleton({ wide = false }: { wide?: boolean }) {
  return <span className={wide ? "part-name-skeleton wide" : "part-name-skeleton"} role="status" aria-label="부품 정보 불러오는 중" />;
}
