import {readFileSync} from 'node:fs';import {PGlite} from '@electric-sql/pglite';import {afterAll,beforeAll,expect,it} from 'vitest';
const db=new PGlite();const owner='user_owner000001',member='user_member00001',other='user_other000001';let id:string;
async function call(fn:string,args:unknown[]){await db.exec('set role social_gateway');try{return (await db.query<{answer:{ok:boolean;data:{groupId?:string;inviteCode?:string;description?:string|null};outcome?:string}}>(`select social.${fn}(${args.map((_,i)=>`$${i+1}`).join(',')}) as answer`,args)).rows[0].answer;}finally{await db.exec('reset role');}}
beforeAll(async()=>{
 await db.exec('create role anon nologin;create role authenticated nologin;create role service_role nologin;');await db.exec(readFileSync('shared-service/fixtures/hub-eb238dd.sql','utf8'));await db.exec(readFileSync('shared-service/patches/0005_group_descriptions.sql','utf8'));
 for(const who of [owner,member,other]){await call('ensure_person',[who,'rainbow']);await call('set_profile',[who,who,'fox','#DED1F2']);}
 const group=await call('create_group',[owner,'Club','Owner',1]);id=group.data.groupId!;await call('join_group',[member,group.data.inviteCode,'Member',1]);
},20000);afterAll(()=>db.close());
it('preserves old groups, allows owner edits and returns plain text to members only',async()=>{
 expect(await call('get_group_description',[owner,id])).toMatchObject({data:{description:null}});
 const before=(await db.query('select social.list_my_groups($1) as data',[owner])).rows;
 expect(await call('set_group_description',[owner,id,'  Weekly puzzles\n<script>text</script>  '])).toMatchObject({ok:true,data:{description:'Weekly puzzles\n<script>text</script>'}});
 expect(await call('get_group_description',[member,id])).toMatchObject({data:{description:'Weekly puzzles\n<script>text</script>'}});
 expect((await call('get_group_description',[other,id])).ok).toBe(false);
 expect(await call('set_group_description',[member,id,'Changed'])).toMatchObject({ok:false,outcome:'not_the_creator'});
 expect((await db.query('select social.list_my_groups($1) as data',[owner])).rows).toEqual(before);
});
it('bounds text and clears descriptions without affecting memberships',async()=>{
 expect((await call('set_group_description',[owner,id,'🧩'.repeat(500)])).ok).toBe(true);
 expect(await call('set_group_description',[owner,id,'x'.repeat(501)])).toMatchObject({ok:false,outcome:'bad_description'});
 for(const blank of ['', '   ', null])expect(await call('set_group_description',[owner,id,blank])).toMatchObject({ok:true,data:{description:null}});
 expect((await db.query<{n:number}>('select count(*)::int as n from social.memberships')).rows[0].n).toBe(2);
});
