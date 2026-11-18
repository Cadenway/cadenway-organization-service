import { eventSchemas } from '@cadenway/contracts/events/identity-service';
import type { UserTwoStepVerificationChangedV1 } from '@cadenway/contracts/events/identity-service';
import { EventConsumers } from '@cadenway/nest-messaging';
import { Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';

import { DIRECTORY_REDELIVERY } from '../../../../application/models/directory/directory-redelivery.model.js';
import { ProjectTwoStepVerificationChange } from '../../../../application/use-cases/commands/directory/project-two-step-verification-change/project-two-step-verification-change.use-case.js';

/**
 * Class UserTwoStepVerificationChangedHandler
 *
 * @description
 * Consumes `user.two-step-verification-changed.v1` of identity-service into the user directory,
 * through the durable consumer `organization-service__project-user-two-step`, from what the stream
 * still holds, deduplicated by the kit, applied by version and retried on `DIRECTORY_REDELIVERY`,
 * as `UserSignedUpHandler`. Only `userId`, `version` and `enabled` are read (data minimisation):
 * the `change`, the methods, the backup codes, the security key, the device, the IP address, the
 * recipient, the language and the time zone are for the email of notification-service, and are
 * neither passed on, stored nor logged here.
 */
@Injectable()
export class UserTwoStepVerificationChangedHandler implements OnApplicationBootstrap {
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
   * Property projectTwoStepVerificationChange
   *
   * @description
   * Use case of the projection.
   *
   * @type {ProjectTwoStepVerificationChange}
   * @readonly
   */
  private readonly projectTwoStepVerificationChange: ProjectTwoStepVerificationChange;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Takes the consumers and the use case.
   *
   * @param {EventConsumers} consumers - The event consumers of the kit.
   * @param {ProjectTwoStepVerificationChange} projectTwoStepVerificationChange - Use case of the
   * projection.
   * @constructor
   */
  public constructor(
    consumers: EventConsumers,
    projectTwoStepVerificationChange: ProjectTwoStepVerificationChange,
  ) {
    this.consumers = consumers;
    this.projectTwoStepVerificationChange = projectTwoStepVerificationChange;
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
      handler: 'project-user-two-step',
      schemas: eventSchemas,
      event: 'user.two-step-verification-changed.v1',
      redelivery: DIRECTORY_REDELIVERY,
      handle: (payload: UserTwoStepVerificationChangedV1): Promise<void> =>
        this.projectTwoStepVerificationChange.execute({
          userId: payload.userId,
          version: payload.version,
          enabled: payload.enabled,
        }),
    });
  }
  // #endregion
}
