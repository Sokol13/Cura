-- cura_sync must never be included in PostgREST's exposed schemas. Only the
-- bounded public SECURITY INVOKER functions are application endpoints.
create schema if not exists cura_sync;
revoke all on schema cura_sync from public, anon;
grant usage on schema cura_sync to authenticated;

create table cura_sync.libraries (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  name text not null check (length(name) between 1 and 255),
  published boolean not null default false,
  head bigint not null default 0 check (head >= 0),
  create_operation_id uuid not null,
  create_request_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table cura_sync.members (
  library_id uuid not null references cura_sync.libraries(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('editor', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (library_id, user_id)
);
create index members_user_id_idx on cura_sync.members(user_id);
create table cura_sync.records (
  library_id uuid not null references cura_sync.libraries(id),
  kind text not null,
  key uuid not null,
  revision bigint not null check (revision > 0),
  payload jsonb,
  tombstone boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (library_id, kind, key),
  check ((tombstone and payload is null) or (not tombstone and jsonb_typeof(payload) = 'object'))
);
create table cura_sync.commits (
  id uuid not null unique,
  library_id uuid not null references cura_sync.libraries(id),
  sequence bigint not null check (sequence > 0),
  operation_id uuid not null,
  actor_id uuid not null references auth.users(id),
  request_hash text not null,
  changes jsonb not null check (jsonb_typeof(changes) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (library_id, sequence),
  unique (library_id, operation_id)
);
create index libraries_owner_id_idx on cura_sync.libraries(owner_id);
create index commits_actor_id_idx on cura_sync.commits(actor_id);

-- This is the only privileged helper. Its subject is always auth.uid(), never
-- a caller-supplied user. It breaks the membership-table RLS recursion.
create or replace function cura_sync.my_role(p_library_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when l.owner_id = (select auth.uid()) then 'owner'
    when l.published then (select m.role from cura_sync.members m
      where m.library_id = l.id and m.user_id = (select auth.uid()))
    else null end
  from cura_sync.libraries l
  where l.id = p_library_id and (select auth.uid()) is not null
$$;
revoke all on function cura_sync.my_role(uuid) from public, anon;
grant execute on function cura_sync.my_role(uuid) to authenticated;

alter table cura_sync.libraries enable row level security;
alter table cura_sync.members enable row level security;
alter table cura_sync.records enable row level security;
alter table cura_sync.commits enable row level security;
revoke all on all tables in schema cura_sync from public, anon, authenticated;
grant select, insert, update on cura_sync.libraries to authenticated;
grant select, insert, update, delete on cura_sync.members to authenticated;
grant select, insert, update on cura_sync.records to authenticated;
grant select, insert on cura_sync.commits to authenticated;
create policy libraries_read on cura_sync.libraries for select to authenticated
  using (owner_id = (select auth.uid()) or cura_sync.my_role(id) is not null);
create policy libraries_create on cura_sync.libraries for insert to authenticated
  with check (owner_id = (select auth.uid()) and not published and head = 0);
create policy libraries_update on cura_sync.libraries for update to authenticated
  using (cura_sync.my_role(id) in ('owner', 'editor'))
  with check (cura_sync.my_role(id) in ('owner', 'editor'));
create policy members_read on cura_sync.members for select to authenticated
  using (cura_sync.my_role(library_id) is not null);
create policy members_insert on cura_sync.members for insert to authenticated
  with check (cura_sync.my_role(library_id) = 'owner' and user_id <> (select auth.uid()));
create policy members_update on cura_sync.members for update to authenticated
  using (cura_sync.my_role(library_id) = 'owner')
  with check (cura_sync.my_role(library_id) = 'owner' and user_id <> (select auth.uid()));
create policy members_delete on cura_sync.members for delete to authenticated
  using (cura_sync.my_role(library_id) = 'owner');
create policy records_read on cura_sync.records for select to authenticated
  using (cura_sync.my_role(library_id) is not null);
create policy records_insert on cura_sync.records for insert to authenticated
  with check (cura_sync.my_role(library_id) in ('owner', 'editor'));
create policy records_update on cura_sync.records for update to authenticated
  using (cura_sync.my_role(library_id) in ('owner', 'editor'))
  with check (cura_sync.my_role(library_id) in ('owner', 'editor'));
create policy commits_read on cura_sync.commits for select to authenticated
  using (cura_sync.my_role(library_id) is not null);
create policy commits_insert on cura_sync.commits for insert to authenticated
  with check (cura_sync.my_role(library_id) in ('owner', 'editor') and actor_id = (select auth.uid()));

create or replace function cura_sync.keep_owner()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.id <> old.id or new.owner_id <> old.owner_id
    or new.create_operation_id <> old.create_operation_id
    or new.create_request_hash <> old.create_request_hash then
    raise exception using errcode = '42501', message = 'CURA_SYNC_IMMUTABLE_OWNER';
  end if;
  return new;
end $$;
revoke all on function cura_sync.keep_owner() from public, anon, authenticated;
create trigger libraries_keep_owner before update on cura_sync.libraries
  for each row execute function cura_sync.keep_owner();

create or replace function cura_sync.timestamp_json(p_timestamp timestamptz)
returns text language sql immutable strict security invoker set search_path = '' as $$
  select to_char(p_timestamp at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
revoke all on function cura_sync.timestamp_json(timestamptz) from public, anon;
grant execute on function cura_sync.timestamp_json(timestamptz) to authenticated;

create or replace function cura_sync.library_json(p_library cura_sync.libraries)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', p_library.id, 'name', p_library.name,
    'ownerId', p_library.owner_id, 'role', cura_sync.my_role(p_library.id),
    'published', p_library.published, 'head', p_library.head::text,
    'createdAt', cura_sync.timestamp_json(p_library.created_at), 'updatedAt', cura_sync.timestamp_json(p_library.updated_at))
$$;
create or replace function cura_sync.record_json(p_record cura_sync.records)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('kind', p_record.kind, 'key', p_record.key,
    'revision', p_record.revision::text, 'payload', p_record.payload,
    'tombstone', p_record.tombstone,
    'createdAt', cura_sync.timestamp_json(p_record.created_at), 'updatedAt', cura_sync.timestamp_json(p_record.updated_at))
$$;
revoke all on function cura_sync.library_json(cura_sync.libraries),
  cura_sync.record_json(cura_sync.records) from public, anon;
grant execute on function cura_sync.library_json(cura_sync.libraries),
  cura_sync.record_json(cura_sync.records) to authenticated;

create or replace function public.cura_sync_create_library(
  p_library_id uuid, p_name text, p_operation_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_library cura_sync.libraries;
  v_hash text;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'CURA_SYNC_UNAUTHORIZED';
  end if;
  if p_library_id is null or p_operation_id is null or p_name is null
    or length(p_name) not between 1 and 255 then
    raise exception using errcode = '22023', message = 'CURA_SYNC_INVALID_LIBRARY';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object('id', p_library_id,
    'name', p_name, 'actor', (select auth.uid()))::text, 'UTF8')), 'hex');
  -- ON CONFLICT can observe a hidden row but never discloses its contents.
  insert into cura_sync.libraries(id, owner_id, name, create_operation_id, create_request_hash)
    values(p_library_id, (select auth.uid()), p_name, p_operation_id, v_hash)
    on conflict (id) do nothing;
  select * into v_library from cura_sync.libraries where id = p_library_id;
  if not found or v_library.owner_id <> (select auth.uid()) then
    raise exception using errcode = '42501', message = 'CURA_SYNC_FORBIDDEN';
  end if;
  if v_library.create_operation_id <> p_operation_id or v_library.create_request_hash <> v_hash then
    raise exception using errcode = '22023', message = 'CURA_SYNC_OPERATION_MISMATCH';
  end if;
  return jsonb_build_object('library', cura_sync.library_json(v_library));
end $$;

create or replace function public.cura_sync_libraries()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('libraries', coalesce(jsonb_agg(cura_sync.library_json(l)
    order by l.created_at, l.id), '[]'::jsonb)) from cura_sync.libraries l
$$;

create or replace function public.cura_sync_members(p_library_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_members jsonb;
begin
  if cura_sync.my_role(p_library_id) is null then
    raise exception using errcode = '42501', message = 'CURA_SYNC_FORBIDDEN';
  end if;
  select jsonb_agg(m.value order by m.user_id) into v_members from (
    select l.owner_id as user_id, jsonb_build_object('userId', l.owner_id,
      'role', 'owner', 'createdAt', cura_sync.timestamp_json(l.created_at), 'updatedAt', cura_sync.timestamp_json(l.updated_at)) as value
      from cura_sync.libraries l where l.id = p_library_id
    union all
    select m.user_id, jsonb_build_object('userId', m.user_id, 'role', m.role,
      'createdAt', cura_sync.timestamp_json(m.created_at), 'updatedAt', cura_sync.timestamp_json(m.updated_at))
      from cura_sync.members m where m.library_id = p_library_id
  ) m;
  return jsonb_build_object('members', v_members);
end $$;

create or replace function public.cura_sync_set_member(
  p_library_id uuid, p_user_id uuid, p_role text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_library cura_sync.libraries;
begin
  -- Membership changes share the commit lock: revocation and publication have
  -- an unambiguous order even when an editor's request is already in flight.
  select * into v_library from cura_sync.libraries where id = p_library_id for update;
  if not found or v_library.owner_id <> (select auth.uid()) then
    raise exception using errcode = '42501', message = 'CURA_SYNC_FORBIDDEN';
  end if;
  if p_user_id is null or p_user_id = v_library.owner_id
    or (p_role is not null and p_role not in ('editor', 'viewer')) then
    raise exception using errcode = '22023', message = 'CURA_SYNC_INVALID_MEMBER';
  end if;
  if p_role is null then
    delete from cura_sync.members where library_id = p_library_id and user_id = p_user_id;
  else
    insert into cura_sync.members(library_id, user_id, role)
      values(p_library_id, p_user_id, p_role)
      on conflict(library_id, user_id) do update set role = excluded.role, updated_at = now();
  end if;
  return public.cura_sync_members(p_library_id);
end $$;

create or replace function public.cura_sync_commit(
  p_library_id uuid, p_operation_id uuid, p_changes jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_library cura_sync.libraries;
  v_prior cura_sync.commits;
  v_hash text;
  v_change jsonb;
  v_payload jsonb;
  v_kind text;
  v_key uuid;
  v_expected bigint;
  v_record cura_sync.records;
  v_revision bigint;
  v_conflicts jsonb := '[]'::jsonb;
  v_result jsonb := '[]'::jsonb;
  v_now timestamptz := now();
begin
  if p_library_id is null or p_operation_id is null or p_changes is null
    or jsonb_typeof(p_changes) <> 'array' then
    raise exception using errcode = '22023', message = 'CURA_SYNC_INVALID_COMMIT';
  end if;
  if jsonb_array_length(p_changes) not between 1 and 10000
    or octet_length(p_changes::text) > 16777216 then
    raise exception using errcode = '54000', message = 'CURA_SYNC_LIMIT';
  end if;
  -- Lock BEFORE sequence allocation. Transactional head increments, unlike
  -- bigserial, cannot leave an uncommitted lower sequence behind a pull cursor.
  select * into v_library from cura_sync.libraries where id = p_library_id for update;
  if not found or coalesce(cura_sync.my_role(p_library_id), '') not in ('owner', 'editor') then
    raise exception using errcode = '42501', message = 'CURA_SYNC_FORBIDDEN';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object('actor', (select auth.uid()),
    'library', p_library_id, 'changes', p_changes)::text, 'UTF8')), 'hex');
  select * into v_prior from cura_sync.commits
    where library_id = p_library_id and operation_id = p_operation_id;
  if found then
    if v_prior.request_hash <> v_hash then
      raise exception using errcode = '22023', message = 'CURA_SYNC_OPERATION_MISMATCH';
    end if;
    return jsonb_build_object('sequence', v_prior.sequence::text,
      'operationId', v_prior.operation_id, 'changes', v_prior.changes);
  end if;
  if exists(select 1 from jsonb_array_elements(p_changes) c
    group by c->>'kind', c->>'key' having count(*) > 1) then
    raise exception using errcode = '22023', message = 'CURA_SYNC_DUPLICATE_KEY';
  end if;
  for v_change in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(v_change) <> 'object'
      or not (v_change ?& array['kind', 'key', 'expectedRevision', 'payload', 'tombstone'])
      or (v_change - array['kind', 'key', 'expectedRevision', 'payload', 'tombstone']) <> '{}'::jsonb
      or jsonb_typeof(v_change->'kind') <> 'string'
      or jsonb_typeof(v_change->'key') <> 'string'
      or jsonb_typeof(v_change->'expectedRevision') <> 'string'
      or jsonb_typeof(v_change->'tombstone') <> 'boolean'
      or (v_change->>'expectedRevision') !~ '^(0|[1-9][0-9]{0,18})$'
      or (v_change->>'key') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (v_change->>'kind') not in ('library', 'asset', 'folder', 'tagGroup', 'tag',
        'collection', 'template', 'board', 'brand', 'cmf', 'generation', 'generationJob',
        'activity', 'automationJob', 'automationProposal', 'automationChange', 'archiveRule',
        'scriptBreakdown', 'settingDocument') then
      raise exception using errcode = '22023', message = 'CURA_SYNC_INVALID_ENVELOPE';
    end if;
    v_kind := v_change->>'kind';
    v_key := (v_change->>'key')::uuid;
    v_expected := (v_change->>'expectedRevision')::bigint;
    v_payload := v_change->'payload';
    if (v_change->>'tombstone')::boolean then
      if v_payload <> 'null'::jsonb or v_kind = 'library' then
        raise exception using errcode = '22023', message = 'CURA_SYNC_INVALID_TOMBSTONE';
      end if;
    elsif jsonb_typeof(v_payload) <> 'object'
      or not (v_payload ?& array['kind', 'id', 'libraryId', 'data'])
      or (v_payload - array['kind', 'id', 'libraryId', 'data']) <> '{}'::jsonb
      or v_payload->>'kind' is distinct from v_kind
      or v_payload->>'id' is distinct from v_key::text
      or v_payload->>'libraryId' is distinct from p_library_id::text
      or jsonb_typeof(v_payload->'data') <> 'object'
      or (v_payload->'data' ? 'libraryId' and v_payload->'data'->>'libraryId' is distinct from p_library_id::text)
      or (v_kind = 'library' and (v_key <> p_library_id
        or jsonb_typeof(v_payload->'data'->'name') <> 'string'
        or length(v_payload->'data'->>'name') not between 1 and 255)) then
      raise exception using errcode = '22023', message = 'CURA_SYNC_INVALID_PAYLOAD';
    end if;
    -- Check structural records only. Arbitrary user metadata may itself have
    -- a libraryId property and must survive exactly as authored.
    if not (v_change->>'tombstone')::boolean and exists(
      select 1 from jsonb_each(v_payload->'data') child
      cross join lateral jsonb_path_query(child.value, '$[*]') structural
      where ((v_kind = 'asset' and child.key in ('asset', 'manualSelection'))
        or (v_kind = 'board' and child.key in ('board', 'items', 'edges', 'slots', 'revisions', 'finalSelections')))
      and structural ? 'libraryId'
      and structural->>'libraryId' is distinct from p_library_id::text
    ) then
      raise exception using errcode = '22023', message = 'CURA_SYNC_CROSS_LIBRARY';
    end if;
    select * into v_record from cura_sync.records
      where library_id = p_library_id and kind = v_kind and key = v_key;
    v_revision := case when found then v_record.revision else 0 end;
    if v_revision <> v_expected then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'kind', v_kind, 'key', v_key, 'expectedRevision', v_expected::text,
        'actualRevision', v_revision::text, 'record',
        case when v_revision = 0 then null else cura_sync.record_json(v_record) end));
    end if;
  end loop;
  if jsonb_array_length(v_conflicts) > 0 then
    raise exception using errcode = 'P0001', message = 'CURA_SYNC_CONFLICT', detail = v_conflicts::text;
  end if;
  if not v_library.published and not exists(select 1 from jsonb_array_elements(p_changes) c
    where c->>'kind' = 'library' and c->>'key' = p_library_id::text and c->>'tombstone' = 'false') then
    raise exception using errcode = '22023', message = 'CURA_SYNC_BOOTSTRAP_REQUIRED';
  end if;
  for v_change in select value from jsonb_array_elements(p_changes) loop
    insert into cura_sync.records(library_id, kind, key, revision, payload, tombstone, created_at, updated_at)
      values(p_library_id, v_change->>'kind', (v_change->>'key')::uuid,
        (v_change->>'expectedRevision')::bigint + 1,
        nullif(v_change->'payload', 'null'::jsonb), (v_change->>'tombstone')::boolean, v_now, v_now)
      on conflict(library_id, kind, key) do update set revision = excluded.revision,
        payload = excluded.payload, tombstone = excluded.tombstone, updated_at = excluded.updated_at
      returning * into v_record;
    if v_record.kind = 'library' then v_library.name := v_record.payload->'data'->>'name'; end if;
  end loop;
  select jsonb_agg(cura_sync.record_json(r) order by c.ordinality) into v_result
    from jsonb_array_elements(p_changes) with ordinality c(value, ordinality)
    join cura_sync.records r on r.library_id = p_library_id
      and r.kind = c.value->>'kind' and r.key = (c.value->>'key')::uuid;
  if octet_length(v_result::text) > 33554432 then
    raise exception using errcode = '54000', message = 'CURA_SYNC_LIMIT';
  end if;
  update cura_sync.libraries set head = head + 1, published = true,
    name = v_library.name, updated_at = v_now where id = p_library_id returning * into v_library;
  insert into cura_sync.commits(id, library_id, sequence, operation_id, actor_id, request_hash, changes)
    values(gen_random_uuid(), p_library_id, v_library.head, p_operation_id, (select auth.uid()), v_hash, v_result);
  return jsonb_build_object('sequence', v_library.head::text, 'operationId', p_operation_id, 'changes', v_result);
end $$;

create or replace function public.cura_sync_pull(
  p_library_id uuid, p_after text, p_limit integer default 20)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_library cura_sync.libraries;
  v_commits jsonb;
  v_cursor bigint;
  v_after bigint;
begin
  if p_after is null or p_after !~ '^(0|[1-9][0-9]{0,18})$'
    or p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'CURA_SYNC_INVALID_CURSOR';
  end if;
  v_after := p_after::bigint;
  select * into v_library from cura_sync.libraries where id = p_library_id;
  if not found then raise exception using errcode = '42501', message = 'CURA_SYNC_FORBIDDEN'; end if;
  if v_after > v_library.head then
    raise exception using errcode = '22023', message = 'CURA_SYNC_INVALID_CURSOR';
  end if;
  -- LIMIT applies to complete commits, never individual records. The read-only
  -- STABLE function uses a single snapshot for the head and all returned data.
  select coalesce(jsonb_agg(jsonb_build_object('sequence', c.sequence::text,
      'operationId', c.operation_id, 'changes', c.changes) order by c.sequence), '[]'::jsonb),
    coalesce(max(c.sequence), v_after) into v_commits, v_cursor
    from (
      select bounded.* from (
        select limited.*, sum(octet_length(changes::text)) over (order by sequence) as response_bytes
        from (select * from cura_sync.commits where library_id = p_library_id
          and sequence > v_after order by sequence limit p_limit) limited
      ) bounded where response_bytes <= 33554432
    ) c;
  return jsonb_build_object('head', v_library.head::text, 'cursor', v_cursor::text,
    'hasMore', v_cursor < v_library.head, 'commits', v_commits);
end $$;

create or replace function public.cura_sync_manifest(p_library_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_library cura_sync.libraries; v_records jsonb;
begin
  select * into v_library from cura_sync.libraries where id = p_library_id;
  if not found then raise exception using errcode = '42501', message = 'CURA_SYNC_FORBIDDEN'; end if;
  if (select count(*) from cura_sync.records where library_id = p_library_id) > 10000
    or (select coalesce(sum(pg_column_size(payload)), 0) from cura_sync.records
      where library_id = p_library_id) > 16777216 then
    raise exception using errcode = '54000', message = 'CURA_SYNC_LIMIT';
  end if;
  select coalesce(jsonb_agg(cura_sync.record_json(r) order by r.kind, r.key), '[]'::jsonb)
    into v_records from cura_sync.records r where r.library_id = p_library_id;
  if octet_length(v_records::text) > 16777216 then
    raise exception using errcode = '54000', message = 'CURA_SYNC_LIMIT';
  end if;
  return jsonb_build_object('library', cura_sync.library_json(v_library),
    'sequence', v_library.head::text, 'records', v_records);
end $$;

revoke all on function public.cura_sync_create_library(uuid, text, uuid),
  public.cura_sync_libraries(), public.cura_sync_members(uuid),
  public.cura_sync_set_member(uuid, uuid, text), public.cura_sync_commit(uuid, uuid, jsonb),
  public.cura_sync_pull(uuid, text, integer), public.cura_sync_manifest(uuid) from public, anon;
grant execute on function public.cura_sync_create_library(uuid, text, uuid),
  public.cura_sync_libraries(), public.cura_sync_members(uuid),
  public.cura_sync_set_member(uuid, uuid, text), public.cura_sync_commit(uuid, uuid, jsonb),
  public.cura_sync_pull(uuid, text, integer), public.cura_sync_manifest(uuid) to authenticated;

insert into storage.buckets(id, name, public)
  values('cura-sync-objects', 'cura-sync-objects', false)
  on conflict (id) do update set public = false;
-- Only two canonical path segments; names contain neither extensions nor a
-- user-controlled directory tree. Bytes are verified against SHA-256 locally.
create policy cura_sync_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'cura-sync-objects'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}$'
    and cura_sync.my_role(case when name ~ '^[0-9a-f-]{36}/' then split_part(name, '/', 1)::uuid else null end) is not null);
create policy cura_sync_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'cura-sync-objects'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}$'
    and cura_sync.my_role(case when name ~ '^[0-9a-f-]{36}/' then split_part(name, '/', 1)::uuid else null end) in ('owner', 'editor'));
-- Deliberately no UPDATE or DELETE policy: retained objects are immutable.
notify pgrst, 'reload schema';
