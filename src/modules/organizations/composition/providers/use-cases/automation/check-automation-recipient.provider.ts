import { TenantTransactionRunner } from '@cadenway/nest-common/database';
import type { FactoryProvider } from '@nestjs/common';

import { CheckAutomationRecipient } from '../../../../application/use-cases/queries/automation/check-automation-recipient/check-automation-recipient.use-case.js';
import { DrizzleAutomationRecipientReader } from '../../../../infrastructure/persistence/drizzle/repositories/automation/drizzle-automation-recipient.repository.js';

/** Binds the current automation recipient decision to Organization PostgreSQL. */
export const checkAutomationRecipientProvider: FactoryProvider<CheckAutomationRecipient> = {
  provide: CheckAutomationRecipient,
  inject: [TenantTransactionRunner],
  useFactory: (runner: TenantTransactionRunner): CheckAutomationRecipient =>
    new CheckAutomationRecipient(new DrizzleAutomationRecipientReader(runner)),
};
