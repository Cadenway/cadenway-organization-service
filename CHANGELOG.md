# Changelog

## [0.4.0](https://github.com/Cadenway/cadenway-organization-service/compare/v0.3.0...v0.4.0) (2026-11-23)


### Features

* **billing:** enforce versioned seat entitlements ([#39](https://github.com/Cadenway/cadenway-organization-service/issues/39)) ([929e9eb](https://github.com/Cadenway/cadenway-organization-service/commit/929e9ebddbe2c78d91d8a0e7c88bb5f68180493a))
* **organization:** expose member names for task exports ([#33](https://github.com/Cadenway/cadenway-organization-service/issues/33)) ([2ae1ee0](https://github.com/Cadenway/cadenway-organization-service/commit/2ae1ee035cbfacec478f99e47b7cb63646757ed1))
* **organizations:** add organizations, members, invitations and the user directory ([#26](https://github.com/Cadenway/cadenway-organization-service/issues/26)) ([755f18b](https://github.com/Cadenway/cadenway-organization-service/commit/755f18bd14420d94df8e6c45a984c8713f1e5bd7))
* **organizations:** enforce the free plan seat limit when enabled ([#37](https://github.com/Cadenway/cadenway-organization-service/issues/37)) ([7afc7d2](https://github.com/Cadenway/cadenway-organization-service/commit/7afc7d20cbe2f838c199280b8c6c7f64d0c7cc99))
* **organizations:** export memberships for offline task recovery ([#40](https://github.com/Cadenway/cadenway-organization-service/issues/40)) ([73f57ff](https://github.com/Cadenway/cadenway-organization-service/commit/73f57ff6f9a5abca56988994576a0aec38b13130))
* **organizations:** expose authoritative search evidence ([#35](https://github.com/Cadenway/cadenway-organization-service/issues/35)) ([d839e41](https://github.com/Cadenway/cadenway-organization-service/commit/d839e4143ef65831d73e71278d39900f2de54faf))
* **organizations:** expose signed billing authority ([#36](https://github.com/Cadenway/cadenway-organization-service/issues/36)) ([a59bb39](https://github.com/Cadenway/cadenway-organization-service/commit/a59bb390034cb9f62068d399c951aaeca0078a97))
* **organizations:** follow address changes and account deletions ([#29](https://github.com/Cadenway/cadenway-organization-service/issues/29)) ([c8e21bf](https://github.com/Cadenway/cadenway-organization-service/commit/c8e21bf0ec6d858e1e9bf46b5d553a512d40d52d))
* **organizations:** keep the two-step verification of accounts for owners and admins ([#31](https://github.com/Cadenway/cadenway-organization-service/issues/31)) ([ca3d0bc](https://github.com/Cadenway/cadenway-organization-service/commit/ca3d0bc82d14bbac42e7865cec099f00f6f3dd10))
* **organizations:** provide scoped live membership proofs ([#41](https://github.com/Cadenway/cadenway-organization-service/issues/41)) ([e53643c](https://github.com/Cadenway/cadenway-organization-service/commit/e53643cfd2ff9a618e58877addec84ab3c431687))
* **organizations:** reserve and manage private organization logos ([#34](https://github.com/Cadenway/cadenway-organization-service/issues/34)) ([ec8a98d](https://github.com/Cadenway/cadenway-organization-service/commit/ec8a98d89741a9a29930fb65353ac0977e62829a))
* **organizations:** verify current automation recipients ([#38](https://github.com/Cadenway/cadenway-organization-service/issues/38)) ([db67411](https://github.com/Cadenway/cadenway-organization-service/commit/db674119fed1f108b5c2df82a840217b34b5b0f0))


### Bug Fixes

* **organizations:** limit invitation emails and keep retrying directory events for a day ([#28](https://github.com/Cadenway/cadenway-organization-service/issues/28)) ([f907829](https://github.com/Cadenway/cadenway-organization-service/commit/f907829637699558ea19510caf5b8c47b9a766b9))
* **organizations:** protect account deletion and expose active Checkout seats ([#43](https://github.com/Cadenway/cadenway-organization-service/issues/43)) ([69b4196](https://github.com/Cadenway/cadenway-organization-service/commit/69b419675d86612b3de0f6b7900072e30dab75aa))
* **organizations:** protect membership and invitation authority ([#42](https://github.com/Cadenway/cadenway-organization-service/issues/42)) ([dd6a355](https://github.com/Cadenway/cadenway-organization-service/commit/dd6a355061e649027507698964bee041f1c9cd81))

## [0.3.0](https://github.com/Cadenway/cadenway-organization-service/compare/v0.2.0...v0.3.0) (2026-11-16)


### Features

* wire messaging and the outbox onto nest-common 0.3.0 ([#20](https://github.com/Cadenway/cadenway-organization-service/issues/20)) ([bca2307](https://github.com/Cadenway/cadenway-organization-service/commit/bca23071abf405a43feb14cf009e89868ab562a4))


### Bug Fixes

* **deploy:** keep the migrator url out of the running service ([#22](https://github.com/Cadenway/cadenway-organization-service/issues/22)) ([2b5c33e](https://github.com/Cadenway/cadenway-organization-service/commit/2b5c33ecb68a9f127e06d222d4b5845a250f7d44))

## [0.2.0](https://github.com/Cadenway/cadenway-organization-service/compare/v0.1.0...v0.2.0) (2026-11-15)


### Miscellaneous Chores

* release 0.2.0 ([424bac5](https://github.com/Cadenway/cadenway-organization-service/commit/424bac5380ce3cad809a93de883d435119872793))

## 0.1.0 (2026-11-12)


### Bug Fixes

* **deploy:** sign the deploy commits with the bot's noreply address ([#3](https://github.com/Cadenway/cadenway-organization-service/issues/3)) ([d57c158](https://github.com/Cadenway/cadenway-organization-service/commit/d57c15876a357ef1c0f184f9536734f58e6c1b1b))
