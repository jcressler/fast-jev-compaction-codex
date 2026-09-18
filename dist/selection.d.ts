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
export declare function orderByRequirementCoverage<T>(scored: Array<RequirementScoredCandidate<T>>, requirementCount: number): Array<RequirementScoredCandidate<T>>;
//# sourceMappingURL=selection.d.ts.map