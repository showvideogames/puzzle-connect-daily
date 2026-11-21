# Preview check

Run 2026-10-04T11:22:26.394Z against https://www.rainbowcategories.com (hosted project zmauemcjcrdrgfjzkvgd).

| check | result | detail |
|---|---|---|
| home page | pass | HTTP 200 |
| guest device registered on hosted | pass | 83519f5d |
| sign-in control present (accounts on) | pass | 1 control(s) |
| archive page renders | pass | 435 chars |
| Full guest play saved (#102) | pass | session in_progress, no owner |
| guess recorded | pass | 1 guess event(s) |
| stats dialog opens | pass | My Stats |
| mini daily page renders | pass | shell visible |
| Mini guest play saved (#1) | pass | 1 mini session |
| hosted sign-in redirects to WorkOS Staging | pass | HTTP 302 https://detailed-pink-69-staging.authkit.app/oauth2/authorize?client_id=<id>&code_challeng |
| every Rainbow account is linked to a shared identity | pass | 1 account(s), 1 linked |
| a beta auth user is not a Rainbow account | pass | {"outcome":"not_platform_linked","uid":null} |
| CrossPuns row counts unchanged | pass | xw_admins=2 xw_puzzles=13 xw_times=43 xw_votes=39 xw_joke_reactions=32 |
| no console errors | pass | none |
| cleanup | done | removed 2 session(s) and 1 device for 83519f5d |

All passed: true
