# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-06-18

### Fixed

- Fixed the karma system: collecting from a perp now applies its `collect_risk`
  karma cost so karma can go negative and the Karmalizer incident loop works
  again, with the incident roll matching the original game (#358, #359).
- Stop dialog button bars being clipped on WebKit (the engine iOS messengers use),
  and make app UI text non-selectable while keeping perp/token descriptions and
  form fields selectable (#360).

## [0.3.0] - 2026-06-16

- Baseline release; changelog tracking starts here.
