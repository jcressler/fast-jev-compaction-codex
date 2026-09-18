/**
 * Order scored evidence so that early results cover as many independent
 * requirements as possible.  `support` is a per-requirement probability;
 * `score` remains the deterministic tie breaker for equally useful coverage.
 */
export interface RequirementScoredCandidate<T> {
  candidate: T;
  index: number;
  score: number;
  support: number[];
}

export function orderByRequirementCoverage<T>(
  scored: Array<RequirementScoredCandidate<T>>,
  requirementCount: number,
): Array<RequirementScoredCandidate<T>> {
  if (requirementCount <= 0) return [...scored].sort((a, b) => b.score - a.score || a.index - b.index);
  const remaining = [...scored];
  const ordered: Array<RequirementScoredCandidate<T>> = [];
  const maximum = Array.from({ length: requirementCount }, () => 0);
  while (remaining.length) {
    let bestPosition = 0;
    let bestMarginal = -1;
    for (let position = 0; position < remaining.length; position += 1) {
      const candidate = remaining[position]!;
      const marginal = candidate.support.reduce((sum, support, requirementIndex) =>
        sum + Math.max(0, support - (maximum[requirementIndex] ?? 0)), 0);
      const best = remaining[bestPosition]!;
      if (marginal > bestMarginal ||
          (marginal === bestMarginal && (candidate.score > best.score ||
            (candidate.score === best.score && candidate.index < best.index)))) {
        bestPosition = position;
        bestMarginal = marginal;
      }
    }
    const [selected] = remaining.splice(bestPosition, 1);
    if (!selected) break;
    selected.support.forEach((support, requirementIndex) => {
      maximum[requirementIndex] = Math.max(maximum[requirementIndex] ?? 0, support);
    });
    ordered.push(selected);
  }
  return ordered;
}
