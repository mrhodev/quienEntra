-- Vista pública (RF-31, CA-07): datos mínimos de un equipo con link público activo.
-- Permite mostrar la página aunque todavía no haya partidos finalizados, y devolver 404
-- si el link se desactivó o se regeneró. El rol anon sigue sin acceso directo a las tablas.
create or replace function public_team_info(p_slug text)
returns table (team_name text, team_color text)
language sql stable security definer set search_path = public as $$
  select t.name, t.color
  from teams t
  where t.public_slug = p_slug and t.is_public and t.deleted_at is null;
$$;

revoke all on function public_team_info(text) from public;
grant execute on function public_team_info(text) to anon, authenticated;

-- Latido diario (spec §11): Supabase Free pausa el proyecto tras 7 días sin actividad.
create or replace function keepalive()
returns int
language sql stable security definer set search_path = public as $$
  select 1;
$$;

revoke all on function keepalive() from public;
grant execute on function keepalive() to anon, authenticated;
