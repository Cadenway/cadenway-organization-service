SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE FUNCTION "public"."require_account_available_for_membership"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  unavailable boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.removed_at IS NULL AND OLD.organization_id = NEW.organization_id
      AND OLD.user_id = NEW.user_id AND (OLD.role = 'owner' OR NEW.role <> 'owner')
    THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Match the lock order used by account deletion and retain the lock even without a reservation.
  SELECT deleted OR deletion_attempt_id IS NOT NULL
    INTO unavailable
    FROM "public"."directory_users"
    WHERE user_id = NEW.user_id
    FOR SHARE;
  IF unavailable THEN
    RAISE EXCEPTION 'The account cannot receive a membership.'
      USING ERRCODE = '23514', CONSTRAINT = 'members_require_available_account';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "members_require_available_account"
BEFORE INSERT OR UPDATE OF "user_id", "organization_id", "removed_at", "role" ON "public"."members"
FOR EACH ROW WHEN (NEW.removed_at IS NULL)
EXECUTE FUNCTION "public"."require_account_available_for_membership"();
