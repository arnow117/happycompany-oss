# Security Policy

## Reporting a vulnerability

**Please do not open public issues for security vulnerabilities.**

Report privately via GitHub's **[Private vulnerability reporting](https://github.com/arnow117/happycompany-oss/security/advisories/new)**
(Security → Report a vulnerability). Include:

- a description and impact,
- steps to reproduce or a proof of concept,
- affected version / commit.

We aim to acknowledge reports within a few business days.

## Supported versions

This project is pre-1.0; only the latest `main` is supported. Fixes land on `main`.

## Handling secrets

- Never commit secrets. `config.json`, `config.e2e.json`, and `data/` are
  gitignored; configuration ships only as `*.example.json` with placeholders.
- Provide model credentials via environment variables or your local
  (untracked) `config.json` — never in code or committed config.
- The runtime sanitizes the environment passed to spawned skill/agent
  subprocesses (see `src/env-guard.ts`).

## Scope notes

- Tenant business data lives outside the repo (a configured `corpDir`); the
  repo only ships de-identified demo fixtures under `corp/`.
- Tenant skill tools run with deny-by-default tool policy and per-tool risk
  levels; treat any new tool that performs writes or shell/file access as
  security-sensitive and review accordingly.
