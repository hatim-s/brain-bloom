/** Compares UTF-16 code units without host locale or collation state. */
function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export { compareCodeUnits };
