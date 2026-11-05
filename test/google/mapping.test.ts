/**
 * Consent types of each purpose: built-in integrations, `consentMode`, the rule that every purpose
 * that controls a type must be granted, and the types no purpose controls.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { ConsentChoices } from 'lgpder';
import type { ConsentType, GoogleOptions } from 'lgpder/google';

import { testDom } from '../support/dom.ts';
import {
  CONSENT_TYPES,
  closeGoogles,
  consentWith,
  lastUpdate,
  openGoogle,
} from '../support/google.ts';
import type { PurposeId } from '../support/setup.ts';

afterEach(() => {
  closeGoogles();
  testDom.reset();
});

interface MappingCase {
  readonly case: string;
  readonly purposes: GoogleOptions<PurposeId>['purposes'];
  readonly choices: ConsentChoices<PurposeId>;
  /** Types expected as granted; every other type is expected as denied. */
  readonly granted: readonly ConsentType[];
}

const AD_TYPES: readonly ConsentType[] = ['ad_storage', 'ad_user_data', 'ad_personalization'];

/** analytics_storage controlled by analytics, through its integration, and by ads, directly. */
const SHARED_ANALYTICS: GoogleOptions<PurposeId>['purposes'] = {
  analytics: { integrations: ['google-analytics'] },
  ads: { consentMode: ['analytics_storage'] },
};

const CASES: readonly MappingCase[] = [
  {
    case: 'google-analytics controls analytics_storage',
    purposes: { analytics: { integrations: ['google-analytics'] } },
    choices: { analytics: 'granted' },
    granted: ['analytics_storage'],
  },
  {
    case: 'google-ads controls ad_storage, ad_user_data and ad_personalization',
    purposes: { ads: { integrations: ['google-ads'] } },
    choices: { ads: 'granted' },
    granted: AD_TYPES,
  },
  {
    case: 'consentMode controls the types it lists',
    purposes: { analytics: { consentMode: ['functionality_storage', 'security_storage'] } },
    choices: { analytics: 'granted' },
    granted: ['functionality_storage', 'security_storage'],
  },
  {
    case: 'the types of the integrations and of consentMode add up',
    purposes: {
      ads: { integrations: ['google-ads'], consentMode: ['personalization_storage'] },
    },
    choices: { ads: 'granted' },
    granted: [...AD_TYPES, 'personalization_storage'],
  },
  {
    case: 'a type listed by an integration and by consentMode is granted with the purpose',
    purposes: { ads: { integrations: ['google-ads'], consentMode: ['ad_storage'] } },
    choices: { ads: 'granted' },
    granted: AD_TYPES,
  },
  {
    case: 'two integrations of one purpose',
    purposes: { ads: { integrations: ['google-analytics', 'google-ads'] } },
    choices: { ads: 'granted' },
    granted: ['analytics_storage', ...AD_TYPES],
  },
  {
    case: 'a type of two purposes is granted when both are',
    purposes: SHARED_ANALYTICS,
    choices: { analytics: 'granted', ads: 'granted' },
    granted: ['analytics_storage'],
  },
  {
    case: 'a type of two purposes is denied when one of them is denied',
    purposes: SHARED_ANALYTICS,
    choices: { analytics: 'granted', ads: 'denied' },
    granted: [],
  },
  {
    case: 'a type of two purposes is denied when one of them is pending',
    purposes: SHARED_ANALYTICS,
    choices: { analytics: 'granted' },
    granted: [],
  },
  {
    case: 'a denied purpose controls nothing as granted',
    purposes: { analytics: { integrations: ['google-analytics'] } },
    choices: { analytics: 'denied' },
    granted: [],
  },
  {
    case: 'a granted purpose without types grants no type',
    purposes: { analytics: {}, ads: { integrations: [], consentMode: [] } },
    choices: { analytics: 'granted', ads: 'granted' },
    granted: [],
  },
  {
    case: 'with no purpose mapped, every type is denied',
    purposes: {},
    choices: { analytics: 'granted', ads: 'granted' },
    granted: [],
  },
];

describe('consent types of each purpose', () => {
  for (const { case: name, purposes, choices, granted } of CASES) {
    it(name, () => {
      const { consent } = openGoogle({ purposes });

      consent.decide(choices);

      assert.deepStrictEqual(lastUpdate(), consentWith(...granted));
    });
  }

  it('every type is sent, in a fixed order, also the ones no purpose controls', () => {
    const { consent } = openGoogle({ purposes: { ads: { integrations: ['google-ads'] } } });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(Object.keys(lastUpdate() ?? {}), CONSENT_TYPES);
  });

  it('a type of two purposes goes back to denied when one of them is revoked', () => {
    const { consent } = openGoogle({ purposes: SHARED_ANALYTICS });
    consent.decide({ analytics: 'granted', ads: 'granted' });

    consent.decide({ ads: 'denied' });

    assert.deepStrictEqual(lastUpdate(), consentWith());
  });

  it('grantAll leaves denied a type also controlled by an individualGrant purpose', () => {
    const { consent } = openGoogle({
      purposes: {
        analytics: { integrations: ['google-analytics'] },
        health: { consentMode: ['analytics_storage'] },
        ads: { integrations: ['google-ads'] },
      },
    });

    consent.grantAll();

    assert.deepStrictEqual(lastUpdate(), consentWith(...AD_TYPES));
  });

  it('denyAll denies every type', () => {
    const { consent } = openGoogle({
      purposes: {
        analytics: { integrations: ['google-analytics'] },
        ads: { integrations: ['google-ads'] },
      },
    });
    consent.grantAll();

    consent.denyAll();

    assert.deepStrictEqual(lastUpdate(), consentWith());
  });
});
