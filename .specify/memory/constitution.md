<!--
Sync Impact Report:
- Version change: null → 1.0.0
- Modified principles: None (initial setup)
- Added sections: Core Principles (Simplicity & Readability, Pure Functions & Immutability, Single Responsibility), Development Standards, Quality & Review Process, Governance
- Removed sections: Placeholder Principles 4 and 5
- Templates requiring updates: 
  ✅ .specify/templates/plan-template.md
  ✅ .specify/templates/spec-template.md
  ✅ .specify/templates/tasks-template.md
- Follow-up TODOs: None
-->

# Project Window Manager Constitution

## Core Principles

### I. Simplicity & Readability
Code MUST be simple and readable. Prioritize clear, understandable code over cleverness. Code is read far more often than it is written, so readability is the primary metric of quality.

### II. Pure Functions & Immutability
Prefer pure functions and immutable data structures whenever possible and sensible. This reduces side effects, minimizes state-related bugs, and makes the system easier to test and reason about.

### III. Single Responsibility
Adhere strictly to the Single Responsibility Principle. Components, functions, and modules MUST have one clear reason to change. Complex behaviors should be composed of smaller, single-purpose pieces.

## Development Standards

Ensure that functional programming concepts are leveraged when appropriate. Keep side effects at the boundaries of the system (e.g., I/O, database access, UI rendering). 

## Quality & Review Process

All code MUST be reviewed for adherence to simplicity, purity, immutability, and single responsibility. PRs that violate these principles without strong, documented justification will be rejected.

## Governance

Amendments to this constitution require consensus among core maintainers. Changes MUST be documented with clear rationale and versioned semantically.

All PRs/reviews must verify compliance. Complexity must be justified.

**Version**: 1.0.0 | **Ratified**: 2026-03-14 | **Last Amended**: 2026-03-14