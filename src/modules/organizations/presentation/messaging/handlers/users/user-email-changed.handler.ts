import { eventSchemas } from '@cadenway/contracts/events/identity-service';
import type { UserEmailChangedV1 } from '@cadenway/contracts/events/identity-service';
import { EventConsumers } from '@cadenway/nest-messaging';
import { Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';

import { DIRECTORY_REDELIVERY } from '../../../../application/models/directory/directory-redelivery.model.js';
import { ProjectEmailChange } from '../../../../application/use-cases/commands/directory/project-email-change/project-email-change.use-case.js';

/**
 * Class UserEmailChangedHandler
 *
 * @description
 * Consumes `user.email-changed.v1` of identity-service into the user directory, through the
 * durable consumer `organization-service__project-user-email-changed`, from what the stream still
 * holds, deduplicated by the kit, applied by version and retried on `DIRECTORY_REDELIVERY`, as
 * `UserSignedUpHandler`. Only the new address is read: the name, the device and the address of
 * the previous email are for the notice of notification-service.
 */
@Injectable()
export class UserEmailChangedHandler implements OnApplicationBootstrap {
  // #region Properties
  /**
   * Property consumers
   *
   * @description
   * The event consumers of the kit.
   *
   * @type {EventConsumers}
   * @readonly
   */
  private readonly consumers: EventConsumers;

  /**
   * Property projectEmailChange
   *
   * @description
   * Use case of the projection.
   *
   * @type {ProjectEmailChange}
   * @readonly
   */
  private readonly projectEmailChange: ProjectEmailChange;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Takes the consumers and the use case.
   *
   * @param {EventConsumers} consumers - The event consumers of the kit.
   * @param {ProjectEmailChange} projectEmailChange - Use case of the projection.
   * @constructor
   */
  public constructor(consumers: EventConsumers, projectEmailChange: ProjectEmailChange) {
    this.consumers = consumers;
    this.projectEmailChange = projectEmailChange;
  }
  // #endregion

  // #region Methods
  /**
   * Method onApplicationBootstrap
   *
   * @description
   * Registers the durable consumer once the application has bootstrapped.
   *
   * @returns {Promise<void>} Resolves once subscribed.
   */
  public async onApplicationBootstrap(): Promise<void> {
    await this.consumers.subscribe({
      handler: 'project-user-email-changed',
      schemas: eventSchemas,
      event: 'user.email-changed.v1',
      redelivery: DIRECTORY_REDELIVERY,
      handle: (payload: UserEmailChangedV1): Promise<void> =>
        this.projectEmailChange.execute({
          userId: payload.userId,
          version: payload.version,
          email: payload.email,
        }),
    });
  }
  // #endregion
}
