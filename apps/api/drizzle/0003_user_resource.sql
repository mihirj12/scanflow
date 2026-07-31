-- Links a CLINICIAN login to the doctor resource they manage.
ALTER TABLE app_user
  ADD COLUMN resource_id uuid REFERENCES resource (id);

UPDATE app_user
SET resource_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
WHERE email = 'clinician@scanflow.local';
