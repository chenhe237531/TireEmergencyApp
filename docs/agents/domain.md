# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root. It defines the vocabulary for 司机、门店、救援工单、救援咨询、账号合并、账号注销 and related terms.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in. ADR-0002 (phone-first identity), ADR-0005 (AMap / GCJ-02), ADR-0006 (account deletion) and ADR-0007 (idempotency key) gate most Android v1 work.
- **`docs/android-app-design.md`**: the v1 product and delivery design, including page/API mapping, milestones and the acceptance matrix.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill creates glossary and ADR files lazily when terms or decisions actually get resolved.

## File structure

Single-context repo:

```
/
├── GLOSSARY.md
├── docs/
│   ├── android-app-design.md
│   ├── adr/
│   │   ├── 0001-reuse-uniapp-for-android.md
│   │   └── ...
│   └── agents/
└── android/            ← 离线打包工程（上架阶段）
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (client idempotency key), but worth reopening because…_
