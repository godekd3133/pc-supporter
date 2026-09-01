export type SavedBuildComparisonRowDiff = {
  changed: boolean;
  changedIndexes: number[];
};

/**
 * Compares a row against the first selected build, which is the visible
 * comparison baseline in the saved-build comparison table.
 */
export function savedBuildComparisonRowDiffFor(values: string[]): SavedBuildComparisonRowDiff {
  if (values.length < 2) return { changed: false, changedIndexes: [] };
  const baseline = values[0];
  const changedIndexes = values.reduce<number[]>((indexes, value, index) => {
    if (index > 0 && value !== baseline) indexes.push(index);
    return indexes;
  }, []);
  return { changed: changedIndexes.length > 0, changedIndexes };
}
