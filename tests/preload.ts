// Point doctrine paths at the checkout under test.
//
// Source-reading tests compare generated host doctrine against fixtures in this
// repository. Without this, `REPO_DIR` would resolve to the canonical clone
// (`~/.claude/.claude-md-repo`) even when tests run from a linked worktree.
// `CLAUDE_MD_DIR` is an explicit override and is never replaced.
import { resolve } from "path";

process.env.CLAUDE_MD_DIR ??= resolve(import.meta.dir, "..");
