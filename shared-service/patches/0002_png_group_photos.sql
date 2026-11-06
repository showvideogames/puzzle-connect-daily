-- LOCAL PROPOSED PATCH. Not in Rainbow migrations. Do not apply to a hosted database without release approval.
-- Additive PNG support for social hub eb238dd. Existing bytea values, photo versions,
-- function signatures, ownership checks and JPEG validation remain unchanged.
begin;

-- Structural PNG container check, not an image decoder. Canvas emits 8-bit RGB/RGBA,
-- non-interlaced PNG. Reject animation, truncated chunks, missing image data/end,
-- and unknown critical chunks. Keep the same bounded 60KB/256px upload contract.
create or replace function social.png_size(p_png bytea, out width int, out height int)
language plpgsql immutable set search_path = social, pg_temp as $$
declare
  n int := coalesce(octet_length(p_png), 0);
  pos int := 8;
  len bigint;
  tag text;
  w bigint;
  h bigint;
  saw_data boolean := false;
begin
  if n < 57 or substring(p_png from 1 for 8) <> decode('89504e470d0a1a0a', 'hex') then return; end if;
  while pos + 12 <= n loop
    len := get_byte(p_png,pos)::bigint * 16777216 + get_byte(p_png,pos+1) * 65536 + get_byte(p_png,pos+2) * 256 + get_byte(p_png,pos+3);
    if len > n - pos - 12 then return; end if;
    tag := encode(substring(p_png from pos+5 for 4), 'hex');
    if pos = 8 then
      if tag <> '49484452' or len <> 13 then return; end if;
      w := get_byte(p_png,16)::bigint * 16777216 + get_byte(p_png,17) * 65536 + get_byte(p_png,18) * 256 + get_byte(p_png,19);
      h := get_byte(p_png,20)::bigint * 16777216 + get_byte(p_png,21) * 65536 + get_byte(p_png,22) * 256 + get_byte(p_png,23);
      if w < 1 or h < 1 or w > 2147483647 or h > 2147483647 or get_byte(p_png,24) <> 8
        or get_byte(p_png,25) not in (2,6) or get_byte(p_png,26) <> 0 or get_byte(p_png,27) <> 0 or get_byte(p_png,28) <> 0 then return; end if;
    elsif tag = '49444154' then
      if len > 0 then saw_data := true; end if;
    elsif tag = '49454e44' then
      if len = 0 and pos + 12 = n and saw_data then width := w; height := h; end if;
      return;
    elsif tag in ('49484452','6163544c','6663544c','66644154') then return;
    elsif tag <> '504c5445' and (get_byte(p_png,pos+4) & 32) = 0 then return;
    end if;
    pos := pos + len::int + 12;
  end loop;
end;
$$;
revoke all on function social.png_size(bytea) from public, anon, authenticated, service_role;

create or replace function social.photo_url(p_photo bytea)
returns text language sql immutable set search_path = social, pg_temp as $$
  select case when p_photo is not null then
    case when substring(p_photo from 1 for 8) = decode('89504e470d0a1a0a', 'hex') then 'data:image/png;base64,' else 'data:image/jpeg;base64,' end
    || replace(encode(p_photo, 'base64'), E'\n', '') end
$$;

-- Keep the legacy OUT name `jpeg`: callers already read c.jpeg. It now holds either format.
create or replace function social.check_photo(p_photo text, out refusal text, out jpeg bytea)
language plpgsql immutable set search_path = social, pg_temp as $$
declare
  v_prefix text;
  v_encoded text;
  v_width int;
  v_height int;
begin
  if p_photo like 'data:image/png;base64,%' then v_prefix := 'data:image/png;base64,';
  elsif p_photo like 'data:image/jpeg;base64,%' then v_prefix := 'data:image/jpeg;base64,';
  else refusal := 'not_a_picture'; return; end if;
  v_encoded := substr(p_photo, char_length(v_prefix)+1);
  if char_length(v_encoded) > 81920 then refusal := 'too_big'; return; end if;
  if char_length(v_encoded) % 4 <> 0 or v_encoded !~ '^[A-Za-z0-9+/]+={0,2}$' then refusal := 'not_a_picture'; return; end if;
  jpeg := decode(v_encoded,'base64');
  if replace(encode(jpeg,'base64'), E'\n', '') <> v_encoded then refusal := 'not_a_picture'; return; end if;
  if octet_length(jpeg) > 61440 then refusal := 'too_big'; return; end if;
  if v_prefix = 'data:image/png;base64,' then
    select s.width,s.height into v_width,v_height from social.png_size(jpeg) s;
  else
    select s.width,s.height into v_width,v_height from social.jpeg_size(jpeg) s;
  end if;
  if v_width is null then refusal := 'not_a_picture';
  elsif v_width <> 256 or v_height <> 256 then refusal := 'wrong_size'; end if;
end;
$$;
commit;
