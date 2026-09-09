-- Normalize the current eligibility projection text so the following
-- reversible-operations migration can install the operational lifecycle guard
-- without depending on whitespace differences between environments.

do $$
declare
  body text;
  original text;
begin
  if to_regprocedure('private.participant_eligibility_projection(uuid)') is null then
    raise exception 'Expected private.participant_eligibility_projection(uuid) before reversible operations compatibility migration';
  end if;

  body := pg_get_functiondef('private.participant_eligibility_projection(uuid)'::regprocedure);
  original := body;
  body := replace(
    body,
    'p.attendance_status<>''confirmed_not_attending''',
    'p.attendance_status <> ''confirmed_not_attending'''
  );

  if body = original then
    -- Already normalized is acceptable; any other shape should stop here.
    if position('p.attendance_status <> ''confirmed_not_attending''' in body) = 0 then
      raise exception 'Eligibility projection baseline drifted; attendance guard could not be normalized';
    end if;
    return;
  end if;

  execute body;
end;
$$;