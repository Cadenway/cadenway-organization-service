import { eventSchemas } from '@cadenway/contracts/events/identity-service';
import type { UserProfileUpdatedV1 } from '@cadenway/contracts/events/identity-service';
import { EventConsumers } from '@cadenway/nest-messaging';
import { Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';

import { ProjectProfileUpdate } from '../../../../application/use-cases/commands/directory/project-profile-update/project-profile-update.use-case.js';

/**
 * Class UserProfileUpdatedHandler
 *
 * @description
 * Consumes `user.profile-updated.v1` of identity-service into the user directory, through the
 * durable consumer `organization-service__project-user-profile-updated`, from what the stream
 * still holds, deduplicated by the kit and applied by version, as `UserSignedUpHandler`.
 */
@Injectable()
export class UserProfileUpdatedHandler implements OnApplicationBootstrap {
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
   * Property projectProfileUpdate
   *
   * @description
   * Use case of the projection.
   *
   * @type {ProjectProfileUpdate}
   * @readonly
   */
  private readonly projectProfileUpdate: ProjectProfileUpdate;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Takes the consumers and the use case.
   *
   * @param {EventConsumers} consumers - The event consumers of the kit.
   * @param {ProjectProfileUpdate} projectProfileUpdate - Use case of the projection.
   * @constructor
   */
  public constructor(consumers: EventConsumers, projectProfileUpdate: ProjectProfileUpdate) {
    this.consumers = consumers;
    this.projectProfileUpdate = projectProfileUpdate;
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
      handler: 'project-user-profile-updated',
      schemas: eventSchemas,
      event: 'user.profile-updated.v1',
      handle: (payload: UserProfileUpdatedV1): Promise<void> =>
        this.projectProfileUpdate.execute({
          userId: payload.userId,
          version: payload.version,
          name: payload.name,
        }),
    });
  }
  // #endregion
}
