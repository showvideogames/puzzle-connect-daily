import type {AppSocial} from '@/components/social/appSocial';
const query=new URLSearchParams(location.search);
const pending=query.has('pending');
const readyAt=query.get('pending')==='hold'?Infinity:Date.now()+2500;
const friends=[['f1','Riley','bear','#F8D0BD'],['f2','Priya','owl','#DED1F2'],['f3','Marco','otter','#CCE6CA']].map(([friendRef,name,animalId,backgroundColor])=>({friendRef,name,animalId,backgroundColor,since:'2026-01-01T00:00:00.000Z'}));
const me={displayName:'Alex',animalId:'frog',backgroundColor:'#CCE6CA',friendCode:'ABC-234',friendCount:3,groupCount:1};
const group={groupId:'g1',name:'Lunch Puzzlers',emblemId:'book',accentColor:'#DED1F2',photo:null,photoVersion:0,memberCount:4,isOwner:false,myName:'Alex',inviteCode:null};
const social={
 source:{read:()=>({state:{scope:'fixture',credential:'fixture'},accountId:'fixture',storedOwner:'fixture',generation:1,checkRunning:false}),subscribe:()=>()=>{}},
 api:{client:{forget(){},async call(op:string,args:{puzzleId?:string;groupId?:string}){
  const ok=(data:unknown)=>({ok:true,data});
  if(op==='getMe')return ok(me);
  if(op==='listFriendRequests')return ok({incoming:[],outgoing:[]});
  if(op==='listFriends')return ok(friends);
  if(op==='listMyGroups')return ok([group]);
  if(op==='listGroupOrder')return ok({groupIds:['g1']});
  if(op==='listFriendPreferences')return ok([]);
  if(op==='listMembers')return ok([{...me,name:'Alex',memberRef:'me',isMe:true,isOwner:false,joinedAt:'2026-01-01T00:00:00.000Z'},...friends.map(f=>({...f,memberRef:f.friendRef,isMe:false,isOwner:false,joinedAt:'2026-01-01T00:00:00.000Z'}))]);
  if(op==='listResults'){
   const mini=args.puzzleId==='mini-7';
   let rows=[{...friends[0],isMe:false,summary:{solved:true,mistakes:mini?2:0,...(mini?{seconds:42}:{})}}, {...me,name:'Alex',friendRef:null,isMe:true,summary:{solved:true,mistakes:1,...(mini?{seconds:65}:{})}}, {...friends[1],isMe:false,summary:{solved:true,mistakes:mini?0:1}}, {...friends[2],isMe:false,summary:{solved:false,mistakes:4}}];
   if(pending&&Date.now()<readyAt)rows=rows.filter(r=>!r.isMe);
   return ok(rows.map(r=>({...r,memberRef:r.isMe?'me':r.friendRef,detailLocked:true})));
  }
  return {ok:false,outcome:'unavailable'};
 }},puzzleId:()=>null,today:()=>new Date(),linkUrl:()=>'',share:async()=>'done'},signIn:async()=>'Local fixture only',
} as unknown as AppSocial;
export function appSocial(){return social;}
