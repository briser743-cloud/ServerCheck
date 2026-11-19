# Project-specific agent guidance

For server hardware compatibility analysis, read and follow [`docs/compatibility-research-skill.md`](docs/compatibility-research-skill.md). This is the project’s maintained compatibility skill; do not substitute an isolated chat answer for its evidence rules.

When a user corrects a result in the website dialogue, treat it as feedback: verify any technical claim against sources, distill the correction into a reusable rule, and update the skill plus anonymized regression coverage when the rule is supported. Keep raw user BOMs, chat transcripts, reports, API keys, and other private input out of the skill and Git. The website chat does not retrain model weights or automatically write to this file; skill updates are reviewed project changes.
