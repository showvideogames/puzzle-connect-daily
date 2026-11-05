import {expect,it} from 'vitest';
import {crossPunsStandings,type CrossPunsStandingResult} from '@/social/crosspunsStandings';
const members=['a','b','c','d'].map(memberRef=>({memberRef}));
const solves=(times:number[],puzzleId='old-puzzle'):CrossPunsStandingResult[]=>times.map((seconds,i)=>({memberRef:members[i].memberRef,puzzleId,seconds}));
it('awards 3/2/1 and zero below third',()=>{
 expect(crossPunsStandings(members,solves([10,20,30,40])).rows.map(r=>[r.rank,r.points])).toEqual([[1,3],[2,2],[3,1],[4,0]]);
});
it('uses competition ties, without a submission-time tie-break',()=>{
 expect(crossPunsStandings(members,solves([10,10,30,40])).rows.map(r=>[r.rank,r.points])).toEqual([[1,3],[1,3],[3,1],[4,0]]);
 expect(crossPunsStandings(members,solves([10,20,20,40])).rows.map(r=>r.points)).toEqual([3,2,2,0]);
 expect(crossPunsStandings(members,solves([10,10,10,10])).rows.map(r=>r.points)).toEqual([3,3,3,3]);
});
it('sums previous puzzles on joining; member order does not determine ranking',()=>{
 const result=crossPunsStandings([...members].reverse(),[...solves([10,20,30,40],'previous-year'),...solves([40,30,20,10],'this-week')]);
 expect(result.rows.map(r=>[r.memberRef,r.rank,r.points,r.puzzles])).toEqual([['a',1,3,2],['b',1,3,2],['c',1,3,2],['d',1,3,2]]);
 expect(result.totalPoints).toBe(12);
});
it('recalculates using current memberships, leaving source history untouched',()=>{
 const history=solves([10,20,30,40]);const snapshot=structuredClone(history);
 const result=crossPunsStandings(members.slice(1),history);
 expect(result.rows.map(r=>[r.memberRef,r.points])).toEqual([['b',3],['c',2],['d',1]]);
 expect(history).toEqual(snapshot);
 expect(crossPunsStandings(members,history).rows[0]).toMatchObject({memberRef:'a',points:3});
});
it('does not turn duplicate/replay records or invalid times into extra points',()=>{
 expect(()=>crossPunsStandings(members,[...solves([10]),...solves([20])])).toThrow('Duplicate');
 for(const seconds of [0,-1,1.5,86401,NaN,Infinity])expect(()=>crossPunsStandings(members,solves([seconds]))).toThrow('Invalid');
});
it('keeps zero-result members and handles an empty group',()=>{
 expect(crossPunsStandings(members,[]).rows.every(r=>r.rank===1&&r.points===0&&r.puzzles===0)).toBe(true);
 expect(crossPunsStandings([],solves([10]))).toEqual({rows:[],totalPoints:0});
});
