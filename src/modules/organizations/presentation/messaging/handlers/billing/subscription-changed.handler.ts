import {
  SUBSCRIPTION_CHANGED_V1,
  subscriptionChangedV1Schema,
} from '@cadenway/contracts/events/billing-service';
import type { EventConsumers } from '@cadenway/nest-messaging';
import type { OnApplicationBootstrap } from '@nestjs/common';

import type { ApplySeatEntitlement } from '../../../../application/use-cases/commands/billing/apply-seat-entitlement/apply-seat-entitlement.use-case.js';

const schemas = {
  [SUBSCRIPTION_CHANGED_V1]: subscriptionChangedV1Schema.refine(
    ({ actor }) => actor.type === 'system' && actor.id === 'billing-service',
    { path: ['actor'], error: 'Expected the Billing system actor.' },
  ),
};

/** Applies Billing snapshots from the dedicated subject whose publisher is restricted by NATS. */
export class SubscriptionChangedHandler implements OnApplicationBootstrap {
  // #region Constructor
  /** Receives the consumer, the tenant-scoped projector and the rollout configuration. */
  public constructor(
    private readonly consumers: EventConsumers,
    private readonly applySeatEntitlement: ApplySeatEntitlement,
    private readonly enabled: boolean,
  ) {}
  // #endregion

  // #region Methods
  /** Starts from retained deliveries when the deployment enables this consumer. */
  public async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) return;

    await this.consumers.subscribe({
      handler: 'project-seat-entitlement',
      schemas,
      event: SUBSCRIPTION_CHANGED_V1,
      deliverPolicy: 'all',
      redelivery: {
        delaysMs: [1_000, 5_000, 30_000, 120_000, 600_000, 1_800_000, 3_600_000],
        maxDeliveries: 32,
      },
      handle: async ({ organizationId, plan, seatLimit, storageByteLimit, version }) => {
        await this.applySeatEntitlement.execute({
          organizationId,
          entitlement: { plan, seatLimit, version },
          storageByteLimit,
        });
      },
    });
  }
  // #endregion
}
