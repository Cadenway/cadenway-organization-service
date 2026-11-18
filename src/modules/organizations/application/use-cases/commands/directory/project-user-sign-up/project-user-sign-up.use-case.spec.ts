import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryOrganizations } from '../../../organizations.fixture.js';
import { ProjectEmailChange } from '../project-email-change/project-email-change.use-case.js';
import { ProjectEmailVerification } from '../project-email-verification/project-email-verification.use-case.js';
import { ProjectProfileUpdate } from '../project-profile-update/project-profile-update.use-case.js';
import { ProjectTwoStepVerificationChange } from '../project-two-step-verification-change/project-two-step-verification-change.use-case.js';
import { ProjectUserSignUp } from './project-user-sign-up.use-case.js';

/** Léa Petit, an account of identity-service. */
const LEA_ID: string = '019a5f3c-d0b1-7c2d-9e3f-5a6b7c8d9e35';

describe('the projection of the user directory', () => {
  let store: InMemoryOrganizations;

  beforeEach(() => {
    store = new InMemoryOrganizations();
  });

  it('applies the account events in any order, by version, and each one once', async () => {
    const signUp: ProjectUserSignUp = new ProjectUserSignUp(store);
    const verify: ProjectEmailVerification = new ProjectEmailVerification(store);
    const rename: ProjectProfileUpdate = new ProjectProfileUpdate(store);

    await rename.execute({ userId: LEA_ID, version: 3, name: 'Léa Petit-Roux' });
    await verify.execute({ userId: LEA_ID, version: 2, email: 'Lea.Petit@ateliernord.fr' });
    await signUp.execute({
      userId: LEA_ID,
      version: 1,
      email: 'lea.petit@ateliernord.fr',
      name: 'Léa Petit',
    });
    await verify.execute({ userId: LEA_ID, version: 2, email: 'lea.petit@ateliernord.fr' });

    expect(store.tables.directory.get(LEA_ID)).toEqual({
      userId: LEA_ID,
      name: 'Léa Petit-Roux',
      nameVersion: 3,
      email: 'lea.petit@ateliernord.fr',
      emailVerified: true,
      emailVersion: 2,
      twoStepVerificationEnabled: false,
      twoStepVerificationVersion: 0,
      deleted: false,
    });
  });

  it('applies the two-step verification of an account by version, before or after its sign-up', async () => {
    const signUp: ProjectUserSignUp = new ProjectUserSignUp(store);
    const twoStep: ProjectTwoStepVerificationChange = new ProjectTwoStepVerificationChange(store);

    await twoStep.execute({ userId: LEA_ID, version: 5, enabled: false });
    await twoStep.execute({ userId: LEA_ID, version: 4, enabled: true });
    await signUp.execute({
      userId: LEA_ID,
      version: 1,
      email: 'lea.petit@ateliernord.fr',
      name: 'Léa Petit',
    });
    await twoStep.execute({ userId: LEA_ID, version: 5, enabled: false });

    expect(store.tables.directory.get(LEA_ID)).toMatchObject({
      name: 'Léa Petit',
      nameVersion: 1,
      twoStepVerificationEnabled: false,
      twoStepVerificationVersion: 5,
    });

    await twoStep.execute({ userId: LEA_ID, version: 6, enabled: true });

    expect(store.tables.directory.get(LEA_ID)).toMatchObject({
      twoStepVerificationEnabled: true,
      twoStepVerificationVersion: 6,
    });
  });

  it('applies a change of address by version, over a late verification of the previous one', async () => {
    const signUp: ProjectUserSignUp = new ProjectUserSignUp(store);
    const verify: ProjectEmailVerification = new ProjectEmailVerification(store);
    const change: ProjectEmailChange = new ProjectEmailChange(store);

    await signUp.execute({
      userId: LEA_ID,
      version: 1,
      email: 'lea.petit@ateliernord.fr',
      name: 'Léa Petit',
    });
    await change.execute({ userId: LEA_ID, version: 4, email: 'Lea@AtelierNord.fr' });
    await verify.execute({ userId: LEA_ID, version: 2, email: 'lea.petit@ateliernord.fr' });
    await change.execute({ userId: LEA_ID, version: 4, email: 'lea@ateliernord.fr' });

    expect(store.tables.directory.get(LEA_ID)).toMatchObject({
      email: 'lea@ateliernord.fr',
      emailVerified: true,
      emailVersion: 4,
    });
  });
});
