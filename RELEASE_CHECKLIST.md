# Release Checklist — two-layer-agent-contract

Conference: Agentic Engineering Day NZ
Repository: https://github.com/Darshitpandya/two-layer-agent-contract (currently PRIVATE)
Target tag: `v1.0.0-conference`

## Known-good baseline (already verified)

| Item | Status |
|------|--------|
| License (Apache 2.0) | ✅ |
| SECURITY.md present | ✅ |
| CONTRIBUTING.md present | ✅ |
| All dependencies pinned | ✅ |
| No committed secrets | ✅ |
| Docker image pinned (`ghcr.io/agentgateway/agentgateway:v1.5.0`) | ✅ |
| `make verify` exits 0, 37/37 tests pass | ✅ |
| FINAL_RELEASE_GATE.md verdict: READY FOR CONFERENCE RELEASE | ✅ |

---

## Pre-release (before conference day)

Complete these steps on the `auditing` branch / after merging PR #8.

- [ ] Merge PR #8 (`fix: remediate three audit findings`) from `auditing` → `main`
- [ ] Run final secret scan on merged `main`
  ```sh
  git checkout main && git pull
  # e.g. trufflehog git file://. --since-commit HEAD --only-verified
  ```
- [ ] Confirm License file is Apache 2.0 on `main`
  ```sh
  head -3 LICENSE
  ```
- [ ] Confirm SECURITY.md is present on `main`
  ```sh
  ls SECURITY.md
  ```
- [ ] Confirm CONTRIBUTING.md is present on `main`
  ```sh
  ls CONTRIBUTING.md
  ```
- [ ] Confirm all dependencies still pinned on `main`
  ```sh
  cat package.json | grep -v '"[^"]*": "\^'
  ```
- [ ] Test README commands on a **clean checkout** (fresh directory, no local state)
  ```sh
  git clone https://github.com/Darshitpandya/two-layer-agent-contract.git /tmp/gnp-test
  cd /tmp/gnp-test
  # Follow README quickstart steps exactly
  ```
- [ ] `make verify` passes on clean checkout (37/37 tests)
  ```sh
  make verify
  ```
- [ ] Evidence generation works end-to-end
  ```sh
  make step1 && make step2 && make step3 && make step4 && make step5 && make step6
  ```
- [ ] Docker image pullable (agentgateway v1.5.0)
  ```sh
  docker pull ghcr.io/agentgateway/agentgateway:v1.5.0
  ```
- [ ] FINAL_RELEASE_GATE.md is present and verdict reads `READY FOR CONFERENCE RELEASE`
  ```sh
  cat FINAL_RELEASE_GATE.md
  ```
- [ ] Create annotated git tag
  ```sh
  git tag -a v1.0.0-conference -m 'Conference release: Agentic Engineering Day NZ'
  git push origin v1.0.0-conference
  ```
- [ ] Record commit SHA below (fill in before release)

  **Release commit SHA:** `[FILL IN BEFORE RELEASE]`

---

## On conference day (in order)

Run these steps on the day of the talk, before you go on stage.

- [ ] Make repository public
  ```sh
  gh repo edit two-layer-agent-contract --visibility public
  ```
- [ ] Enable branch protection on `main` (requires public repo)
  ```sh
  gh api repos/Darshitpandya/two-layer-agent-contract/branches/main/protection \
    --method PUT \
    -f 'required_status_checks[strict]=true' \
    -f 'required_status_checks[contexts][]=build-and-test' \
    -f 'enforce_admins=false' \
    -f 'required_pull_request_reviews[required_approving_review_count]=1' \
    -f 'restrictions=null' \
    -f 'allow_force_pushes=false' \
    -f 'allow_deletions=false'
  ```
- [ ] Verify public URL loads in browser: https://github.com/Darshitpandya/two-layer-agent-contract
- [ ] Generate QR code pointing to: `https://github.com/Darshitpandya/two-layer-agent-contract`
- [ ] **Physically scan the QR code** before putting it on the slide (confirm it resolves)
- [ ] Replace `[QR PLACEHOLDER]` in `slide-deck.md` (Slide 29 — closing slide) with QR code image
- [ ] Run final `make verify` on the **conference machine**
  ```sh
  make verify
  # Expected: 37/37 tests pass, exit 0
  ```
- [ ] Pre-pull Docker image on the conference machine
  ```sh
  docker pull ghcr.io/agentgateway/agentgateway:v1.5.0
  ```

---

## Demo readiness (on conference machine)

Verify the demo environment is fully operational before going on stage.

### Environment checks

- [ ] Docker Desktop is running (whale icon in menu bar)
- [ ] `make --version` returns a version (make is on PATH)
  ```sh
  make --version
  ```
- [ ] `node --version` returns ≥ 22
  ```sh
  node --version   # must be v22.x.x or higher
  ```

### Fresh-clone smoke test

- [ ] Clone the (now public) repo on the conference machine
  ```sh
  git clone https://github.com/Darshitpandya/two-layer-agent-contract.git
  cd two-layer-agent-contract
  ```
- [ ] `make up` completes successfully (services start, no errors)
  ```sh
  make up
  ```
- [ ] `make session` returns a session ID
  ```sh
  make session
  ```
- [ ] `make step1` through `make step6` all produce expected output
  ```sh
  make step1
  make step2
  make step3
  make step4
  make step5
  make step6
  ```
- [ ] `make test-fail-closed` passes 3/3
  ```sh
  make test-fail-closed
  # Expected: 3/3 PASS
  ```

### Presentation setup

- [ ] Two terminal windows open and positioned:
  - **Window A** — `make logs` (live log stream)
  - **Window B** — command input
- [ ] Terminal font size is readable from the **back of the room** (test with a colleague or walk to the back yourself)

---

## QR code details

| Field | Value |
|-------|-------|
| Destination URL | `https://github.com/Darshitpandya/two-layer-agent-contract` |
| Slide | 29 (closing slide) |
| Placeholder in slide-deck.md | `[QR PLACEHOLDER]` |

---

## Tag and commit SHA

```sh
# Create the tag (run after merging PR #8 to main)
git tag -a v1.0.0-conference -m 'Conference release: Agentic Engineering Day NZ'
git push origin v1.0.0-conference

# Record the SHA
git rev-parse HEAD
```

**Release commit SHA:** `[FILL IN BEFORE RELEASE]`

---

*Last updated: 2026-10-06*
