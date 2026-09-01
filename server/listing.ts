import type { ListingPolicy, ListingType, Part } from "../shared/types";

const STORAGE_ACCESSORY_PATTERN = /(컨버터|변환|어댑터|케이블|도킹|리더기|복제기|하드랙|브라켓|외장\s*케이스|디스크\s*케이스|USB\s*(?:3|2)\.0\s*to\s*SATA)/i;
const USED_PATTERN = /(중고|리퍼비시|리퍼브|리퍼|전시|반품)/i;
const OVERSEAS_PATTERN = /(해외구매|해외직구|직구)/i;
const PARALLEL_IMPORT_PATTERN = /병행수입/i;
const BULK_PATTERN = /(벌크|OEM)/i;

export function inferListingType(input: Pick<Part, "category" | "name" | "rawSpecText" | "listingType">): ListingType {
  const text = `${input.name} ${input.rawSpecText ?? ""}`;
  if ((input.category === "ssd" || input.category === "hdd") && STORAGE_ACCESSORY_PATTERN.test(text)) return "accessory";
  if (USED_PATTERN.test(text)) return "used";
  if (PARALLEL_IMPORT_PATTERN.test(text)) return "parallel_import";
  if (OVERSEAS_PATTERN.test(text)) return "overseas";
  if (BULK_PATTERN.test(text)) return "bulk";
  if (input.listingType && input.listingType !== "unknown") return input.listingType;
  return "retail";
}

export function isListingAllowed(part: Part, policy: ListingPolicy) {
  const listingType = inferListingType(part);
  if (listingType === "accessory") return false;
  if (policy === "all") return true;
  if (policy === "include_bulk") return listingType === "retail" || listingType === "bulk";
  return listingType === "retail";
}
