create table if not exists public.goodhands_app_state (
  id boolean primary key default true check (id),
  owner_email text not null,
  data jsonb not null default '{
    "bookings": [],
    "completed": [],
    "ownerPhone": "",
    "hours": {
      "open": "09:00",
      "close": "18:00",
      "lunchStart": "13:00",
      "lunchEnd": "14:00"
    }
  }'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.goodhands_app_state enable row level security;
revoke all on public.goodhands_app_state from anon, authenticated;

insert into public.goodhands_app_state (id, owner_email)
values (true, 'REPLACE_WITH_OWNER_EMAIL')
on conflict (id) do nothing;

create or replace function public.get_public_state()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_data jsonb;
  v_bookings jsonb;
begin
  select data into v_data
  from public.goodhands_app_state
  where id = true;

  if v_data is null then
    raise exception 'Shop state is not initialized';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'id', item -> 'id',
        'bookingNumber', item -> 'bookingNumber',
        'partySize', item -> 'partySize',
        'services', item -> 'services',
        'perPersonServices', item -> 'perPersonServices',
        'createdAt', item -> 'createdAt',
        'scheduledAt', item -> 'scheduledAt',
        'startedAt', item -> 'startedAt',
        'pausedAt', item -> 'pausedAt',
        'totalPausedMs', item -> 'totalPausedMs'
      )) order by ordinal
    ),
    '[]'::jsonb
  )
  into v_bookings
  from jsonb_array_elements(coalesce(v_data -> 'bookings', '[]'::jsonb))
    with ordinality as queue(item, ordinal);

  return jsonb_build_object(
    'bookings', v_bookings,
    'completed', '[]'::jsonb,
    'ownerPhone', coalesce(v_data -> 'ownerPhone', to_jsonb(''::text)),
    'hours', coalesce(v_data -> 'hours', '{}'::jsonb)
  );
end;
$$;

create or replace function public.get_owner_state()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_data jsonb;
begin
  select data into v_data
  from public.goodhands_app_state
  where id = true
    and lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', ''));

  if v_data is null then
    raise exception 'This account is not authorized to manage this shop';
  end if;

  return v_data;
end;
$$;

create or replace function public.create_booking(p_booking jsonb, p_position integer)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_data jsonb;
  v_booking jsonb;
  v_bookings jsonb;
  v_position integer;
  v_party_size integer;
  v_phone_digits text;
  v_scheduled_start timestamptz;
  v_service_minutes integer;
  v_lunch_start integer;
  v_lunch_end integer;
  v_time_zone text;
  v_local_start timestamp;
  v_local_now timestamp;
  v_open integer;
  v_close integer;
  v_start_minutes integer;
  v_end_minutes integer;
  v_new_end timestamptz;
  v_has_appointment_conflict boolean;
  v_services text[] := array[
    'Haircut', 'Shave', 'Beard trim', 'Bleach', 'Facial', 'Hair wash'
  ];
begin
  if p_booking is null or jsonb_typeof(p_booking) <> 'object'
    or pg_column_size(p_booking) > 12000 then
    raise exception 'Invalid booking details';
  end if;

  if nullif(btrim(p_booking ->> 'name'), '') is null
    or length(btrim(p_booking ->> 'name')) > 60
    or nullif(btrim(p_booking ->> 'phone'), '') is null
    or length(p_booking ->> 'phone') > 24
    or coalesce((p_booking ->> 'partySize') !~ '^[1-6]$', true) then
    raise exception 'Invalid name, phone, or group size';
  end if;

  v_party_size := (p_booking ->> 'partySize')::integer;
  v_phone_digits := regexp_replace(p_booking ->> 'phone', '[^0-9]', '', 'g');
  if length(v_phone_digits) < 7 or length(v_phone_digits) > 15 then
    raise exception 'Invalid phone number';
  end if;

  if coalesce(jsonb_typeof(p_booking -> 'perPersonServices'), '') <> 'array' then
    raise exception 'Select valid services for every person';
  end if;

  if jsonb_array_length(p_booking -> 'perPersonServices') <> v_party_size
    or exists (
      select 1
      from jsonb_array_elements(p_booking -> 'perPersonServices') as person(services)
      where case
        when jsonb_typeof(person.services) <> 'array' then true
        when jsonb_array_length(person.services) = 0 then true
        else exists (
          select 1
          from jsonb_array_elements_text(person.services) as selected(service)
          where selected.service is null or selected.service <> all(v_services)
        )
      end
    ) then
    raise exception 'Select valid services for every person';
  end if;

  select data into v_data
  from public.goodhands_app_state
  where id = true
  for update;

  if v_data is null then
    raise exception 'Shop state is not initialized';
  end if;

  v_bookings := coalesce(v_data -> 'bookings', '[]'::jsonb);
  if nullif(p_booking ->> 'scheduledAt', '') is not null then
    begin
      v_scheduled_start := (p_booking ->> 'scheduledAt')::timestamptz;
    exception when others then
      raise exception 'Invalid appointment time';
    end;
    v_time_zone := coalesce(nullif(p_booking ->> 'timeZone', ''), current_setting('TimeZone'));
    if not exists (select 1 from pg_timezone_names where name = v_time_zone) then
      raise exception 'Invalid appointment time zone';
    end if;
    v_local_start := v_scheduled_start at time zone v_time_zone;

    select coalesce(sum(
      case selected.service
        when 'Haircut' then 30
        when 'Shave' then 20
        when 'Beard trim' then 15
        when 'Bleach' then 60
        when 'Facial' then 30
        when 'Hair wash' then 15
      end
    ), 0)::integer
    into v_service_minutes
    from jsonb_array_elements(p_booking -> 'perPersonServices') as person(services)
    cross join jsonb_array_elements_text(person.services) as selected(service);

    v_lunch_start := extract(hour from (v_data #>> '{hours,lunchStart}')::time)::integer * 60
      + extract(minute from (v_data #>> '{hours,lunchStart}')::time)::integer;
    v_lunch_end := extract(hour from (v_data #>> '{hours,lunchEnd}')::time)::integer * 60
      + extract(minute from (v_data #>> '{hours,lunchEnd}')::time)::integer;
    v_open := extract(hour from (v_data #>> '{hours,open}')::time)::integer * 60
      + extract(minute from (v_data #>> '{hours,open}')::time)::integer;
    v_close := extract(hour from (v_data #>> '{hours,close}')::time)::integer * 60
      + extract(minute from (v_data #>> '{hours,close}')::time)::integer;
    v_local_now := now() at time zone v_time_zone;
    v_start_minutes := extract(hour from v_local_start)::integer * 60
      + extract(minute from v_local_start)::integer;
    v_end_minutes := v_start_minutes + v_service_minutes;

    if v_local_start::date < v_local_now::date
      or v_local_start::date > v_local_now::date + 1
      or (v_local_start::date = v_local_now::date
        and v_local_start < date_trunc('minute', v_local_now))
      or v_start_minutes < v_open
      or v_start_minutes >= v_close
      or (v_start_minutes >= v_lunch_start and v_start_minutes < v_lunch_end) then
      raise exception 'Choose an available time today or tomorrow during shop hours';
    end if;

    if v_start_minutes < v_lunch_start and v_end_minutes > v_lunch_start then
      v_end_minutes := v_end_minutes + greatest(0, v_lunch_end - v_lunch_start);
    end if;
    if v_end_minutes > v_close then
      raise exception 'The selected services will not finish before closing';
    end if;

    v_new_end := v_scheduled_start + make_interval(mins => v_service_minutes);
    if extract(hour from v_local_start)::integer * 60
        + extract(minute from v_local_start)::integer < v_lunch_start
      and extract(hour from v_local_start)::integer * 60
        + extract(minute from v_local_start)::integer + v_service_minutes > v_lunch_start then
      v_new_end := v_new_end + make_interval(mins => greatest(0, v_lunch_end - v_lunch_start));
    end if;

    with existing_appointments as (
      select
        item,
        (item ->> 'scheduledAt')::timestamptz as starts_at,
        (item ->> 'scheduledAt')::timestamptz
          at time zone coalesce(nullif(item ->> 'timeZone', ''), v_time_zone) as local_start,
        coalesce((
          select sum(
            case selected.service
              when 'Haircut' then 30
              when 'Shave' then 20
              when 'Beard trim' then 15
              when 'Bleach' then 60
              when 'Facial' then 30
              when 'Hair wash' then 15
            end
          )::integer
          from jsonb_array_elements(item -> 'perPersonServices') as person(services)
          cross join jsonb_array_elements_text(person.services) as selected(service)
        ), 0) as duration_minutes
      from jsonb_array_elements(v_bookings) as queue(item)
      where nullif(item ->> 'scheduledAt', '') is not null
    )
    select exists (
      select 1
      from existing_appointments appointment
      where tstzrange(v_scheduled_start, v_new_end, '[)') && tstzrange(
        appointment.starts_at,
        appointment.starts_at + make_interval(mins => appointment.duration_minutes
          + case
            when extract(hour from appointment.local_start)::integer * 60
                + extract(minute from appointment.local_start)::integer < v_lunch_start
              and extract(hour from appointment.local_start)::integer * 60
                + extract(minute from appointment.local_start)::integer + appointment.duration_minutes > v_lunch_start
            then greatest(0, v_lunch_end - v_lunch_start)
            else 0
          end),
        '[)'
      )
    )
    into v_has_appointment_conflict;

    if v_has_appointment_conflict then
      raise exception 'That appointment time is no longer available. Please choose another.';
    end if;
  end if;

  v_position := greatest(0, least(coalesce(p_position, jsonb_array_length(v_bookings)), jsonb_array_length(v_bookings)));
  v_booking := p_booking || jsonb_build_object('createdAt', now()::text);
  v_bookings := jsonb_insert(v_bookings, array[v_position::text], v_booking);
  v_data := jsonb_set(v_data, '{bookings}', v_bookings, true);

  update public.goodhands_app_state
  set data = v_data, updated_at = now()
  where id = true;

  return public.get_public_state();
end;
$$;

create or replace function public.save_owner_state(p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_current jsonb;
  v_missing_bookings jsonb;
  v_merged_state jsonb;
begin
  select data into v_current
  from public.goodhands_app_state
  where id = true
    and lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  for update;

  if v_current is null then
    raise exception 'This account is not authorized to manage this shop';
  end if;

  if p_state is null
    or jsonb_typeof(p_state) <> 'object'
    or jsonb_typeof(p_state -> 'bookings') <> 'array'
    or jsonb_typeof(p_state -> 'completed') <> 'array'
    or jsonb_typeof(p_state -> 'hours') <> 'object' then
    raise exception 'Invalid shop state';
  end if;

  select coalesce(jsonb_agg(current_booking.item order by current_booking.ordinal), '[]'::jsonb)
  into v_missing_bookings
  from jsonb_array_elements(coalesce(v_current -> 'bookings', '[]'::jsonb))
    with ordinality as current_booking(item, ordinal)
  where not exists (
    select 1
    from jsonb_array_elements(p_state -> 'bookings') as saved(item)
    where saved.item ->> 'id' = current_booking.item ->> 'id'
  )
  and not exists (
    select 1
    from jsonb_array_elements(p_state -> 'completed') as finished(item)
    where finished.item ->> 'id' = current_booking.item ->> 'id'
  );

  v_merged_state := jsonb_set(
    p_state,
    '{bookings}',
    (p_state -> 'bookings') || v_missing_bookings,
    true
  );

  update public.goodhands_app_state
  set data = v_merged_state, updated_at = now()
  where id = true;

  return v_merged_state;
end;
$$;

revoke all on function public.get_public_state() from public;
revoke all on function public.get_owner_state() from public;
revoke all on function public.create_booking(jsonb, integer) from public;
revoke all on function public.save_owner_state(jsonb) from public;

grant execute on function public.get_public_state() to anon, authenticated;
grant execute on function public.get_owner_state() to authenticated;
grant execute on function public.create_booking(jsonb, integer) to anon, authenticated;
grant execute on function public.save_owner_state(jsonb) to authenticated;
