import {expect,it} from 'vitest';
import {crossPunsStandings} from '@/social/crosspunsStandings';
import {crossPunsStandingsView} from '@/social/crosspunsStandingsView';
it('keeps shared ranks but emits no blocked identity, scores, puzzle counts or linkable references',()=>{
 const standings=crossPunsStandings([{memberRef:'secret-person'},{memberRef:'viewer'}],[{memberRef:'secret-person',puzzleId:'secret-puzzle',seconds:10},{memberRef:'viewer',puzzleId:'secret-puzzle',seconds:20}]);
 const people=new Map([['secret-person',{name:'Secret name',blockedEitherWay:true}],['viewer',{name:'Viewer',blockedEitherWay:false}]]);
 const rows=crossPunsStandingsView(standings.rows,people);
 expect(rows).toEqual([{blocked:true,rank:1,label:'This player is blocked'},{blocked:false,rank:2,memberRef:'viewer',name:'Viewer',points:2}]);
 expect(JSON.stringify(rows)).not.toMatch(/secret|puzzles|seconds/i);
 people.set('secret-person',{name:'Secret name',blockedEitherWay:false});
 expect(crossPunsStandingsView(standings.rows,people).map(row=>row.rank)).toEqual(rows.map(row=>row.rank));
});
it('fails closed when visibility is missing and keeps tied blocked rows free of persistent ids',()=>{
 const standings=[{memberRef:'a',rank:1,points:3,puzzles:1},{memberRef:'b',rank:1,points:3,puzzles:1}];
 expect(()=>crossPunsStandingsView(standings,new Map())).toThrow('visibility');
 const people=new Map(standings.map(row=>[row.memberRef,{name:row.memberRef,blockedEitherWay:true}]));
 expect(crossPunsStandingsView(standings,people)).toEqual([{blocked:true,rank:1,label:'This player is blocked'},{blocked:true,rank:1,label:'This player is blocked'}]);
});
