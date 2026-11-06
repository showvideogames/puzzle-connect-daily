import type {CrossPunsStanding} from './crosspunsStandings';

/** Server-side projection only; never send the source rows to a browser. */
export type CrossPunsStandingView =
  | {blocked:true; rank:number; label:'This player is blocked'}
  | {blocked:false; rank:number; memberRef:string; name:string; points:number; animalId?:string; backgroundColor?:string};

/**
 * Rank over the whole authorized group BEFORE this projection, so block direction
 * cannot change placements. Identity/blocked status must come from the server.
 * The anonymous branch is an allow-list, not a spread/redaction or CSS blur.
 * No anonymity guarantee is possible against roster knowledge or external boards.
 */
export function crossPunsStandingsView(
  standings: readonly CrossPunsStanding[],
  people: ReadonlyMap<string,{name:string; blockedEitherWay:boolean; animalId?:string; backgroundColor?:string}>,
): CrossPunsStandingView[] {
  return standings.map(row=>{
    const person=people.get(row.memberRef);
    // A missing visibility decision cannot safely be treated as an unblocked row.
    if (!person) throw new Error('Missing standings visibility');
    if(person.blockedEitherWay)return {blocked:true,rank:row.rank,label:'This player is blocked'};
    return {blocked:false,rank:row.rank,memberRef:row.memberRef,name:person.name,points:row.points,animalId:person.animalId,backgroundColor:person.backgroundColor};
  });
}
