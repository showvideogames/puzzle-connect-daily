/**
 * CrossPuns scoring only. The caller must supply an authorized, eligible source
 * set: this module neither reads accounts nor decides visibility or eligibility.
 * All historical results of CURRENT members count, irrespective of join date.
 */
export interface CrossPunsStandingMember { memberRef: string }
export interface CrossPunsStandingResult { memberRef: string; puzzleId: string; seconds: number }
export interface CrossPunsStanding {
  memberRef: string;
  rank: number;
  points: number;
  puzzles: number;
}
export interface CrossPunsStandings {
  rows: CrossPunsStanding[];
  totalPoints: number;
}

/** Competition ranking: 1,1,3 earns 3,3,1. Equal totals also share rank. */
export function crossPunsStandings(
  members: readonly CrossPunsStandingMember[],
  results: readonly CrossPunsStandingResult[],
): CrossPunsStandings {
  const totals = new Map<string, {points:number; puzzles:number}>();
  for (const member of members) {
    if (!member.memberRef || totals.has(member.memberRef)) throw new Error('Invalid or duplicate membership');
    totals.set(member.memberRef, {points:0,puzzles:0});
  }
  const puzzles = new Map<string, Map<string, number>>();
  for (const result of results) {
    // Departure removes every contribution without changing personal history.
    if (!totals.has(result.memberRef)) continue;
    if (!result.puzzleId || !Number.isSafeInteger(result.seconds) || result.seconds < 1 || result.seconds > 86400) {
      throw new Error('Invalid CrossPuns result');
    }
    let puzzle = puzzles.get(result.puzzleId);
    if (!puzzle) {puzzle = new Map();puzzles.set(result.puzzleId,puzzle);}
    // Source precedence is a server responsibility, never guessed from input order.
    if (puzzle.has(result.memberRef)) throw new Error('Duplicate first-solve result');
    puzzle.set(result.memberRef,result.seconds);
  }
  for (const puzzle of puzzles.values()) {
    const ordered = [...puzzle].sort((a,b) => a[1]-b[1]);
    let rank=0;
    ordered.forEach(([memberRef,seconds],index) => {
      if (index===0 || seconds !== ordered[index-1][1]) rank=index+1;
      const total=totals.get(memberRef)!;
      total.points+=Math.max(0,4-rank);
      total.puzzles+=1;
    });
  }
  const ordered=[...totals].sort((a,b) => b[1].points-a[1].points || (a[0]<b[0]?-1:a[0]>b[0]?1:0));
  let rank=0;
  const rows=ordered.map(([memberRef,total],index) => {
    if(index===0 || total.points!==ordered[index-1][1].points)rank=index+1;
    return {memberRef,rank,...total};
  });
  return {rows,totalPoints:rows.reduce((sum,row)=>sum+row.points,0)};
}
