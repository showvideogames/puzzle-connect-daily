-- Community Puzzles, creator covers (PREVIEW; not applied to any hosted database).
--
-- A creator may give their puzzle a cover made of exactly ONE emoji and ONE
-- preset background. Both are stored as KEYS and nothing else:
--   * cover_emoji is the emoji's fully-qualified code-point sequence
--     ("1F355" for pizza) and must be in community_cover_emoji, the allowlist
--     generated from the pinned emojibase-data release by
--     scripts/generate-cover-emoji.mjs (the same list the picker shows);
--   * cover_background is one of the 24 preset keys in
--     src/lib/coverBackgrounds.ts (a unit test holds the two lists together).
-- No uploads, links, text, markup or remote images can be stored: there is no
-- column for them, and both columns are constrained to the allowlists.
--
-- Additive and safe for every existing puzzle: both columns are null, which
-- means "no cover", and every surface then shows its default art. Covers are
-- set only by the puzzle's own signed-in creator, and never change its links,
-- content, visibility or listing. Editorial art (Featured / Editor's Picks)
-- is separate and stays an admin-only, app-side choice.
BEGIN;

CREATE TABLE public.community_cover_emoji (
    key text NOT NULL,
    CONSTRAINT community_cover_emoji_pkey PRIMARY KEY (key),
    CONSTRAINT community_cover_emoji_key_format CHECK ((key ~ '^[0-9A-F]{4,6}(-[0-9A-F]{4,6}){0,9}$'::text))
);
ALTER TABLE public.community_cover_emoji ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.community_cover_emoji FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.community_cover_emoji TO service_role;

-- BEGIN GENERATED EMOJI ALLOWLIST (npm run covers:emoji)
-- 1898 keys from emojibase-data@16.0.3 (Unicode CLDR labels); Emoji ≤ 15.1, normal skin tone.
INSERT INTO public.community_cover_emoji (key) VALUES
  ('1F600'), ('1F603'), ('1F604'), ('1F601'), ('1F606'), ('1F605'), ('1F923'), ('1F602'), ('1F642'), ('1F643'), ('1FAE0'), ('1F609'),
  ('1F60A'), ('1F607'), ('1F970'), ('1F60D'), ('1F929'), ('1F618'), ('1F617'), ('263A-FE0F'), ('1F61A'), ('1F619'), ('1F972'), ('1F60B'),
  ('1F61B'), ('1F61C'), ('1F92A'), ('1F61D'), ('1F911'), ('1F917'), ('1F92D'), ('1FAE2'), ('1FAE3'), ('1F92B'), ('1F914'), ('1FAE1'),
  ('1F910'), ('1F928'), ('1F610-FE0F'), ('1F611'), ('1F636'), ('1FAE5'), ('1F636-200D-1F32B-FE0F'), ('1F60F'), ('1F612'), ('1F644'), ('1F62C'), ('1F62E-200D-1F4A8'),
  ('1F925'), ('1FAE8'), ('1F642-200D-2194-FE0F'), ('1F642-200D-2195-FE0F'), ('1F60C'), ('1F614'), ('1F62A'), ('1F924'), ('1F634'), ('1F637'), ('1F912'), ('1F915'),
  ('1F922'), ('1F92E'), ('1F927'), ('1F975'), ('1F976'), ('1F974'), ('1F635'), ('1F635-200D-1F4AB'), ('1F92F'), ('1F920'), ('1F973'), ('1F978'),
  ('1F60E'), ('1F913'), ('1F9D0'), ('1F615'), ('1FAE4'), ('1F61F'), ('1F641'), ('2639-FE0F'), ('1F62E'), ('1F62F'), ('1F632'), ('1F633'),
  ('1F97A'), ('1F979'), ('1F626'), ('1F627'), ('1F628'), ('1F630'), ('1F625'), ('1F622'), ('1F62D'), ('1F631'), ('1F616'), ('1F623'),
  ('1F61E'), ('1F613'), ('1F629'), ('1F62B'), ('1F971'), ('1F624'), ('1F621'), ('1F620'), ('1F92C'), ('1F608'), ('1F47F'), ('1F480'),
  ('2620-FE0F'), ('1F4A9'), ('1F921'), ('1F479'), ('1F47A'), ('1F47B'), ('1F47D-FE0F'), ('1F47E'), ('1F916'), ('1F63A'), ('1F638'), ('1F639'),
  ('1F63B'), ('1F63C'), ('1F63D'), ('1F640'), ('1F63F'), ('1F63E'), ('1F648'), ('1F649'), ('1F64A'), ('1F48C'), ('1F498'), ('1F49D'),
  ('1F496'), ('1F497'), ('1F493'), ('1F49E'), ('1F495'), ('1F49F'), ('2763-FE0F'), ('1F494'), ('2764-FE0F-200D-1F525'), ('2764-FE0F-200D-1FA79'), ('2764-FE0F'), ('1FA77'),
  ('1F9E1'), ('1F49B'), ('1F49A'), ('1F499'), ('1FA75'), ('1F49C'), ('1F90E'), ('1F5A4'), ('1FA76'), ('1F90D'), ('1F48B'), ('1F4AF'),
  ('1F4A2'), ('1F4A5'), ('1F4AB'), ('1F4A6'), ('1F4A8'), ('1F573-FE0F'), ('1F4AC'), ('1F441-FE0F-200D-1F5E8-FE0F'), ('1F5E8-FE0F'), ('1F5EF-FE0F'), ('1F4AD'), ('1F4A4'),
  ('1F44B'), ('1F91A'), ('1F590-FE0F'), ('270B-FE0F'), ('1F596'), ('1FAF1'), ('1FAF2'), ('1FAF3'), ('1FAF4'), ('1FAF7'), ('1FAF8'), ('1F44C'),
  ('1F90C'), ('1F90F'), ('270C-FE0F'), ('1F91E'), ('1FAF0'), ('1F91F'), ('1F918'), ('1F919'), ('1F448-FE0F'), ('1F449-FE0F'), ('1F446-FE0F'), ('1F595'),
  ('1F447-FE0F'), ('261D-FE0F'), ('1FAF5'), ('1F44D-FE0F'), ('1F44E-FE0F'), ('270A-FE0F'), ('1F44A'), ('1F91B'), ('1F91C'), ('1F44F'), ('1F64C'), ('1FAF6'),
  ('1F450'), ('1F932'), ('1F91D'), ('1F64F'), ('270D-FE0F'), ('1F485'), ('1F933'), ('1F4AA'), ('1F9BE'), ('1F9BF'), ('1F9B5'), ('1F9B6'),
  ('1F442-FE0F'), ('1F9BB'), ('1F443'), ('1F9E0'), ('1FAC0'), ('1FAC1'), ('1F9B7'), ('1F9B4'), ('1F440'), ('1F441-FE0F'), ('1F445'), ('1F444'),
  ('1FAE6'), ('1F476'), ('1F9D2'), ('1F466'), ('1F467'), ('1F9D1'), ('1F471'), ('1F468'), ('1F9D4'), ('1F9D4-200D-2642-FE0F'), ('1F9D4-200D-2640-FE0F'), ('1F468-200D-1F9B0'),
  ('1F468-200D-1F9B1'), ('1F468-200D-1F9B3'), ('1F468-200D-1F9B2'), ('1F469'), ('1F469-200D-1F9B0'), ('1F9D1-200D-1F9B0'), ('1F469-200D-1F9B1'), ('1F9D1-200D-1F9B1'), ('1F469-200D-1F9B3'), ('1F9D1-200D-1F9B3'), ('1F469-200D-1F9B2'), ('1F9D1-200D-1F9B2'),
  ('1F471-200D-2640-FE0F'), ('1F471-200D-2642-FE0F'), ('1F9D3'), ('1F474'), ('1F475'), ('1F64D'), ('1F64D-200D-2642-FE0F'), ('1F64D-200D-2640-FE0F'), ('1F64E'), ('1F64E-200D-2642-FE0F'), ('1F64E-200D-2640-FE0F'), ('1F645'),
  ('1F645-200D-2642-FE0F'), ('1F645-200D-2640-FE0F'), ('1F646'), ('1F646-200D-2642-FE0F'), ('1F646-200D-2640-FE0F'), ('1F481'), ('1F481-200D-2642-FE0F'), ('1F481-200D-2640-FE0F'), ('1F64B'), ('1F64B-200D-2642-FE0F'), ('1F64B-200D-2640-FE0F'), ('1F9CF'),
  ('1F9CF-200D-2642-FE0F'), ('1F9CF-200D-2640-FE0F'), ('1F647'), ('1F647-200D-2642-FE0F'), ('1F647-200D-2640-FE0F'), ('1F926'), ('1F926-200D-2642-FE0F'), ('1F926-200D-2640-FE0F'), ('1F937'), ('1F937-200D-2642-FE0F'), ('1F937-200D-2640-FE0F'), ('1F9D1-200D-2695-FE0F'),
  ('1F468-200D-2695-FE0F'), ('1F469-200D-2695-FE0F'), ('1F9D1-200D-1F393'), ('1F468-200D-1F393'), ('1F469-200D-1F393'), ('1F9D1-200D-1F3EB'), ('1F468-200D-1F3EB'), ('1F469-200D-1F3EB'), ('1F9D1-200D-2696-FE0F'), ('1F468-200D-2696-FE0F'), ('1F469-200D-2696-FE0F'), ('1F9D1-200D-1F33E'),
  ('1F468-200D-1F33E'), ('1F469-200D-1F33E'), ('1F9D1-200D-1F373'), ('1F468-200D-1F373'), ('1F469-200D-1F373'), ('1F9D1-200D-1F527'), ('1F468-200D-1F527'), ('1F469-200D-1F527'), ('1F9D1-200D-1F3ED'), ('1F468-200D-1F3ED'), ('1F469-200D-1F3ED'), ('1F9D1-200D-1F4BC'),
  ('1F468-200D-1F4BC'), ('1F469-200D-1F4BC'), ('1F9D1-200D-1F52C'), ('1F468-200D-1F52C'), ('1F469-200D-1F52C'), ('1F9D1-200D-1F4BB'), ('1F468-200D-1F4BB'), ('1F469-200D-1F4BB'), ('1F9D1-200D-1F3A4'), ('1F468-200D-1F3A4'), ('1F469-200D-1F3A4'), ('1F9D1-200D-1F3A8'),
  ('1F468-200D-1F3A8'), ('1F469-200D-1F3A8'), ('1F9D1-200D-2708-FE0F'), ('1F468-200D-2708-FE0F'), ('1F469-200D-2708-FE0F'), ('1F9D1-200D-1F680'), ('1F468-200D-1F680'), ('1F469-200D-1F680'), ('1F9D1-200D-1F692'), ('1F468-200D-1F692'), ('1F469-200D-1F692'), ('1F46E'),
  ('1F46E-200D-2642-FE0F'), ('1F46E-200D-2640-FE0F'), ('1F575-FE0F'), ('1F575-FE0F-200D-2642-FE0F'), ('1F575-FE0F-200D-2640-FE0F'), ('1F482'), ('1F482-200D-2642-FE0F'), ('1F482-200D-2640-FE0F'), ('1F977'), ('1F477'), ('1F477-200D-2642-FE0F'), ('1F477-200D-2640-FE0F'),
  ('1FAC5'), ('1F934'), ('1F478'), ('1F473'), ('1F473-200D-2642-FE0F'), ('1F473-200D-2640-FE0F'), ('1F472'), ('1F9D5'), ('1F935'), ('1F935-200D-2642-FE0F'), ('1F935-200D-2640-FE0F'), ('1F470'),
  ('1F470-200D-2642-FE0F'), ('1F470-200D-2640-FE0F'), ('1F930'), ('1FAC3'), ('1FAC4'), ('1F931'), ('1F469-200D-1F37C'), ('1F468-200D-1F37C'), ('1F9D1-200D-1F37C'), ('1F47C'), ('1F385'), ('1F936'),
  ('1F9D1-200D-1F384'), ('1F9B8'), ('1F9B8-200D-2642-FE0F'), ('1F9B8-200D-2640-FE0F'), ('1F9B9'), ('1F9B9-200D-2642-FE0F'), ('1F9B9-200D-2640-FE0F'), ('1F9D9'), ('1F9D9-200D-2642-FE0F'), ('1F9D9-200D-2640-FE0F'), ('1F9DA'), ('1F9DA-200D-2642-FE0F'),
  ('1F9DA-200D-2640-FE0F'), ('1F9DB'), ('1F9DB-200D-2642-FE0F'), ('1F9DB-200D-2640-FE0F'), ('1F9DC'), ('1F9DC-200D-2642-FE0F'), ('1F9DC-200D-2640-FE0F'), ('1F9DD'), ('1F9DD-200D-2642-FE0F'), ('1F9DD-200D-2640-FE0F'), ('1F9DE'), ('1F9DE-200D-2642-FE0F'),
  ('1F9DE-200D-2640-FE0F'), ('1F9DF'), ('1F9DF-200D-2642-FE0F'), ('1F9DF-200D-2640-FE0F'), ('1F9CC'), ('1F486'), ('1F486-200D-2642-FE0F'), ('1F486-200D-2640-FE0F'), ('1F487'), ('1F487-200D-2642-FE0F'), ('1F487-200D-2640-FE0F'), ('1F6B6'),
  ('1F6B6-200D-2642-FE0F'), ('1F6B6-200D-2640-FE0F'), ('1F6B6-200D-27A1-FE0F'), ('1F6B6-200D-2640-FE0F-200D-27A1-FE0F'), ('1F6B6-200D-2642-FE0F-200D-27A1-FE0F'), ('1F9CD'), ('1F9CD-200D-2642-FE0F'), ('1F9CD-200D-2640-FE0F'), ('1F9CE'), ('1F9CE-200D-2642-FE0F'), ('1F9CE-200D-2640-FE0F'), ('1F9CE-200D-27A1-FE0F'),
  ('1F9CE-200D-2640-FE0F-200D-27A1-FE0F'), ('1F9CE-200D-2642-FE0F-200D-27A1-FE0F'), ('1F9D1-200D-1F9AF'), ('1F9D1-200D-1F9AF-200D-27A1-FE0F'), ('1F468-200D-1F9AF'), ('1F468-200D-1F9AF-200D-27A1-FE0F'), ('1F469-200D-1F9AF'), ('1F469-200D-1F9AF-200D-27A1-FE0F'), ('1F9D1-200D-1F9BC'), ('1F9D1-200D-1F9BC-200D-27A1-FE0F'), ('1F468-200D-1F9BC'), ('1F468-200D-1F9BC-200D-27A1-FE0F'),
  ('1F469-200D-1F9BC'), ('1F469-200D-1F9BC-200D-27A1-FE0F'), ('1F9D1-200D-1F9BD'), ('1F9D1-200D-1F9BD-200D-27A1-FE0F'), ('1F468-200D-1F9BD'), ('1F468-200D-1F9BD-200D-27A1-FE0F'), ('1F469-200D-1F9BD'), ('1F469-200D-1F9BD-200D-27A1-FE0F'), ('1F3C3'), ('1F3C3-200D-2642-FE0F'), ('1F3C3-200D-2640-FE0F'), ('1F3C3-200D-27A1-FE0F'),
  ('1F3C3-200D-2640-FE0F-200D-27A1-FE0F'), ('1F3C3-200D-2642-FE0F-200D-27A1-FE0F'), ('1F483'), ('1F57A'), ('1F574-FE0F'), ('1F46F'), ('1F46F-200D-2642-FE0F'), ('1F46F-200D-2640-FE0F'), ('1F9D6'), ('1F9D6-200D-2642-FE0F'), ('1F9D6-200D-2640-FE0F'), ('1F9D7'),
  ('1F9D7-200D-2642-FE0F'), ('1F9D7-200D-2640-FE0F'), ('1F93A'), ('1F3C7'), ('26F7-FE0F'), ('1F3C2-FE0F'), ('1F3CC-FE0F'), ('1F3CC-FE0F-200D-2642-FE0F'), ('1F3CC-FE0F-200D-2640-FE0F'), ('1F3C4-FE0F'), ('1F3C4-200D-2642-FE0F'), ('1F3C4-200D-2640-FE0F'),
  ('1F6A3'), ('1F6A3-200D-2642-FE0F'), ('1F6A3-200D-2640-FE0F'), ('1F3CA-FE0F'), ('1F3CA-200D-2642-FE0F'), ('1F3CA-200D-2640-FE0F'), ('26F9-FE0F'), ('26F9-FE0F-200D-2642-FE0F'), ('26F9-FE0F-200D-2640-FE0F'), ('1F3CB-FE0F'), ('1F3CB-FE0F-200D-2642-FE0F'), ('1F3CB-FE0F-200D-2640-FE0F'),
  ('1F6B4'), ('1F6B4-200D-2642-FE0F'), ('1F6B4-200D-2640-FE0F'), ('1F6B5'), ('1F6B5-200D-2642-FE0F'), ('1F6B5-200D-2640-FE0F'), ('1F938'), ('1F938-200D-2642-FE0F'), ('1F938-200D-2640-FE0F'), ('1F93C'), ('1F93C-200D-2642-FE0F'), ('1F93C-200D-2640-FE0F'),
  ('1F93D'), ('1F93D-200D-2642-FE0F'), ('1F93D-200D-2640-FE0F'), ('1F93E'), ('1F93E-200D-2642-FE0F'), ('1F93E-200D-2640-FE0F'), ('1F939'), ('1F939-200D-2642-FE0F'), ('1F939-200D-2640-FE0F'), ('1F9D8'), ('1F9D8-200D-2642-FE0F'), ('1F9D8-200D-2640-FE0F'),
  ('1F6C0'), ('1F6CC'), ('1F9D1-200D-1F91D-200D-1F9D1'), ('1F46D'), ('1F46B'), ('1F46C'), ('1F48F'), ('1F469-200D-2764-FE0F-200D-1F48B-200D-1F468'), ('1F468-200D-2764-FE0F-200D-1F48B-200D-1F468'), ('1F469-200D-2764-FE0F-200D-1F48B-200D-1F469'), ('1F491'), ('1F469-200D-2764-FE0F-200D-1F468'),
  ('1F468-200D-2764-FE0F-200D-1F468'), ('1F469-200D-2764-FE0F-200D-1F469'), ('1F468-200D-1F469-200D-1F466'), ('1F468-200D-1F469-200D-1F467'), ('1F468-200D-1F469-200D-1F467-200D-1F466'), ('1F468-200D-1F469-200D-1F466-200D-1F466'), ('1F468-200D-1F469-200D-1F467-200D-1F467'), ('1F468-200D-1F468-200D-1F466'), ('1F468-200D-1F468-200D-1F467'), ('1F468-200D-1F468-200D-1F467-200D-1F466'), ('1F468-200D-1F468-200D-1F466-200D-1F466'), ('1F468-200D-1F468-200D-1F467-200D-1F467'),
  ('1F469-200D-1F469-200D-1F466'), ('1F469-200D-1F469-200D-1F467'), ('1F469-200D-1F469-200D-1F467-200D-1F466'), ('1F469-200D-1F469-200D-1F466-200D-1F466'), ('1F469-200D-1F469-200D-1F467-200D-1F467'), ('1F468-200D-1F466'), ('1F468-200D-1F466-200D-1F466'), ('1F468-200D-1F467'), ('1F468-200D-1F467-200D-1F466'), ('1F468-200D-1F467-200D-1F467'), ('1F469-200D-1F466'), ('1F469-200D-1F466-200D-1F466'),
  ('1F469-200D-1F467'), ('1F469-200D-1F467-200D-1F466'), ('1F469-200D-1F467-200D-1F467'), ('1F5E3-FE0F'), ('1F464'), ('1F465'), ('1FAC2'), ('1F46A-FE0F'), ('1F9D1-200D-1F9D1-200D-1F9D2'), ('1F9D1-200D-1F9D1-200D-1F9D2-200D-1F9D2'), ('1F9D1-200D-1F9D2'), ('1F9D1-200D-1F9D2-200D-1F9D2'),
  ('1F463'), ('1F435'), ('1F412'), ('1F98D'), ('1F9A7'), ('1F436'), ('1F415-FE0F'), ('1F9AE'), ('1F415-200D-1F9BA'), ('1F429'), ('1F43A'), ('1F98A'),
  ('1F99D'), ('1F431'), ('1F408-FE0F'), ('1F408-200D-2B1B'), ('1F981'), ('1F42F'), ('1F405'), ('1F406'), ('1F434'), ('1FACE'), ('1FACF'), ('1F40E'),
  ('1F984'), ('1F993'), ('1F98C'), ('1F9AC'), ('1F42E'), ('1F402'), ('1F403'), ('1F404'), ('1F437'), ('1F416'), ('1F417'), ('1F43D'),
  ('1F40F'), ('1F411'), ('1F410'), ('1F42A'), ('1F42B'), ('1F999'), ('1F992'), ('1F418'), ('1F9A3'), ('1F98F'), ('1F99B'), ('1F42D'),
  ('1F401'), ('1F400'), ('1F439'), ('1F430'), ('1F407'), ('1F43F-FE0F'), ('1F9AB'), ('1F994'), ('1F987'), ('1F43B'), ('1F43B-200D-2744-FE0F'), ('1F428'),
  ('1F43C'), ('1F9A5'), ('1F9A6'), ('1F9A8'), ('1F998'), ('1F9A1'), ('1F43E'), ('1F983'), ('1F414'), ('1F413'), ('1F423'), ('1F424'),
  ('1F425'), ('1F426-FE0F'), ('1F427'), ('1F54A-FE0F'), ('1F985'), ('1F986'), ('1F9A2'), ('1F989'), ('1F9A4'), ('1FAB6'), ('1F9A9'), ('1F99A'),
  ('1F99C'), ('1FABD'), ('1F426-200D-2B1B'), ('1FABF'), ('1F426-200D-1F525'), ('1F438'), ('1F40A'), ('1F422'), ('1F98E'), ('1F40D'), ('1F432'), ('1F409'),
  ('1F995'), ('1F996'), ('1F433'), ('1F40B'), ('1F42C'), ('1F9AD'), ('1F41F-FE0F'), ('1F420'), ('1F421'), ('1F988'), ('1F419'), ('1F41A'),
  ('1FAB8'), ('1FABC'), ('1F980'), ('1F99E'), ('1F990'), ('1F991'), ('1F9AA'), ('1F40C'), ('1F98B'), ('1F41B'), ('1F41C'), ('1F41D'),
  ('1FAB2'), ('1F41E'), ('1F997'), ('1FAB3'), ('1F577-FE0F'), ('1F578-FE0F'), ('1F982'), ('1F99F'), ('1FAB0'), ('1FAB1'), ('1F9A0'), ('1F490'),
  ('1F338'), ('1F4AE'), ('1FAB7'), ('1F3F5-FE0F'), ('1F339'), ('1F940'), ('1F33A'), ('1F33B'), ('1F33C'), ('1F337'), ('1FABB'), ('1F331'),
  ('1FAB4'), ('1F332'), ('1F333'), ('1F334'), ('1F335'), ('1F33E'), ('1F33F'), ('2618-FE0F'), ('1F340'), ('1F341'), ('1F342'), ('1F343'),
  ('1FAB9'), ('1FABA'), ('1F344'), ('1F347'), ('1F348'), ('1F349'), ('1F34A'), ('1F34B'), ('1F34B-200D-1F7E9'), ('1F34C'), ('1F34D'), ('1F96D'),
  ('1F34E'), ('1F34F'), ('1F350'), ('1F351'), ('1F352'), ('1F353'), ('1FAD0'), ('1F95D'), ('1F345'), ('1FAD2'), ('1F965'), ('1F951'),
  ('1F346'), ('1F954'), ('1F955'), ('1F33D'), ('1F336-FE0F'), ('1FAD1'), ('1F952'), ('1F96C'), ('1F966'), ('1F9C4'), ('1F9C5'), ('1F95C'),
  ('1FAD8'), ('1F330'), ('1FADA'), ('1FADB'), ('1F344-200D-1F7EB'), ('1F35E'), ('1F950'), ('1F956'), ('1FAD3'), ('1F968'), ('1F96F'), ('1F95E'),
  ('1F9C7'), ('1F9C0'), ('1F356'), ('1F357'), ('1F969'), ('1F953'), ('1F354'), ('1F35F'), ('1F355'), ('1F32D'), ('1F96A'), ('1F32E'),
  ('1F32F'), ('1FAD4'), ('1F959'), ('1F9C6'), ('1F95A'), ('1F373'), ('1F958'), ('1F372'), ('1FAD5'), ('1F963'), ('1F957'), ('1F37F'),
  ('1F9C8'), ('1F9C2'), ('1F96B'), ('1F371'), ('1F358'), ('1F359'), ('1F35A'), ('1F35B'), ('1F35C'), ('1F35D'), ('1F360'), ('1F362'),
  ('1F363'), ('1F364'), ('1F365'), ('1F96E'), ('1F361'), ('1F95F'), ('1F960'), ('1F961'), ('1F366'), ('1F367'), ('1F368'), ('1F369'),
  ('1F36A'), ('1F382'), ('1F370'), ('1F9C1'), ('1F967'), ('1F36B'), ('1F36C'), ('1F36D'), ('1F36E'), ('1F36F'), ('1F37C'), ('1F95B'),
  ('2615-FE0F'), ('1FAD6'), ('1F375'), ('1F376'), ('1F37E'), ('1F377'), ('1F378-FE0F'), ('1F379'), ('1F37A'), ('1F37B'), ('1F942'), ('1F943'),
  ('1FAD7'), ('1F964'), ('1F9CB'), ('1F9C3'), ('1F9C9'), ('1F9CA'), ('1F962'), ('1F37D-FE0F'), ('1F374'), ('1F944'), ('1F52A'), ('1FAD9'),
  ('1F3FA'), ('1F30D-FE0F'), ('1F30E-FE0F'), ('1F30F-FE0F'), ('1F310'), ('1F5FA-FE0F'), ('1F5FE'), ('1F9ED'), ('1F3D4-FE0F'), ('26F0-FE0F'), ('1F30B'), ('1F5FB'),
  ('1F3D5-FE0F'), ('1F3D6-FE0F'), ('1F3DC-FE0F'), ('1F3DD-FE0F'), ('1F3DE-FE0F'), ('1F3DF-FE0F'), ('1F3DB-FE0F'), ('1F3D7-FE0F'), ('1F9F1'), ('1FAA8'), ('1FAB5'), ('1F6D6'),
  ('1F3D8-FE0F'), ('1F3DA-FE0F'), ('1F3E0-FE0F'), ('1F3E1'), ('1F3E2'), ('1F3E3'), ('1F3E4'), ('1F3E5'), ('1F3E6'), ('1F3E8'), ('1F3E9'), ('1F3EA'),
  ('1F3EB'), ('1F3EC'), ('1F3ED-FE0F'), ('1F3EF'), ('1F3F0'), ('1F492'), ('1F5FC'), ('1F5FD'), ('26EA-FE0F'), ('1F54C'), ('1F6D5'), ('1F54D'),
  ('26E9-FE0F'), ('1F54B'), ('26F2-FE0F'), ('26FA-FE0F'), ('1F301'), ('1F303'), ('1F3D9-FE0F'), ('1F304'), ('1F305'), ('1F306'), ('1F307'), ('1F309'),
  ('2668-FE0F'), ('1F3A0'), ('1F6DD'), ('1F3A1'), ('1F3A2'), ('1F488'), ('1F3AA'), ('1F682'), ('1F683'), ('1F684'), ('1F685'), ('1F686'),
  ('1F687-FE0F'), ('1F688'), ('1F689'), ('1F68A'), ('1F69D'), ('1F69E'), ('1F68B'), ('1F68C'), ('1F68D-FE0F'), ('1F68E'), ('1F690'), ('1F691-FE0F'),
  ('1F692'), ('1F693'), ('1F694-FE0F'), ('1F695'), ('1F696'), ('1F697'), ('1F698-FE0F'), ('1F699'), ('1F6FB'), ('1F69A'), ('1F69B'), ('1F69C'),
  ('1F3CE-FE0F'), ('1F3CD-FE0F'), ('1F6F5'), ('1F9BD'), ('1F9BC'), ('1F6FA'), ('1F6B2-FE0F'), ('1F6F4'), ('1F6F9'), ('1F6FC'), ('1F68F'), ('1F6E3-FE0F'),
  ('1F6E4-FE0F'), ('1F6E2-FE0F'), ('26FD-FE0F'), ('1F6DE'), ('1F6A8'), ('1F6A5'), ('1F6A6'), ('1F6D1'), ('1F6A7'), ('2693-FE0F'), ('1F6DF'), ('26F5-FE0F'),
  ('1F6F6'), ('1F6A4'), ('1F6F3-FE0F'), ('26F4-FE0F'), ('1F6E5-FE0F'), ('1F6A2'), ('2708-FE0F'), ('1F6E9-FE0F'), ('1F6EB'), ('1F6EC'), ('1FA82'), ('1F4BA'),
  ('1F681'), ('1F69F'), ('1F6A0'), ('1F6A1'), ('1F6F0-FE0F'), ('1F680'), ('1F6F8'), ('1F6CE-FE0F'), ('1F9F3'), ('231B-FE0F'), ('23F3-FE0F'), ('231A-FE0F'),
  ('23F0-FE0F'), ('23F1-FE0F'), ('23F2-FE0F'), ('1F570-FE0F'), ('1F55B-FE0F'), ('1F567-FE0F'), ('1F550-FE0F'), ('1F55C-FE0F'), ('1F551-FE0F'), ('1F55D-FE0F'), ('1F552-FE0F'), ('1F55E-FE0F'),
  ('1F553-FE0F'), ('1F55F-FE0F'), ('1F554-FE0F'), ('1F560-FE0F'), ('1F555-FE0F'), ('1F561-FE0F'), ('1F556-FE0F'), ('1F562-FE0F'), ('1F557-FE0F'), ('1F563-FE0F'), ('1F558-FE0F'), ('1F564-FE0F'),
  ('1F559-FE0F'), ('1F565-FE0F'), ('1F55A-FE0F'), ('1F566-FE0F'), ('1F311'), ('1F312'), ('1F313'), ('1F314'), ('1F315-FE0F'), ('1F316'), ('1F317'), ('1F318'),
  ('1F319'), ('1F31A'), ('1F31B'), ('1F31C-FE0F'), ('1F321-FE0F'), ('2600-FE0F'), ('1F31D'), ('1F31E'), ('1FA90'), ('2B50-FE0F'), ('1F31F'), ('1F320'),
  ('1F30C'), ('2601-FE0F'), ('26C5-FE0F'), ('26C8-FE0F'), ('1F324-FE0F'), ('1F325-FE0F'), ('1F326-FE0F'), ('1F327-FE0F'), ('1F328-FE0F'), ('1F329-FE0F'), ('1F32A-FE0F'), ('1F32B-FE0F'),
  ('1F32C-FE0F'), ('1F300'), ('1F308'), ('1F302'), ('2602-FE0F'), ('2614-FE0F'), ('26F1-FE0F'), ('26A1-FE0F'), ('2744-FE0F'), ('2603-FE0F'), ('26C4-FE0F'), ('2604-FE0F'),
  ('1F525'), ('1F4A7'), ('1F30A'), ('1F383'), ('1F384'), ('1F386'), ('1F387'), ('1F9E8'), ('2728-FE0F'), ('1F388'), ('1F389'), ('1F38A'),
  ('1F38B'), ('1F38D'), ('1F38E'), ('1F38F'), ('1F390'), ('1F391'), ('1F9E7'), ('1F380'), ('1F381'), ('1F397-FE0F'), ('1F39F-FE0F'), ('1F3AB'),
  ('1F396-FE0F'), ('1F3C6-FE0F'), ('1F3C5'), ('1F947'), ('1F948'), ('1F949'), ('26BD-FE0F'), ('26BE-FE0F'), ('1F94E'), ('1F3C0'), ('1F3D0'), ('1F3C8'),
  ('1F3C9'), ('1F3BE'), ('1F94F'), ('1F3B3'), ('1F3CF'), ('1F3D1'), ('1F3D2'), ('1F94D'), ('1F3D3'), ('1F3F8'), ('1F94A'), ('1F94B'),
  ('1F945'), ('26F3-FE0F'), ('26F8-FE0F'), ('1F3A3'), ('1F93F'), ('1F3BD'), ('1F3BF'), ('1F6F7'), ('1F94C'), ('1F3AF'), ('1FA80'), ('1FA81'),
  ('1F52B'), ('1F3B1'), ('1F52E'), ('1FA84'), ('1F3AE-FE0F'), ('1F579-FE0F'), ('1F3B0'), ('1F3B2'), ('1F9E9'), ('1F9F8'), ('1FA85'), ('1FAA9'),
  ('1FA86'), ('2660-FE0F'), ('2665-FE0F'), ('2666-FE0F'), ('2663-FE0F'), ('265F-FE0F'), ('1F0CF'), ('1F004-FE0F'), ('1F3B4'), ('1F3AD-FE0F'), ('1F5BC-FE0F'), ('1F3A8'),
  ('1F9F5'), ('1FAA1'), ('1F9F6'), ('1FAA2'), ('1F453-FE0F'), ('1F576-FE0F'), ('1F97D'), ('1F97C'), ('1F9BA'), ('1F454'), ('1F455'), ('1F456'),
  ('1F9E3'), ('1F9E4'), ('1F9E5'), ('1F9E6'), ('1F457'), ('1F458'), ('1F97B'), ('1FA71'), ('1FA72'), ('1FA73'), ('1F459'), ('1F45A'),
  ('1FAAD'), ('1F45B'), ('1F45C'), ('1F45D'), ('1F6CD-FE0F'), ('1F392'), ('1FA74'), ('1F45E'), ('1F45F'), ('1F97E'), ('1F97F'), ('1F460'),
  ('1F461'), ('1FA70'), ('1F462'), ('1FAAE'), ('1F451'), ('1F452'), ('1F3A9'), ('1F393-FE0F'), ('1F9E2'), ('1FA96'), ('26D1-FE0F'), ('1F4FF'),
  ('1F484'), ('1F48D'), ('1F48E'), ('1F507'), ('1F508-FE0F'), ('1F509'), ('1F50A'), ('1F4E2'), ('1F4E3'), ('1F4EF'), ('1F514'), ('1F515'),
  ('1F3BC'), ('1F3B5'), ('1F3B6'), ('1F399-FE0F'), ('1F39A-FE0F'), ('1F39B-FE0F'), ('1F3A4'), ('1F3A7-FE0F'), ('1F4FB-FE0F'), ('1F3B7'), ('1FA97'), ('1F3B8'),
  ('1F3B9'), ('1F3BA'), ('1F3BB'), ('1FA95'), ('1F941'), ('1FA98'), ('1FA87'), ('1FA88'), ('1F4F1'), ('1F4F2'), ('260E-FE0F'), ('1F4DE'),
  ('1F4DF-FE0F'), ('1F4E0'), ('1F50B'), ('1FAAB'), ('1F50C'), ('1F4BB-FE0F'), ('1F5A5-FE0F'), ('1F5A8-FE0F'), ('2328-FE0F'), ('1F5B1-FE0F'), ('1F5B2-FE0F'), ('1F4BD'),
  ('1F4BE'), ('1F4BF-FE0F'), ('1F4C0'), ('1F9EE'), ('1F3A5'), ('1F39E-FE0F'), ('1F4FD-FE0F'), ('1F3AC-FE0F'), ('1F4FA-FE0F'), ('1F4F7-FE0F'), ('1F4F8'), ('1F4F9-FE0F'),
  ('1F4FC'), ('1F50D-FE0F'), ('1F50E'), ('1F56F-FE0F'), ('1F4A1'), ('1F526'), ('1F3EE'), ('1FA94'), ('1F4D4'), ('1F4D5'), ('1F4D6'), ('1F4D7'),
  ('1F4D8'), ('1F4D9'), ('1F4DA-FE0F'), ('1F4D3'), ('1F4D2'), ('1F4C3'), ('1F4DC'), ('1F4C4'), ('1F4F0'), ('1F5DE-FE0F'), ('1F4D1'), ('1F516'),
  ('1F3F7-FE0F'), ('1F4B0-FE0F'), ('1FA99'), ('1F4B4'), ('1F4B5'), ('1F4B6'), ('1F4B7'), ('1F4B8'), ('1F4B3-FE0F'), ('1F9FE'), ('1F4B9'), ('2709-FE0F'),
  ('1F4E7'), ('1F4E8'), ('1F4E9'), ('1F4E4-FE0F'), ('1F4E5-FE0F'), ('1F4E6-FE0F'), ('1F4EB-FE0F'), ('1F4EA-FE0F'), ('1F4EC-FE0F'), ('1F4ED-FE0F'), ('1F4EE'), ('1F5F3-FE0F'),
  ('270F-FE0F'), ('2712-FE0F'), ('1F58B-FE0F'), ('1F58A-FE0F'), ('1F58C-FE0F'), ('1F58D-FE0F'), ('1F4DD'), ('1F4BC'), ('1F4C1'), ('1F4C2'), ('1F5C2-FE0F'), ('1F4C5'),
  ('1F4C6'), ('1F5D2-FE0F'), ('1F5D3-FE0F'), ('1F4C7'), ('1F4C8'), ('1F4C9'), ('1F4CA'), ('1F4CB-FE0F'), ('1F4CC'), ('1F4CD'), ('1F4CE'), ('1F587-FE0F'),
  ('1F4CF'), ('1F4D0'), ('2702-FE0F'), ('1F5C3-FE0F'), ('1F5C4-FE0F'), ('1F5D1-FE0F'), ('1F512-FE0F'), ('1F513-FE0F'), ('1F50F'), ('1F510'), ('1F511'), ('1F5DD-FE0F'),
  ('1F528'), ('1FA93'), ('26CF-FE0F'), ('2692-FE0F'), ('1F6E0-FE0F'), ('1F5E1-FE0F'), ('2694-FE0F'), ('1F4A3-FE0F'), ('1FA83'), ('1F3F9'), ('1F6E1-FE0F'), ('1FA9A'),
  ('1F527'), ('1FA9B'), ('1F529'), ('2699-FE0F'), ('1F5DC-FE0F'), ('2696-FE0F'), ('1F9AF'), ('1F517'), ('26D3-FE0F-200D-1F4A5'), ('26D3-FE0F'), ('1FA9D'), ('1F9F0'),
  ('1F9F2'), ('1FA9C'), ('2697-FE0F'), ('1F9EA'), ('1F9EB'), ('1F9EC'), ('1F52C'), ('1F52D'), ('1F4E1'), ('1F489'), ('1FA78'), ('1F48A'),
  ('1FA79'), ('1FA7C'), ('1FA7A'), ('1FA7B'), ('1F6AA'), ('1F6D7'), ('1FA9E'), ('1FA9F'), ('1F6CF-FE0F'), ('1F6CB-FE0F'), ('1FA91'), ('1F6BD'),
  ('1FAA0'), ('1F6BF'), ('1F6C1'), ('1FAA4'), ('1FA92'), ('1F9F4'), ('1F9F7'), ('1F9F9'), ('1F9FA'), ('1F9FB'), ('1FAA3'), ('1F9FC'),
  ('1FAE7'), ('1FAA5'), ('1F9FD'), ('1F9EF'), ('1F6D2'), ('1F6AC'), ('26B0-FE0F'), ('1FAA6'), ('26B1-FE0F'), ('1F9FF'), ('1FAAC'), ('1F5FF'),
  ('1FAA7'), ('1FAAA'), ('1F3E7'), ('1F6AE'), ('1F6B0'), ('267F-FE0F'), ('1F6B9-FE0F'), ('1F6BA-FE0F'), ('1F6BB'), ('1F6BC-FE0F'), ('1F6BE'), ('1F6C2'),
  ('1F6C3'), ('1F6C4'), ('1F6C5'), ('26A0-FE0F'), ('1F6B8'), ('26D4-FE0F'), ('1F6AB'), ('1F6B3'), ('1F6AD-FE0F'), ('1F6AF'), ('1F6B1'), ('1F6B7'),
  ('1F4F5'), ('1F51E'), ('2622-FE0F'), ('2623-FE0F'), ('2B06-FE0F'), ('2197-FE0F'), ('27A1-FE0F'), ('2198-FE0F'), ('2B07-FE0F'), ('2199-FE0F'), ('2B05-FE0F'), ('2196-FE0F'),
  ('2195-FE0F'), ('2194-FE0F'), ('21A9-FE0F'), ('21AA-FE0F'), ('2934-FE0F'), ('2935-FE0F'), ('1F503'), ('1F504'), ('1F519'), ('1F51A'), ('1F51B'), ('1F51C'),
  ('1F51D'), ('1F6D0'), ('269B-FE0F'), ('1F549-FE0F'), ('2721-FE0F'), ('2638-FE0F'), ('262F-FE0F'), ('271D-FE0F'), ('2626-FE0F'), ('262A-FE0F'), ('262E-FE0F'), ('1F54E'),
  ('1F52F'), ('1FAAF'), ('2648-FE0F'), ('2649-FE0F'), ('264A-FE0F'), ('264B-FE0F'), ('264C-FE0F'), ('264D-FE0F'), ('264E-FE0F'), ('264F-FE0F'), ('2650-FE0F'), ('2651-FE0F'),
  ('2652-FE0F'), ('2653-FE0F'), ('26CE-FE0F'), ('1F500'), ('1F501'), ('1F502'), ('25B6-FE0F'), ('23E9-FE0F'), ('23ED-FE0F'), ('23EF-FE0F'), ('25C0-FE0F'), ('23EA-FE0F'),
  ('23EE-FE0F'), ('1F53C'), ('23EB-FE0F'), ('1F53D'), ('23EC-FE0F'), ('23F8-FE0F'), ('23F9-FE0F'), ('23FA-FE0F'), ('23CF-FE0F'), ('1F3A6'), ('1F505'), ('1F506'),
  ('1F4F6'), ('1F6DC'), ('1F4F3'), ('1F4F4'), ('2640-FE0F'), ('2642-FE0F'), ('26A7-FE0F'), ('2716-FE0F'), ('2795-FE0F'), ('2796-FE0F'), ('2797-FE0F'), ('1F7F0'),
  ('267E-FE0F'), ('203C-FE0F'), ('2049-FE0F'), ('2753-FE0F'), ('2754-FE0F'), ('2755-FE0F'), ('2757-FE0F'), ('3030-FE0F'), ('1F4B1'), ('1F4B2'), ('2695-FE0F'), ('267B-FE0F'),
  ('269C-FE0F'), ('1F531'), ('1F4DB'), ('1F530'), ('2B55-FE0F'), ('2705-FE0F'), ('2611-FE0F'), ('2714-FE0F'), ('274C-FE0F'), ('274E-FE0F'), ('27B0-FE0F'), ('27BF-FE0F'),
  ('303D-FE0F'), ('2733-FE0F'), ('2734-FE0F'), ('2747-FE0F'), ('00A9-FE0F'), ('00AE-FE0F'), ('2122-FE0F'), ('0023-FE0F-20E3'), ('002A-FE0F-20E3'), ('0030-FE0F-20E3'), ('0031-FE0F-20E3'), ('0032-FE0F-20E3'),
  ('0033-FE0F-20E3'), ('0034-FE0F-20E3'), ('0035-FE0F-20E3'), ('0036-FE0F-20E3'), ('0037-FE0F-20E3'), ('0038-FE0F-20E3'), ('0039-FE0F-20E3'), ('1F51F'), ('1F520'), ('1F521'), ('1F522'), ('1F523'),
  ('1F524'), ('1F170-FE0F'), ('1F18E'), ('1F171-FE0F'), ('1F191'), ('1F192'), ('1F193'), ('2139-FE0F'), ('1F194'), ('24C2-FE0F'), ('1F195'), ('1F196'),
  ('1F17E-FE0F'), ('1F197'), ('1F17F-FE0F'), ('1F198'), ('1F199'), ('1F19A'), ('1F201'), ('1F202-FE0F'), ('1F237-FE0F'), ('1F236'), ('1F22F-FE0F'), ('1F250'),
  ('1F239'), ('1F21A-FE0F'), ('1F232'), ('1F251'), ('1F238'), ('1F234'), ('1F233'), ('3297-FE0F'), ('3299-FE0F'), ('1F23A'), ('1F235'), ('1F534'),
  ('1F7E0'), ('1F7E1'), ('1F7E2'), ('1F535'), ('1F7E3'), ('1F7E4'), ('26AB-FE0F'), ('26AA-FE0F'), ('1F7E5'), ('1F7E7'), ('1F7E8'), ('1F7E9'),
  ('1F7E6'), ('1F7EA'), ('1F7EB'), ('2B1B-FE0F'), ('2B1C-FE0F'), ('25FC-FE0F'), ('25FB-FE0F'), ('25FE-FE0F'), ('25FD-FE0F'), ('25AA-FE0F'), ('25AB-FE0F'), ('1F536'),
  ('1F537'), ('1F538'), ('1F539'), ('1F53A'), ('1F53B'), ('1F4A0'), ('1F518'), ('1F533'), ('1F532'), ('1F3C1'), ('1F6A9'), ('1F38C'),
  ('1F3F4'), ('1F3F3-FE0F'), ('1F3F3-FE0F-200D-1F308'), ('1F3F3-FE0F-200D-26A7-FE0F'), ('1F3F4-200D-2620-FE0F'), ('1F1E6-1F1E8'), ('1F1E6-1F1E9'), ('1F1E6-1F1EA'), ('1F1E6-1F1EB'), ('1F1E6-1F1EC'), ('1F1E6-1F1EE'), ('1F1E6-1F1F1'),
  ('1F1E6-1F1F2'), ('1F1E6-1F1F4'), ('1F1E6-1F1F6'), ('1F1E6-1F1F7'), ('1F1E6-1F1F8'), ('1F1E6-1F1F9'), ('1F1E6-1F1FA'), ('1F1E6-1F1FC'), ('1F1E6-1F1FD'), ('1F1E6-1F1FF'), ('1F1E7-1F1E6'), ('1F1E7-1F1E7'),
  ('1F1E7-1F1E9'), ('1F1E7-1F1EA'), ('1F1E7-1F1EB'), ('1F1E7-1F1EC'), ('1F1E7-1F1ED'), ('1F1E7-1F1EE'), ('1F1E7-1F1EF'), ('1F1E7-1F1F1'), ('1F1E7-1F1F2'), ('1F1E7-1F1F3'), ('1F1E7-1F1F4'), ('1F1E7-1F1F6'),
  ('1F1E7-1F1F7'), ('1F1E7-1F1F8'), ('1F1E7-1F1F9'), ('1F1E7-1F1FB'), ('1F1E7-1F1FC'), ('1F1E7-1F1FE'), ('1F1E7-1F1FF'), ('1F1E8-1F1E6'), ('1F1E8-1F1E8'), ('1F1E8-1F1E9'), ('1F1E8-1F1EB'), ('1F1E8-1F1EC'),
  ('1F1E8-1F1ED'), ('1F1E8-1F1EE'), ('1F1E8-1F1F0'), ('1F1E8-1F1F1'), ('1F1E8-1F1F2'), ('1F1E8-1F1F3'), ('1F1E8-1F1F4'), ('1F1E8-1F1F5'), ('1F1E8-1F1F7'), ('1F1E8-1F1FA'), ('1F1E8-1F1FB'), ('1F1E8-1F1FC'),
  ('1F1E8-1F1FD'), ('1F1E8-1F1FE'), ('1F1E8-1F1FF'), ('1F1E9-1F1EA'), ('1F1E9-1F1EC'), ('1F1E9-1F1EF'), ('1F1E9-1F1F0'), ('1F1E9-1F1F2'), ('1F1E9-1F1F4'), ('1F1E9-1F1FF'), ('1F1EA-1F1E6'), ('1F1EA-1F1E8'),
  ('1F1EA-1F1EA'), ('1F1EA-1F1EC'), ('1F1EA-1F1ED'), ('1F1EA-1F1F7'), ('1F1EA-1F1F8'), ('1F1EA-1F1F9'), ('1F1EA-1F1FA'), ('1F1EB-1F1EE'), ('1F1EB-1F1EF'), ('1F1EB-1F1F0'), ('1F1EB-1F1F2'), ('1F1EB-1F1F4'),
  ('1F1EB-1F1F7'), ('1F1EC-1F1E6'), ('1F1EC-1F1E7'), ('1F1EC-1F1E9'), ('1F1EC-1F1EA'), ('1F1EC-1F1EB'), ('1F1EC-1F1EC'), ('1F1EC-1F1ED'), ('1F1EC-1F1EE'), ('1F1EC-1F1F1'), ('1F1EC-1F1F2'), ('1F1EC-1F1F3'),
  ('1F1EC-1F1F5'), ('1F1EC-1F1F6'), ('1F1EC-1F1F7'), ('1F1EC-1F1F8'), ('1F1EC-1F1F9'), ('1F1EC-1F1FA'), ('1F1EC-1F1FC'), ('1F1EC-1F1FE'), ('1F1ED-1F1F0'), ('1F1ED-1F1F2'), ('1F1ED-1F1F3'), ('1F1ED-1F1F7'),
  ('1F1ED-1F1F9'), ('1F1ED-1F1FA'), ('1F1EE-1F1E8'), ('1F1EE-1F1E9'), ('1F1EE-1F1EA'), ('1F1EE-1F1F1'), ('1F1EE-1F1F2'), ('1F1EE-1F1F3'), ('1F1EE-1F1F4'), ('1F1EE-1F1F6'), ('1F1EE-1F1F7'), ('1F1EE-1F1F8'),
  ('1F1EE-1F1F9'), ('1F1EF-1F1EA'), ('1F1EF-1F1F2'), ('1F1EF-1F1F4'), ('1F1EF-1F1F5'), ('1F1F0-1F1EA'), ('1F1F0-1F1EC'), ('1F1F0-1F1ED'), ('1F1F0-1F1EE'), ('1F1F0-1F1F2'), ('1F1F0-1F1F3'), ('1F1F0-1F1F5'),
  ('1F1F0-1F1F7'), ('1F1F0-1F1FC'), ('1F1F0-1F1FE'), ('1F1F0-1F1FF'), ('1F1F1-1F1E6'), ('1F1F1-1F1E7'), ('1F1F1-1F1E8'), ('1F1F1-1F1EE'), ('1F1F1-1F1F0'), ('1F1F1-1F1F7'), ('1F1F1-1F1F8'), ('1F1F1-1F1F9'),
  ('1F1F1-1F1FA'), ('1F1F1-1F1FB'), ('1F1F1-1F1FE'), ('1F1F2-1F1E6'), ('1F1F2-1F1E8'), ('1F1F2-1F1E9'), ('1F1F2-1F1EA'), ('1F1F2-1F1EB'), ('1F1F2-1F1EC'), ('1F1F2-1F1ED'), ('1F1F2-1F1F0'), ('1F1F2-1F1F1'),
  ('1F1F2-1F1F2'), ('1F1F2-1F1F3'), ('1F1F2-1F1F4'), ('1F1F2-1F1F5'), ('1F1F2-1F1F6'), ('1F1F2-1F1F7'), ('1F1F2-1F1F8'), ('1F1F2-1F1F9'), ('1F1F2-1F1FA'), ('1F1F2-1F1FB'), ('1F1F2-1F1FC'), ('1F1F2-1F1FD'),
  ('1F1F2-1F1FE'), ('1F1F2-1F1FF'), ('1F1F3-1F1E6'), ('1F1F3-1F1E8'), ('1F1F3-1F1EA'), ('1F1F3-1F1EB'), ('1F1F3-1F1EC'), ('1F1F3-1F1EE'), ('1F1F3-1F1F1'), ('1F1F3-1F1F4'), ('1F1F3-1F1F5'), ('1F1F3-1F1F7'),
  ('1F1F3-1F1FA'), ('1F1F3-1F1FF'), ('1F1F4-1F1F2'), ('1F1F5-1F1E6'), ('1F1F5-1F1EA'), ('1F1F5-1F1EB'), ('1F1F5-1F1EC'), ('1F1F5-1F1ED'), ('1F1F5-1F1F0'), ('1F1F5-1F1F1'), ('1F1F5-1F1F2'), ('1F1F5-1F1F3'),
  ('1F1F5-1F1F7'), ('1F1F5-1F1F8'), ('1F1F5-1F1F9'), ('1F1F5-1F1FC'), ('1F1F5-1F1FE'), ('1F1F6-1F1E6'), ('1F1F7-1F1EA'), ('1F1F7-1F1F4'), ('1F1F7-1F1F8'), ('1F1F7-1F1FA'), ('1F1F7-1F1FC'), ('1F1F8-1F1E6'),
  ('1F1F8-1F1E7'), ('1F1F8-1F1E8'), ('1F1F8-1F1E9'), ('1F1F8-1F1EA'), ('1F1F8-1F1EC'), ('1F1F8-1F1ED'), ('1F1F8-1F1EE'), ('1F1F8-1F1EF'), ('1F1F8-1F1F0'), ('1F1F8-1F1F1'), ('1F1F8-1F1F2'), ('1F1F8-1F1F3'),
  ('1F1F8-1F1F4'), ('1F1F8-1F1F7'), ('1F1F8-1F1F8'), ('1F1F8-1F1F9'), ('1F1F8-1F1FB'), ('1F1F8-1F1FD'), ('1F1F8-1F1FE'), ('1F1F8-1F1FF'), ('1F1F9-1F1E6'), ('1F1F9-1F1E8'), ('1F1F9-1F1E9'), ('1F1F9-1F1EB'),
  ('1F1F9-1F1EC'), ('1F1F9-1F1ED'), ('1F1F9-1F1EF'), ('1F1F9-1F1F0'), ('1F1F9-1F1F1'), ('1F1F9-1F1F2'), ('1F1F9-1F1F3'), ('1F1F9-1F1F4'), ('1F1F9-1F1F7'), ('1F1F9-1F1F9'), ('1F1F9-1F1FB'), ('1F1F9-1F1FC'),
  ('1F1F9-1F1FF'), ('1F1FA-1F1E6'), ('1F1FA-1F1EC'), ('1F1FA-1F1F2'), ('1F1FA-1F1F3'), ('1F1FA-1F1F8'), ('1F1FA-1F1FE'), ('1F1FA-1F1FF'), ('1F1FB-1F1E6'), ('1F1FB-1F1E8'), ('1F1FB-1F1EA'), ('1F1FB-1F1EC'),
  ('1F1FB-1F1EE'), ('1F1FB-1F1F3'), ('1F1FB-1F1FA'), ('1F1FC-1F1EB'), ('1F1FC-1F1F8'), ('1F1FD-1F1F0'), ('1F1FE-1F1EA'), ('1F1FE-1F1F9'), ('1F1FF-1F1E6'), ('1F1FF-1F1F2'), ('1F1FF-1F1FC'), ('1F3F4-E0067-E0062-E0065-E006E-E0067-E007F'),
  ('1F3F4-E0067-E0062-E0073-E0063-E0074-E007F'), ('1F3F4-E0067-E0062-E0077-E006C-E0073-E007F');
-- END GENERATED EMOJI ALLOWLIST

ALTER TABLE public.custom_puzzles ADD COLUMN cover_emoji text;
ALTER TABLE public.custom_puzzles ADD COLUMN cover_background text;
ALTER TABLE public.custom_puzzles ADD CONSTRAINT custom_puzzles_cover_emoji_fkey FOREIGN KEY (cover_emoji) REFERENCES public.community_cover_emoji(key);
ALTER TABLE public.custom_puzzles ADD CONSTRAINT custom_puzzles_cover_background_check
  CHECK (((cover_background IS NULL) OR (cover_background = ANY (ARRAY['lilac'::text, 'butter'::text, 'mint'::text, 'sunflower'::text, 'tangerine'::text, 'coral'::text, 'bubblegum'::text, 'ocean'::text, 'forest'::text, 'charcoal'::text, 'lime-checks'::text, 'apricot-stripes'::text, 'lilac-dots'::text, 'indigo-stars'::text, 'teal-waves'::text, 'pink-waves'::text, 'sky-grid'::text, 'cream-confetti'::text, 'berry-stripes'::text, 'cherry-polka'::text, 'sunset-split'::text, 'peach-rings'::text, 'mint-checks'::text, 'rainbow-bands'::text]))));
-- Exactly one emoji with exactly one background, or no cover at all.
ALTER TABLE public.custom_puzzles ADD CONSTRAINT custom_puzzles_cover_pair
  CHECK ((((cover_emoji IS NULL) AND (cover_background IS NULL)) OR ((cover_emoji IS NOT NULL) AND (cover_background IS NOT NULL))));

-- set_custom_puzzle_cover(text, text, text)
-- The puzzle's own signed-in creator sets (or, with two nulls, removes) its
-- cover: one allowlisted emoji key and one preset background key.
CREATE FUNCTION public.set_custom_puzzle_cover(_share_id text, _emoji text, _background text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid uuid := public.rainbow_uid();
  _p   public.custom_puzzles%rowtype;
begin
  if _uid is null then
    raise exception 'sign in to add a cover' using errcode = 'insufficient_privilege';
  end if;
  if (_emoji is null) <> (_background is null) then
    raise exception 'a cover is one emoji and one background' using errcode = 'invalid_parameter_value';
  end if;
  if _emoji is not null and not exists (select 1 from public.community_cover_emoji where key = _emoji) then
    raise exception 'that emoji is not available for covers' using errcode = 'invalid_parameter_value';
  end if;
  if _background is not null and _background <> all (array['lilac'::text, 'butter'::text, 'mint'::text, 'sunflower'::text, 'tangerine'::text, 'coral'::text, 'bubblegum'::text, 'ocean'::text, 'forest'::text, 'charcoal'::text, 'lime-checks'::text, 'apricot-stripes'::text, 'lilac-dots'::text, 'indigo-stars'::text, 'teal-waves'::text, 'pink-waves'::text, 'sky-grid'::text, 'cream-confetti'::text, 'berry-stripes'::text, 'cherry-polka'::text, 'sunset-split'::text, 'peach-rings'::text, 'mint-checks'::text, 'rainbow-bands'::text]) then
    raise exception 'that background is not available for covers' using errcode = 'invalid_parameter_value';
  end if;

  select * into _p from public.custom_puzzles where share_id = _share_id for update;
  if _p.id is null then
    raise exception 'puzzle not found' using errcode = 'no_data_found';
  end if;
  if _p.created_by is distinct from _uid then
    raise exception 'only the puzzle''s creator can change its cover' using errcode = 'insufficient_privilege';
  end if;

  update public.custom_puzzles set cover_emoji = _emoji, cover_background = _background
   where id = _p.id and created_by = _uid;
  return jsonb_build_object('cover_emoji', _emoji, 'cover_background', _background);
end;
$$;

-- The card and puzzle payloads gain the two cover keys (null = no cover).
-- Bodies are otherwise exactly as in 0001 / 0004 / 0005.

CREATE OR REPLACE FUNCTION public.custom_puzzle_card_json(_p public.custom_puzzles) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'title',          _p.title,
    'creator_name',   _p.creator_name,
    'creator_slug',   (select prof.public_slug from public.creator_profiles prof where prof.user_id = _p.created_by),
    'mode',           _p.content ->> 'mode',
    'short_code',     _p.short_code,
    'finished_plays', coalesce((select s.wins + s.losses from public.custom_puzzle_stats s where s.custom_puzzle_id = _p.id), 0),
    'favorite_count', (select count(*) from public.custom_puzzle_favorites f where f.custom_puzzle_id = _p.id),
    'listed_at',      _p.community_listed_at,
    'cover_emoji',    _p.cover_emoji,
    'cover_background', _p.cover_background
  )
$$;

CREATE OR REPLACE FUNCTION public.list_community_puzzles(_query text DEFAULT NULL::text, _sort text DEFAULT 'newest'::text, _limit integer DEFAULT 24, _offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _s     text    := case when _sort = 'plays' then 'plays' else 'newest' end;
  _lim   integer := least(greatest(coalesce(_limit, 24), 1), 48);
  _off   integer := least(greatest(coalesce(_offset, 0), 0), 2000);
  _q     text    := nullif(btrim(left(coalesce(_query, ''), 60)), '');
  _like  text;
  _rows  jsonb;
begin
  if _q is not null then
    -- Literal substring search: the user's % _ and \ are not wildcards.
    _like := '%' || replace(replace(replace(_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with eligible as (
    select cp.title,
           cp.creator_name,
           prof.public_slug as creator_slug,
           cp.content ->> 'mode' as mode,
           cp.short_code,
           coalesce((select s.wins + s.losses from public.custom_puzzle_stats s where s.custom_puzzle_id = cp.id), 0) as plays,
           (select count(*) from public.custom_puzzle_favorites f where f.custom_puzzle_id = cp.id) as favs,
           cp.community_listed_at as listed_at,
           cp.cover_emoji,
           cp.cover_background
      from public.custom_puzzles cp
      left join public.creator_profiles prof on prof.user_id = cp.created_by
     where cp.community_listed
       and cp.visibility = 'public'
       and cp.moderation_status = 'active'
       and cp.created_by is not null
       and (_like is null
            or cp.title ilike _like
            or cp.creator_name ilike _like
            or prof.display_name ilike _like)
  ), page as (
    select e.*,
           row_number() over (order by (case when _s = 'plays' then e.plays end) desc nulls last,
                                       e.listed_at desc nulls last,
                                       e.short_code) as rn
      from eligible e
     order by rn
     limit _lim + 1 offset _off
  )
  select jsonb_build_object(
           'items', coalesce(jsonb_agg(jsonb_build_object(
                      'title',          p.title,
                      'creator_name',   p.creator_name,
                      'creator_slug',   p.creator_slug,
                      'mode',           p.mode,
                      'short_code',     p.short_code,
                      'finished_plays', p.plays,
                      'favorite_count', p.favs,
                      'listed_at',      p.listed_at,
                      'cover_emoji',    p.cover_emoji,
                      'cover_background', p.cover_background
                    ) order by p.rn) filter (where p.rn <= _off + _lim), '[]'::jsonb),
           'has_more', count(*) > _lim,
           'limit',    _lim,
           'offset',   _off)
    into _rows
    from page p;

  return _rows;
end;
$$;

CREATE OR REPLACE FUNCTION public.custom_puzzle_public_json(_p public.custom_puzzles) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'id',              _p.id,
    'share_id',        _p.share_id,
    'short_code',      _p.short_code,
    'title',           _p.title,
    'creator_name',    _p.creator_name,
    'visibility',      _p.visibility,
    'content',         _p.content,
    'cover_emoji',     _p.cover_emoji,
    'cover_background', _p.cover_background,
    -- Only a signed-in creator has a profile; anonymous puzzles stay unlinked.
    'creator_slug',    (select cp.public_slug from public.creator_profiles cp where cp.user_id = _p.created_by),
    'favorite_count',  (select count(*) from public.custom_puzzle_favorites f where f.custom_puzzle_id = _p.id),
    'favorited_by_me', exists (
      select 1 from public.custom_puzzle_favorites f
       where f.custom_puzzle_id = _p.id and f.user_id = public.rainbow_uid()
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.get_my_favorites() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(jsonb_agg(q.item order by q.favorited_at desc), '[]'::jsonb)
    from (
      select f.created_at as favorited_at,
             jsonb_build_object(
               'title',          cp.title,
               'creator_name',   cp.creator_name,
               'creator_slug',   (select p.public_slug from public.creator_profiles p where p.user_id = cp.created_by),
               'mode',           cp.content ->> 'mode',
               'short_code',     cp.short_code,
               'favorite_count', (select count(*) from public.custom_puzzle_favorites x where x.custom_puzzle_id = cp.id),
               'favorited_at',   f.created_at,
               'cover_emoji',    cp.cover_emoji,
               'cover_background', cp.cover_background
             ) as item
        from public.custom_puzzle_favorites f
        join public.custom_puzzles cp on cp.id = f.custom_puzzle_id
       where f.user_id = public.rainbow_uid()
         and cp.moderation_status = 'active'
       order by f.created_at desc
       limit 200
    ) q
$$;

REVOKE ALL ON FUNCTION public.set_custom_puzzle_cover(_share_id text, _emoji text, _background text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_custom_puzzle_cover(_share_id text, _emoji text, _background text) TO authenticated, service_role;

COMMENT ON TABLE public.community_cover_emoji IS 'Allowlist of cover emoji keys (fully-qualified code-point sequences), generated from the pinned emojibase-data release.';
COMMENT ON FUNCTION public.set_custom_puzzle_cover(_share_id text, _emoji text, _background text) IS 'The puzzle''s own creator sets or removes its cover: one allowlisted emoji key and one preset background key.';

COMMIT;
