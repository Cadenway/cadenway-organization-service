import { CONFIG } from '@cadenway/nest-common';
import { EventConsumers } from '@cadenway/nest-messaging';
import type { FactoryProvider } from '@nestjs/common';

import type { AppConfig } from '../../../../../../config/app-config.js';
import { ApplySeatEntitlement } from '../../../../application/use-cases/commands/billing/apply-seat-entitlement/apply-seat-entitlement.use-case.js';
import { SubscriptionChangedHandler } from '../../../../presentation/messaging/handlers/billing/subscription-changed.handler.js';

/** Wires the Billing subscriber with its independent rollout flag. */
export const subscriptionChangedHandlerProvider: FactoryProvider<SubscriptionChangedHandler> = {
  provide: SubscriptionChangedHandler,
  inject: [EventConsumers, ApplySeatEntitlement, CONFIG],
  useFactory: (
    consumers: EventConsumers,
    applySeatEntitlement: ApplySeatEntitlement,
    config: AppConfig,
  ): SubscriptionChangedHandler =>
    new SubscriptionChangedHandler(
      consumers,
      applySeatEntitlement,
      config.ORGANIZATION_SEAT_ENTITLEMENT_EVENTS_ENABLED,
    ),
};
