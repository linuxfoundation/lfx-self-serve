<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Runbook: Feature Branch Deployment

## Overview

This runbook covers deploying a feature branch to the shared dev cluster for
integration testing, stakeholder review, or debugging. Deployments are
triggered by adding the `deploy-preview` label to a pull request — no manual
`kubectl` or `helm` commands are required.

For a high-level description of the CI/CD pipeline, see
[Deployment Architecture](../architecture/deployment.md).

---

## Prerequisites and Access Requirements

Before proceeding, verify:

- **Write access** to the `linuxfoundation/lfx-self-serve` GitHub repository.
  Fork PRs cannot trigger preview deployments.
- **An open pull request** — the PR must not be in draft state.
- **GitHub Actions enabled** — check under _Settings → Actions_ that workflows
  are not disabled for your fork or the repo.
- **No merge conflicts** — the branch must be buildable. A red CI status does
  not block the label, but a failed build will leave the previous deployment
  (or no deployment) in place.

---

## Step 1: Branch Selection

Choose the branch to deploy:

- Use the branch associated with the PR you want to preview. The workflow
  always builds the PR's `HEAD` commit at the time the label is applied (or
  re-applied after a push).
- If you need to preview a stack of changes, open a PR against a feature
  integration branch rather than `main`, and apply the label there.

---

## Step 2: Trigger the Deployment

1. Open the pull request on GitHub.
2. In the right-hand sidebar, click **Labels → deploy-preview**.
3. The `Deploy Branch to Development` workflow starts immediately. Monitor
   progress in the **Actions** tab of the repository.

The workflow:
- Checks out the PR branch.
- Builds a Docker image with `BUILD_ENV=dev-cluster` tagged `ui-pr-<N>`.
- Pushes the image to `ghcr.io/linuxfoundation/lfx-self-serve`.
- Posts a comment on the PR with the deployment URL once the image push
  succeeds. ArgoCD picks up the image and reconciles the namespace within
  ~1 minute of the image appearing in the registry.

Typical end-to-end time from label to live URL: **5–10 minutes**.

---

## Step 3: Verification

Once the bot posts the deployment URL (`https://ui-pr-<N>.dev.v2.cluster.linuxfound.info`):

### 3.1 Basic health check

- Open the URL in a browser. The Angular app should load without a blank screen
  or error page.
- Log in with a dev-environment account (Auth0 dev tenant). If login fails,
  confirm your account has access to the dev Auth0 tenant.
- Navigate to the feature or page being tested and confirm expected behavior.

### 3.2 Check pod status (optional)

If the URL is not reachable or returns errors, check pod health via the ArgoCD
UI (access requires cluster credentials managed by the platform team):

- Application name: `ui-pr-<N>`
- Namespace: `ui-pr-<N>`
- All pods should be in `Running` state with `1/1` containers ready.

### 3.3 Check application logs (optional)

Pod logs surface Express/Node.js errors that do not appear in the browser:

```bash
# Requires kubectl access to the dev cluster
kubectl logs -n ui-pr-<N> -l app=lfx-self-serve --tail=100
```

Common errors to look for:
- Missing environment variable warnings (see [Adding a New Secret](#adding-a-new-secret) below)
- NATS connection failures (usually transient; the app retries automatically)
- Auth0 configuration mismatches

---

## Step 4: Iterating on the Branch

Re-pushing commits to the PR branch while the `deploy-preview` label is active
will re-trigger the build workflow automatically (on the `synchronize` event).
The existing deployment is updated in-place; no need to remove and re-add the
label.

---

## Step 5: Teardown

Deployments are removed in two ways:

| Action | Result |
|--------|--------|
| Remove the `deploy-preview` label | Cleanup job runs; bot posts a removal notice on the PR |
| Close or merge the PR | Cleanup job runs automatically |

The ArgoCD ApplicationSet removes the namespace and all associated Kubernetes
resources. Container images tagged `ui-pr-<N>` remain in GHCR and are subject
to the registry's retention policy.

---

## Common Scenarios

### Adding a New Environment Variable or Secret

**When to use:** Your feature branch introduces a new configuration value
(API key, service URL, feature flag, etc.) that the dev-cluster preview must
have to function.

**Non-secret values** (URLs, flags, non-sensitive config):

1. Add the variable to the Helm chart's `values.yaml` schema in
   `charts/lfx-self-serve/`:

   ```yaml
   # charts/lfx-self-serve/values.yaml
   environment:
     MY_NEW_VAR:
       value: "default-value"
   ```

2. Open a PR in `lfx-v2-argocd` to set the dev-cluster value:

   ```yaml
   # values/dev/lfx-v2-ui.yaml
   environment:
     MY_NEW_VAR:
       value: "dev-value"
   ```

3. The preview namespace inherits the dev-cluster values. No per-PR override
   is needed unless the value must differ per preview.

**Secret values** (credentials, API keys):

Secrets in the dev cluster are sourced from AWS Secrets Manager via
ExternalSecret. The ExternalSecret fetches all secrets tagged
`service: lfx-v2-ui` in `us-west-2`.

To add a new secret for dev-cluster previews:

1. Ask the platform team (or use your AWS access if you have it) to add the
   secret to AWS Secrets Manager with the tag `service: lfx-v2-ui`.
2. Add the corresponding environment variable reference to the Helm chart
   `values.yaml`:

   ```yaml
   environment:
     MY_NEW_SECRET:
       valueFrom:
         secretKeyRef:
           name: pcc-secret-store   # ExternalSecret target name
           key: MY_NEW_SECRET
   ```

3. Update `lfx-v2-argocd` dev values to reference the secret key, then open
   the preview as normal.

> **Note:** If you need the secret only in a single preview (not in all dev
> namespaces), create a Kubernetes `Secret` manually in the preview namespace
> via the platform team; this is unusual and should be a short-term workaround.

---

### Changing Kubernetes Resource Limits

**When to use:** The app OOMKills under load, or you need to reduce resource
consumption for a cost experiment.

Resource limits and requests are set via the Helm chart in `lfx-v2-argocd`.
Preview namespaces inherit the dev-cluster defaults.

1. Locate the dev values file in `lfx-v2-argocd`:
   `values/dev/lfx-v2-ui.yaml`

2. Override the resources block:

   ```yaml
   resources:
     requests:
       cpu: "100m"
       memory: "256Mi"
     limits:
       cpu: "500m"
       memory: "512Mi"
   ```

3. Open a PR in `lfx-v2-argocd`. ArgoCD reconciles the change within ~2 minutes
   of merge. All active preview namespaces pick up the new limits because they
   use the same ApplicationSet template.

> For a one-off resource change on a single preview namespace (e.g., load
> testing), coordinate with the platform team to patch the deployment directly
> — do not merge a temporary resource change to the ArgoCD repo.

---

### Updating a Base Dependency (npm package, Angular, Node)

**When to use:** Your branch updates a major dependency and you want to confirm
the build and runtime behavior before merging.

No special steps are needed — `docker-build-pr.yml` runs a full production
build inside the Docker image. Dependency changes are picked up automatically
from `package.json` / `yarn.lock`. Apply the `deploy-preview` label as normal.

---

## Known Gotchas

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| No bot comment after 10 minutes | Workflow failed or never triggered | Check the Actions tab; confirm the label is applied and the PR is not from a fork |
| Bot comment posted but URL returns 502/503 | ArgoCD not yet synced, or pod CrashLoopBackOff | Wait 2–3 minutes; check pod status via ArgoCD or kubectl |
| Login redirects to wrong callback | Auth0 dev tenant callback not registered for this namespace | Contact the platform team to register `https://ui-pr-<N>.dev.v2.cluster.linuxfound.info/callback` |
| Re-push doesn't update the deployment | Workflow did not re-trigger | Confirm `synchronize` event fired in Actions; re-add the label to force a fresh run |
| Missing environment variable at runtime | New env var not present in dev-cluster ExternalSecret or values | Follow the [Adding a New Secret](#adding-a-new-secret) steps above |
| Preview works but prod does not | `dev-cluster` vs `production` build config difference | Check Angular environment files in `apps/lfx-one/src/environments/` |
