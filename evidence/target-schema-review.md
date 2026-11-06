# Hosted catalog review — 2026-11-05

Project: `zmauemcjcrdrgfjzkvgd` (Rainbow Categories, Sam West Games, production main). Visibly verified in the existing signed-in Chrome Supabase dashboard. Source: read-only catalog SELECT results in new snippet `f419605f-08ea-45eb-9235-de931412dbf9`; observed via native accessibility UI. These are transcribed metadata observations, not an exported full catalog or a hosted feature test.

No application/player rows were queried. No secrets were extracted, migrations applied, settings/grants changed or mutating functions called. The dashboard created an editor snippet; the earlier score-repair snippet was untouched.

## Observed permissions

- 13 social tables: all owned by postgres, all RLS enabled, all table ACLs `{postgres=arwdDxtm/postgres}`.
- 74 social functions: all postgres-owned. 34 security-definer functions; all have `{search_path=social, pg_temp}`.
- Execute: anon 0; authenticated 0; service_role 0; social_gateway 32; social_game_server 2. Exact per-function rights match local baseline (fingerprint below).
- Social schema ACL: `{postgres=UC/postgres,social_gateway=U/postgres,social_game_server=U/postgres}`.
- social_gateway/social_game_server: NOLOGIN, no superuser or BYPASSRLS. postgres: LOGIN, BYPASSRLS, not superuser; membership in both social roles. Two grant records per role were observed (four catalog membership rows); this is not four separate service roles. authenticator memberships observed: anon/authenticated/service_role only.
- xw_accounts, xw_puzzles, xw_solves, xw_times: postgres owner, SELECT available to postgres, RLS enabled, FORCE RLS false. Existing table grants were not changed.
- No crosspuns_standings function present. New preferences/order/description columns/tables absent, consistent with unapplied patches.

## Source columns observed

- xw_accounts: id uuid, auth_user_id uuid, global_user_id text, player_key uuid, role text, created_at timestamptz, last_seen_at timestamptz.
- xw_puzzles: id uuid, publish_date date, size text, title text, author text, width int4, height int4, data jsonb, created_at timestamptz, updated_at timestamptz.
- xw_solves: account_id uuid, puzzle_id uuid, seconds int4, used_help bool, solved_at timestamptz, source text.
- xw_times: id uuid, puzzle_id uuid, player_key uuid, name text, seconds int4, created_at timestamptz.
- xw_today_local(), xw_group_board(uuid,uuid,integer,integer), xw_times_account_guard() exist, owned by postgres. Last two security-definer with search_path=public; today helper is not security-definer. Their bodies were not compared during this browser review.

## Live/local comparison

Local comparator: PGlite loaded only the unchanged hub-eb238dd.sql baseline and anon/authenticated/service_role scaffolding. Hosted statements were SELECTs only.

| Metadata | Live and local MD5 |
| --- | --- |
| social columns, types, nullability and defaults, ordered by table/ordinal | 1cc4bc97519c10b06d6aadf77cf044ba |
| 56 social non-NOT-NULL constraint names/definitions, ordered by table/name | f227d3d7542943e64745c3aee20f9818 |
| Function execute rights for anon/authenticated/service_role/social_gateway/social_game_server | 5f1537950dad13aae48bcb02b46da0cc |
| 73 functions excluding trimmed: name/identity args/return type/body/security-definer/config | d3beb651fe04bd7e9513309c9b399bd2 |
| check_photo body | 4e86e78756fa86ec465041f04e6e213e |
| photo_url body | ff07db87e09f0a00af4b8896c60ab37f |

PGlite exposes NOT NULL constraints in pg_constraint, giving 119 total versus hosted 56. Excluding contype=n gives the identical 56 definitions above; nullability is independently covered by the column fingerprint.

The initial all-function fingerprint differed. Bucket comparison isolated only `trimmed`; its live body hash is c8125ffb8504294153dc0d6091a46139. The displayed body performs `btrim(coalesce(p_text, ''), whitespace)` with Unicode escape spellings for U+0009–U+000D, U+0020, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF. The local fixture uses literal characters for the latter code points. This is an equivalent spelling difference, not a reason to replace the hosted function. None of patches 0002–0009 modifies trimmed.

## Remaining release gates

Catalog compatibility is supported; this does not prove runtime performance, deployed gateway configuration, or authenticated hosted feature behavior. New SQL/gateway/frontend release and test-account checks require separate authorization. No push, merge, deploy, flag activation or production data change has occurred.
