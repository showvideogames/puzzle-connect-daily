# Local shared-service PNG compatibility patch

This directory is a reviewable, **unapplied** shared-hub change. It is deliberately outside Rainbow's Supabase migrations. Nothing here has been deployed or written to a hosted service.

## Provenance and behavior

`fixtures/hub-eb238dd.sql` and `fixtures/uninstall.sql` are unchanged test snapshots from the local CrossPuns shared-social repository at `eb238dd`, originally `supabase/drafts/shared-social/0001_social_hub.sql` and its uninstall script. The original working tree was not edited. These fixtures are for isolated PGlite tests, not installation in Rainbow's database.

`patches/0002_png_group_photos.sql` adds bounded 256×256, 8-bit non-interlaced RGB/RGBA PNG support alongside existing JPEG support. It does not rewrite picture bytes, memberships or photo versions. The existing owner authorization, byte limit, storage column and gateway operation stay intact. The legacy `check_photo` output column remains named `jpeg` to preserve callers. PNG checking validates container structure, dimensions and allowed format; it is not a full decoder and does not check CRCs or decompress pixels (the existing JPEG checker likewise inspects structure).

Rainbow's `VITE_GROUP_PNG` flag defaults off. With it on, transparent crops are saved as PNG; opaque pictures remain JPEG. New images are resized to 256px. A transparent PNG exceeding the existing limit is refused with an explanation, never silently flattened. Existing JPEG and PNG pictures can be reopened for crop editing. The isolated browser fixture enables PNG without contacting a real service.

## Proposed release order — requires separate authorization

1. Review this patch against the actual shared-hub schema and coordinate the portable `contract.ts`/`memoryHub.ts` changes with its source repository. No other application has been changed here.
2. Apply and verify the shared-service patch before enabling `VITE_GROUP_PNG=true` in Rainbow. Verify real gateway reads/writes and existing JPEGs in the intended environment.
3. Enable the Rainbow flag only after that verification. Older clients can still send JPEGs; returned PNG data URLs render as images, but older editing tools may not be able to reopen PNGs.

To disable new PNG uploads, turn the Rainbow flag off. **Do not blindly revert `photo_url` to JPEG-only after PNGs have been stored**: existing PNG bytes require the correct MIME prefix. No destructive downgrade or data conversion is included.

## Local verification

Use Node 22+ from the repository root (this workspace uses `/tmp/node-v24.10.0-darwin-arm64/bin/node`):

```sh
node node_modules/vitest/vitest.mjs run --config shared-service/vitest.config.ts
SOCIAL_PGLITE="$PWD/node_modules/@electric-sql/pglite/dist/index.js" SOCIAL_REQUIRE_PGLITE=1 node --test shared-service/tests/hub-regression.test.mjs
node demo/profile-menu/check-transparency.mjs
```

The last command requires the isolated Vite preview on port 5215 and local Chrome. It blocks non-local requests and captures 320px/1440px, light/dark views. Service tests exercise the real SQL under the gateway role, including preservation of pre-upgrade JPEG data, transparent round trips, owner restrictions, malformed/oversized input and helper permissions. The regression suite also covers persistence and existing social behavior. No live account or service credentials are used.

## Private friend preferences (0003)

`0003_private_friend_preferences.sql` and the two new gateway operations store a viewer's favorite/nickname on the existing friendship. Preferences cascade away on unfriend/block/account deletion; they never change public profiles or results. The 24-character nickname limit reuses the existing display-name limit; null clears it. Both sides can set independent preferences. Table access is denied to app roles, with authenticated identity resolved by the existing gateway.

Deploy the SQL and updated gateway before enabling `VITE_SOCIAL_PREFERENCES=true`. This flag defaults off. Existing listFriends responses remain unchanged. The existing uninstall is schema-scoped with an outside-dependency guard, so it covers these additions without an allow-list change. It is exercised only on throwaway PGlite databases; no hosted uninstall was performed.

## Private group ordering (0004)

`0004_private_group_order.sql` adds a nullable position to each existing membership, and separate listGroupOrder/setGroupOrder gateway operations. It does not change listMyGroups, listMembers or listResults responses or their sorting. Each caller can order only their complete current membership list; invalid/duplicate/stale lists are rejected before updates. New memberships have no position and append after ordered memberships; leaving/removal deletes the membership's position naturally. No membership, score or personal history is created or removed by saving an order.

Deploy SQL and the gateway before enabling `VITE_GROUP_ORDER=true` (off by default). This is independent of the friend-preference and PNG flags. Position ties use existing joining time and membership ID. The UI offers a local draft with accessible Up/Down controls, Save and Cancel. The existing guarded schema teardown also covers these functions.
