import { eventSchemas } from '@cadenway/contracts/events/identity-service';
import type { UserDeletedV1 } from '@cadenway/contracts/events/identity-service';
import { EventConsumers } from '@cadenway/nest-messaging';
import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';

import { DIRECTORY_REDELIVERY } from '../../../../application/models/directory/directory-redelivery.model.js';
import { DeletedOwnerRefusal } from '../../../../application/models/members/deleted-owner-refusal.model.js';
import { RemoveDeletedUser } from '../../../../application/use-cases/commands/members/remove-deleted-user/remove-deleted-user.use-case.js';

/**
 * Class UserDeletedHandler
 *
 * @description
 * Consumes `user.deleted.v1` of identity-service through the durable consumer
 * `organization-service__remove-deleted-user`: the memberships of the account are removed and its
 * directory entry becomes a former member. Like the directory consumers, it starts from what the
 * stream still holds, is deduplicated by the kit and retried on `DIRECTORY_REDELIVERY`, about 25
 * hours before its dead letter, since the deletion stops the access of the account to its
 * organizations. A deletion of an owner, which the contract excludes, is logged with its ids and
 * fails every delivery until the dead letter, without changing anything.
 */
@Injectable()
export class UserDeletedHandler implements OnApplicationBootstrap {
  // #region Properties
  /**
   * Property logger
   *
   * @description
   * Logger of the handler, routed to the JSON logs of the kit; it writes ids only.
   *
   * @type {Logger}
   * @readonly
   */
  private readonly logger: Logger = new Logger(UserDeletedHandler.name);

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
   * Property removeDeletedUser
   *
   * @description
   * Use case of the removal.
   *
   * @type {RemoveDeletedUser}
   * @readonly
   */
  private readonly removeDeletedUser: RemoveDeletedUser;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Takes the consumers and the use case.
   *
   * @param {EventConsumers} consumers - The event consumers of the kit.
   * @param {RemoveDeletedUser} removeDeletedUser - Use case of the removal.
   * @constructor
   */
  public constructor(consumers: EventConsumers, removeDeletedUser: RemoveDeletedUser) {
    this.consumers = consumers;
    this.removeDeletedUser = removeDeletedUser;
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
      handler: 'remove-deleted-user',
      schemas: eventSchemas,
      event: 'user.deleted.v1',
      redelivery: DIRECTORY_REDELIVERY,
      handle: (payload: UserDeletedV1): Promise<void> => this.handle(payload),
    });
  }

  /**
   * Method handle
   *
   * @description
   * Applies one delivery; a refused deletion of an owner is logged, then fails the delivery.
   *
   * @param {UserDeletedV1} payload - The event.
   * @returns {Promise<void>} Resolves once applied.
   * @throws {DeletedOwnerRefusal} When the account owns an organization.
   */
  private async handle(payload: UserDeletedV1): Promise<void> {
    try {
      await this.removeDeletedUser.execute({ userId: payload.userId, version: payload.version });
    } catch (error) {
      if (error instanceof DeletedOwnerRefusal) {
        this.logger.error(
          {
            eventId: payload.id,
            deletedUserId: payload.userId,
            ownedOrganizationIds: error.organizationIds,
          },
          'user.deleted.v1 refused: the deleted account still owns an organization',
        );
      }
      throw error;
    }
  }
  // #endregion
}
