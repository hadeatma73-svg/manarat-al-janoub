-- Used by "delete all invoices" in the app: removes the server-side copies of sale e-mails for the signed-in user.
create or replace function public.purge_sale_mail()
returns void language sql security definer set search_path = '' as $$
  delete from public.mail_queue where user_id = (select auth.uid())
$$;
revoke all on function public.purge_sale_mail() from public, anon;
grant execute on function public.purge_sale_mail() to authenticated;
