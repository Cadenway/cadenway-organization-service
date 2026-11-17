import { eventSchemas } from '@cadenway/contracts/events/identity-service';
import type { UserEmailVerifiedV1 } from '@cadenway/contracts/events/identity-service';
import { EventConsumers } from '@cadenway/nest-messaging';
import { Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';

import { DIRECTORY_REDELIVERY } from '../../../../application/models/directory/directory-redelivery.model.js';
import { ProjectEmailVerification } from '../../../../application/use-cases/commands/directory/project-email-verification/project-email-verification.use-case.js';

/**
 * Class UserEmailVerifiedHandler
 *
 * @description
 * Consumes `user.email-verified.v1` of identity-service into the user directory, through the
 * durable consumer `organization-service__project-user-email-verified`, from what the stream still
 * holds, deduplicated by the kit, applied by version and retried on `DIRECTORY_REDELIVERY`, as
 * `UserSignedUpHandler`.
 */
@Injectable()
export class UserEmailVerifiedHandler implements OnApplicationBootstrap {
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
   * Property projectEmailVerification
   *
   * @description
   * Use case of the projection.
   *
   * @type {ProjectEmailVerification}
   * @readonly
   */
  private readonly projectEmailVerification: ProjectEmailVerification;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Takes the consumers and the use case.
   *
   * @param {EventConsumers} consumers - The event consumers of the kit.
   * @param {ProjectEmailVerification} projectEmailVerification - Use case of the projection.
   * @constructor
   */
  public constructor(
    consumers: EventConsumers,
    projectEmailVerification: ProjectEmailVerification,
  ) {
    this.consumers = consumers;
    this.projectEmailVerification = projectEmailVerification;
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
      handler: 'project-user-email-verified',
      schemas: eventSchemas,
      event: 'user.email-verified.v1',
      redelivery: DIRECTORY_REDELIVERY,
      handle: (payload: UserEmailVerifiedV1): Promise<void> =>
        this.projectEmailVerification.execute({
          userId: payload.userId,
          version: payload.version,
          email: payload.email,
        }),
    });
  }
  // #endregion
}
