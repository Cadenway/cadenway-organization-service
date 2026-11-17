import { describe, expect, it } from 'vitest';

import { InvalidDescriptionError } from '../../errors/organizations/invalid-description.error.js';
import { InvalidOrganizationNameError } from '../../errors/organizations/invalid-organization-name.error.js';
import { InvalidStoredStateError } from '../../errors/organizations/invalid-stored-state.error.js';
import { InvalidWebsiteError } from '../../errors/organizations/invalid-website.error.js';
import { SlugInvalidError } from '../../errors/organizations/slug-invalid.error.js';
import type { OrganizationDraft } from '../../value-objects/organizations/organization-draft.value-object.js';
import type { OrganizationUpdate } from '../../value-objects/organizations/organization-update.value-object.js';
import { Organization } from './organization.aggregate.js';

/** When Atelier Nord was created in the specs. */
const CREATED_AT: Date = new Date('2026-03-02T09:00:00Z');

/** The owner, Camille Martin. */
const CAMILLE_ID: string = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30';

/**
 * Atelier Nord as stored after its creation.
 *
 * @returns The organization.
 */
function atelierNord(): Organization {
  const draft: OrganizationDraft = Organization.found(
    {
      name: ' Atelier Nord ',
      slug: null,
      teamSize: '6-20',
      primaryUse: 'product-engineering',
      ownerUserId: CAMILLE_ID,
    },
    CREATED_AT,
  );
  return Organization.restore({ ...draft, id: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b2f' });
}

describe('Organization', () => {
  it('founds an organization on the plan free, in French, at version 1, owned by its creator', () => {
    expect(atelierNord().snapshot).toMatchObject({
      name: 'Atelier Nord',
      slug: 'atelier-nord',
      description: null,
      website: null,
      defaultLanguage: 'fr',
      plan: 'free',
      ownerUserId: CAMILLE_ID,
      createdAt: CREATED_AT,
      version: 1,
    });
  });

  it('takes the address given instead of deriving it, and refuses an invalid one', () => {
    const founding = {
      name: 'Coopérative Lumen',
      teamSize: '21-100',
      primaryUse: 'other',
      ownerUserId: CAMILLE_ID,
    };

    expect(Organization.found({ ...founding, slug: 'lumen' }, CREATED_AT).slug).toBe('lumen');
    expect(() => Organization.found({ ...founding, slug: 'Lumen!' }, CREATED_AT)).toThrow(
      SlugInvalidError,
    );
  });

  it('refuses a name made only of spaces, or longer than 120 characters', () => {
    const founding = { slug: null, teamSize: '1-5', primaryUse: 'other', ownerUserId: CAMILLE_ID };

    expect(() => Organization.found({ ...founding, name: '   ' }, CREATED_AT)).toThrow(
      InvalidOrganizationNameError,
    );
    expect(() => Organization.found({ ...founding, name: 'a'.repeat(121) }, CREATED_AT)).toThrow(
      InvalidOrganizationNameError,
    );
  });

  it('applies a merge patch: absent members unchanged, null clears, the version goes up', () => {
    const update: OrganizationUpdate = atelierNord().change({
      description: 'Studio de conception de mobilier et d’aménagement.',
      website: 'https://ateliernord.fr',
    });

    expect(update.changed).toEqual(['description', 'website']);
    expect(update.organization.snapshot).toMatchObject({
      name: 'Atelier Nord',
      description: 'Studio de conception de mobilier et d’aménagement.',
      website: 'https://ateliernord.fr',
      version: 2,
    });
    const cleared: OrganizationUpdate = update.organization.change({ website: null });
    expect(cleared.changed).toEqual(['website']);
    expect(cleared.organization.snapshot).toMatchObject({ website: null, version: 3 });
  });

  it('keeps the same organization and version for a patch that changes nothing', () => {
    const organization: Organization = atelierNord();

    const update: OrganizationUpdate = organization.change({
      name: '  Atelier Nord',
      slug: 'atelier-nord',
      defaultLanguage: 'fr',
    });

    expect(update.changed).toEqual([]);
    expect(update.organization).toBe(organization);
  });

  it('refuses a blank name, a long description and a website that is not http', () => {
    const organization: Organization = atelierNord();

    expect(() => organization.change({ name: ' ' })).toThrow(InvalidOrganizationNameError);
    expect(() => organization.change({ description: 'x'.repeat(281) })).toThrow(
      InvalidDescriptionError,
    );
    expect(() => organization.change({ website: 'javascript:alert(1)' })).toThrow(
      InvalidWebsiteError,
    );
    expect(() => organization.change({ slug: 'Atelier Nord' })).toThrow(SlugInvalidError);
  });

  it('refuses a stored organization without a positive version', () => {
    expect(() => Organization.restore({ ...atelierNord().snapshot, version: 0 })).toThrow(
      InvalidStoredStateError,
    );
  });
});
