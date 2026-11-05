/** Catalog-only target review. No application rows, migrations, grants or writes. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ref=readFileSync(path.join(root,'supabase/config.toml'),'utf8').match(/^project_id\s*=\s*"([a-z]{20})"/m)?.[1];
if(!ref)throw new Error('No valid configured project ref');
const token=process.env.SUPABASE_ACCESS_TOKEN?.trim();
if(!token){console.error('BLOCKED: SUPABASE_ACCESS_TOKEN is not configured. No network request made. Configure access in the execution environment, never in chat or a committed file.');process.exit(2);}
const queries={
 columns:`select table_schema,table_name,column_name,udt_name,is_nullable,column_default from information_schema.columns where table_schema='social' or (table_schema='public' and table_name in ('xw_accounts','xw_solves','xw_times','xw_puzzles')) order by 1,2,ordinal_position`,
 tables:`select n.nspname as schema,c.relname,c.relowner::regrole::text as owner,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and (n.nspname='social' or (n.nspname='public' and c.relname in ('xw_accounts','xw_solves','xw_times','xw_puzzles'))) order by 1,2`,
 functions:`select n.nspname as schema,p.proname,pg_get_function_identity_arguments(p.oid) as args,p.proowner::regrole::text as owner,p.prosecdef,p.proconfig,md5(pg_get_functiondef(p.oid)) as definition_hash,has_function_privilege('anon',p.oid,'execute') as anon_execute,has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,has_function_privilege('service_role',p.oid,'execute') as service_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind='f' and (n.nspname='social' or (n.nspname='public' and p.proname in ('xw_today_local','xw_group_board','xw_times_account_guard'))) order by 1,2,3`,
 roles:`select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolbypassrls from pg_roles where rolname in ('postgres','social_gateway','social_game_server','anon','authenticated','service_role') order by 1`,
 constraints:`select n.nspname as schema,c.relname,k.conname,pg_get_constraintdef(k.oid) as definition from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='social' or (n.nspname='public' and c.relname in ('xw_accounts','xw_solves','xw_times','xw_puzzles')) order by 1,2,3`,
 source_access:`select r.rolname,c.relname,has_table_privilege(r.oid,c.oid,'select') as can_select,r.rolbypassrls,r.rolsuper,c.relowner=r.oid as owns_table,c.relrowsecurity,c.relforcerowsecurity from pg_roles r cross join pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('xw_accounts','xw_solves','xw_times','xw_puzzles') and r.rolname in ('postgres','social_gateway','social_game_server') order by 1,2`,
};
const report={projectRef:ref,checkedAt:new Date().toISOString(),mode:'catalog-only; Management API read_only=true',catalogs:{}};
for(const [name,query] of Object.entries(queries)){
 if(!/^select\b/i.test(query))throw new Error('Refusing non-SELECT query');
 const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({query,read_only:true}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error(`Catalog review ${name} refused: HTTP ${response.status}. No writes attempted.`);
 const rows=await response.json();if(!Array.isArray(rows))throw new Error('Unexpected catalog response');report.catalogs[name]=rows;
}
const directory=path.join(root,'evidence');mkdirSync(directory,{recursive:true});
writeFileSync(path.join(directory,'target-schema-review.json'),JSON.stringify(report,null,2)+'\n');
console.log(`Saved catalog-only evidence for ${ref}. Review schema/owner/ACL differences before release; this script does not apply changes or certify compatibility automatically.`);
