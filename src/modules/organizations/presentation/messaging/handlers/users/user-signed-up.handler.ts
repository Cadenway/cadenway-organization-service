import { eventSchemas } from '@cadenway/contracts/events/identity-service';
import type { UserSignedUpV1 } from '@cadenway/contracts/events/identity-service';
import { EventConsumers } from '@cadenway/nest-messaging';
import { Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';

import { ProjectUserSignUp } from '../../../../application/use-cases/commands/directory/project-user-sign-up/project-user-sign-up.use-case.js';

/**
 * Class UserSignedUpHandler
 *
 * @description
 * Consumes `user.signed-up.v1` of identity-service into the user directory, through the durable
 * consumer `organization-service__project-user-signed-up`. It starts from what the stream still
 * holds (`deliverPolicy: 'all'`, the default), so a new deployment learns the accounts signed up
 * before it. The deduplicator of the kit records each event id with the effect, in the system
 * transaction of the delivery, so a redelivery is skipped; the use case applies by version.
 */
@Injectable()
export class UserSignedUpHandler implements OnApplicationBootstrap {
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
   * Property projectUserSignUp
   *
   * @description
   * Use case of the projection.
   *
   * @type {ProjectUserSignUp}
   * @readonly
   */
  private readonly projectUserSignUp: ProjectUserSignUp;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Takes the consumers and the use case.
   *
   * @param {EventConsumers} consumers - The event consumers of the kit.
   * @param {ProjectUserSignUp} projectUserSignUp - Use case of the projection.
   * @constructor
   */
  public constructor(consumers: EventConsumers, projectUserSignUp: ProjectUserSignUp) {
    this.consumers = consumers;
    this.projectUserSignUp = projectUserSignUp;
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
      handler: 'project-user-signed-up',
      schemas: eventSchemas,
      event: 'user.signed-up.v1',
      handle: (payload: UserSignedUpV1): Promise<void> =>
        this.projectUserSignUp.execute({
          userId: payload.userId,
          version: payload.version,
          email: payload.email,
          name: payload.name,
        }),
    });
  }
  // #endregion
}
