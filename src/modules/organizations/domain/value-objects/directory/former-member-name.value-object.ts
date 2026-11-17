/**
 * Constant FORMER_MEMBER_NAME
 *
 * @description
 * The name shown for an account identity-service deleted, wherever it still appears, such as the
 * sender of a pending invitation (`invitedBy.name`). The copy of the mockup ("Vos tâches et
 * commentaires restent dans les organisations, attribués à « Ancien membre ».") and of
 * `user.deleted.v1` in `asyncapi/identity-service.yaml`: the directory forgets the name and the
 * address of a deleted account, so nothing else can be shown.
 *
 * @type {string}
 */
export const FORMER_MEMBER_NAME: string = 'Ancien membre';
