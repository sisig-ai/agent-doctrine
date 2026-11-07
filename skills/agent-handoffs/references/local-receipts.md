# Local handoffs (rule 11)

Moved from `HANDOFFS.md`. This mode applies only to a machine whose `LOCAL.md` declares the local handoff override.

## rule 11

a machine whose `LOCAL.md` declares the local handoff override (`does not require porch`) may store handoffs as local files and use `handoff.ts`. other machines keep the porch rules above unchanged. on a local machine, a delegation carries exactly one structured pointer line, `handoff: {"note":"<abs note path>"}`; the host overlay defines the enforcement adapter. `handoff.ts` writes authored `exact` and `prose` blocks unchanged by default and makes zero model calls. an explicit `--compress` request compresses `prose` blocks once through the same native harness. it writes a local receipt bound to the absolute path, rule version, revision, harness, model, content hash, and the last delta's processing mode (`authored` or `native-compressed`). the receipt certifies storage integrity and the declared processing path; it does not certify concision, semantic quality, or author identity. enforcement is local to that machine. install it with `doctrine-sync install-handoff-local`; ordinary sync deploys the core only. unsupported hosts report a concrete gap through `doctrine-sync handoff-capabilities`. this covers ordinary agent workflows; a same-user shell can edit the note or drop a receipt, so it is not a security boundary. compression prompt adapted from wilpel/caveman-compression.

## prompt shape (local machine)

on a machine that declares the local handoff override, the handoff is a local file. the prompt is the fixed wording in `## prompt shape`, with the porch load replaced by the local path, and carries exactly one pointer line:

```
handoff: {"note":"<abs note path>"}
```

the host overlay names the enforcement adapter. nothing else in the prompt changes.
