# Build-Time Secrets Management

This document describes how build-time secrets are injected into the application during the Docker build process, specifically for client-side configuration values that need to be embedded in the JavaScript bundle.

## Overview

Build-time secrets are configuration values that:

- Need to be embedded in the client-side JavaScript bundle at build time
- Should not be stored in source code (for open-source projects)
- Are environment-specific (development, staging, production)
- Are safe to expose in client-side code (e.g., public API keys, client IDs)

**Example:** LaunchDarkly client-side SDK client ID

## Architecture

### 1. Secret Storage

Secrets are stored in AWS Secrets Manager under the `/cloudops/managed-secrets/` namespace:

```text
/cloudops/managed-secrets/launchdarkly/lfx_one/ld_client_id
```

Secret format (JSON):

```json
{
  "ld_client_id": "your-launchdarkly-client-id"
}
```

### 2. GitHub Actions Secret Retrieval

Each workflow retrieves secrets directly using AWS Secrets Manager:

1. Authenticates with AWS using OIDC
2. Retrieves secrets from AWS Secrets Manager
3. Validates required secrets exist
4. Sets secrets as environment variables using `GITHUB_ENV`

**Key feature:** Uses `GITHUB_ENV` to make secrets available to subsequent steps in the same job. LaunchDarkly client-side IDs are NOT masked because they're meant to be public values embedded in browser JavaScript.

```yaml
steps:
  - name: OIDC Auth
    uses: aws-actions/configure-aws-credentials@v4
    with:
      audience: sts.amazonaws.com
      role-to-assume: arn:aws:iam::788942260905:role/github-actions-deploy
      aws-region: us-west-2

  - name: Get LaunchDarkly client ID from AWS Secrets Manager
    uses: aws-actions/aws-secretsmanager-get-secrets@v2
    with:
      secret-ids: |
        LAUNCHDARKLY, /cloudops/managed-secrets/launchdarkly/lfx_one/ld_client_id

  - name: Set LaunchDarkly client ID environment variable
    run: |
      LAUNCHDARKLY_CLIENT_ID=$(echo "$LAUNCHDARKLY" | jq -r '.ld_client_id // empty')
      if [ -z "$LAUNCHDARKLY_CLIENT_ID" ]; then
        echo "❌ LaunchDarkly client ID not found in AWS Secrets Manager"
        exit 1
      fi
      echo "LAUNCHDARKLY_CLIENT_ID=$LAUNCHDARKLY_CLIENT_ID" >> $GITHUB_ENV
```

### 3. Docker BuildKit Secret Mounts

Secrets are passed to Docker builds using BuildKit secret mounts, which:

- Don't persist in image layers
- Don't appear in build history
- Are more secure than `ARG` or `ENV`

**GitHub Actions:**

```yaml
- name: Build and push Docker image
  uses: docker/build-push-action@v5
  with:
    secret-envs: |
      LAUNCHDARKLY_CLIENT_ID=LAUNCHDARKLY_CLIENT_ID
```

**Dockerfile:**

```dockerfile
# Build shared package first (doesn't need --define flag)
RUN yarn workspace @lfx-one/shared build:${BUILD_ENV}

# Build the Angular application with LaunchDarkly client ID from secret
RUN --mount=type=secret,id=LAUNCHDARKLY_CLIENT_ID \
    LAUNCHDARKLY_CLIENT_ID=$(cat /run/secrets/LAUNCHDARKLY_CLIENT_ID) && \
    yarn workspace lfx-one-ui build:${BUILD_ENV} --define LAUNCHDARKLY_CLIENT_ID="'${LAUNCHDARKLY_CLIENT_ID}'"
```

### 4. Angular Build-Time Injection

Angular 19's `define` feature (Vite) replaces constant references at build time:

**angular.json:**

```json
{
  "options": {
    "define": {
      "LAUNCHDARKLY_CLIENT_ID": "''"
    }
  }
}
```

**Environment files:**

```typescript
// Declare the constant that will be replaced at build time
declare const LAUNCHDARKLY_CLIENT_ID: string | undefined;

export const environment = {
  launchDarklyClientId: typeof LAUNCHDARKLY_CLIENT_ID !== 'undefined' ? LAUNCHDARKLY_CLIENT_ID : 'dev-client-id-fallback', // Dev fallback for local ng serve
};
```

The `--define LAUNCHDARKLY_CLIENT_ID="'value'"` flag replaces all occurrences of `LAUNCHDARKLY_CLIENT_ID` in the compiled code with the actual value.

## Data Flow

```text
AWS Secrets Manager
    ↓
GitHub Actions (OIDC Auth)
    ↓
AWS Secrets Manager Retrieval (per job)
    ↓
GITHUB_ENV (job environment)
    ↓
Docker Build (BuildKit Secret Mount)
    ↓
Angular Build (--define flag)
    ↓
JavaScript Bundle (constant replaced)
```

## Local Development

### Using `yarn start` (ng serve)

The `ng serve` command doesn't support the `--define` flag, so environment files include hardcoded fallback values:

```typescript
launchDarklyClientId:
  typeof LAUNCHDARKLY_CLIENT_ID !== 'undefined'
    ? LAUNCHDARKLY_CLIENT_ID
    : 'dev-client-id-fallback', // Dev client ID for local ng serve
```

This means:

- ✅ Local development works without AWS credentials
- ✅ Dev environment uses appropriate client ID
- ✅ Production builds override with secure values
- ❌ Dev client ID is visible in source code (acceptable trade-off)

### Using `yarn build`

Local builds can be tested with the define flag. Note that you must build the shared package separately first, then build the UI with the define flag:

```bash
# First, build the shared package (required dependency)
yarn workspace @lfx-one/shared build:development

# Then build the Angular UI with define
yarn workspace lfx-one-ui build:development --define LAUNCHDARKLY_CLIENT_ID="'your-client-id-here'"

# Or for production build
yarn workspace @lfx-one/shared build:production
yarn workspace lfx-one-ui build:production --define LAUNCHDARKLY_CLIENT_ID="'your-client-id-here'"
```

**Why separate builds?** The shared package uses TypeScript compiler which doesn't understand the `--define` flag. Building them separately ensures the shared package builds without errors while allowing the Angular UI to use the define feature.

## Workflow Integration

All three Docker build workflows retrieve secrets directly in the job:

1. **docker-build-main.yml** - Development environment deployments
2. **docker-build-tag.yml** - Production releases
3. **docker-build-pr.yml** - PR preview deployments

Each workflow follows the same pattern - retrieve secrets from AWS Secrets Manager and set them as environment variables using `GITHUB_ENV`:

```yaml
jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: OIDC Auth
        uses: aws-actions/configure-aws-credentials@v4
        with:
          audience: sts.amazonaws.com
          role-to-assume: arn:aws:iam::788942260905:role/github-actions-deploy
          aws-region: us-west-2

      - name: Get LaunchDarkly client ID from AWS Secrets Manager
        uses: aws-actions/aws-secretsmanager-get-secrets@v2
        with:
          secret-ids: |
            LAUNCHDARKLY, /cloudops/managed-secrets/launchdarkly/lfx_one/ld_client_id

      - name: Set LaunchDarkly client ID environment variable
        run: |
          LAUNCHDARKLY_CLIENT_ID=$(echo "$LAUNCHDARKLY" | jq -r '.ld_client_id // empty')
          if [ -z "$LAUNCHDARKLY_CLIENT_ID" ]; then
            echo "❌ LaunchDarkly client ID not found in AWS Secrets Manager"
            exit 1
          fi
          echo "LAUNCHDARKLY_CLIENT_ID=$LAUNCHDARKLY_CLIENT_ID" >> $GITHUB_ENV
```

## Security Considerations

### ✅ Secure Practices

- **AWS Secrets Manager** - Centralized secret storage with access control
- **OIDC Authentication** - No long-lived AWS credentials in GitHub
- **BuildKit Secret Mounts** - Secrets don't persist in image layers
- **Validation Steps** - Fail fast if secrets are missing
- **No Masking for Client IDs** - LaunchDarkly client-side IDs are public values (not masked in logs)

### ⚠️ Important Notes

- **Client-side secrets are public** - These values are visible in browser dev tools
- **Use only for non-sensitive data** - API keys for client-side SDKs, public endpoints
- **Never use for server secrets** - Database passwords, API tokens, etc. should use runtime injection

## Adding New Build-Time Secrets

### Step 1: Add Secret to AWS Secrets Manager

Create secret at `/cloudops/managed-secrets/[service]/[app]/[secret_name]`:

```bash
aws secretsmanager create-secret \
  --name /cloudops/managed-secrets/service/lfx_one/new_secret \
  --secret-string '{"key": "value"}'
```

### Step 2: Update Docker Build Workflows

Update the secret retrieval section in all three workflows (docker-build-main.yml, docker-build-tag.yml, docker-build-pr.yml):

```yaml
- name: Get secrets from AWS Secrets Manager
  uses: aws-actions/aws-secretsmanager-get-secrets@v2
  with:
    secret-ids: |
      LAUNCHDARKLY, /cloudops/managed-secrets/launchdarkly/lfx_one/ld_client_id
      NEWSECRET, /cloudops/managed-secrets/service/lfx_one/new_secret

- name: Set environment variables
  run: |
    LAUNCHDARKLY_CLIENT_ID=$(echo "$LAUNCHDARKLY" | jq -r '.ld_client_id // empty')
    NEW_SECRET=$(echo "$NEWSECRET" | jq -r '.key // empty')

    if [ -z "$LAUNCHDARKLY_CLIENT_ID" ]; then
      echo "❌ LaunchDarkly client ID not found in AWS Secrets Manager"
      exit 1
    fi
    if [ -z "$NEW_SECRET" ]; then
      echo "❌ New secret not found in AWS Secrets Manager"
      exit 1
    fi

    echo "LAUNCHDARKLY_CLIENT_ID=$LAUNCHDARKLY_CLIENT_ID" >> $GITHUB_ENV
    echo "NEW_SECRET=$NEW_SECRET" >> $GITHUB_ENV
```

**Note:** Add `::add-mask::$NEW_SECRET` before setting GITHUB_ENV if the new secret is truly sensitive (not a public client-side ID).

### Step 3: Update Docker secret-envs

Add to `secret-envs` in the Docker build step of all three workflows:

```yaml
secret-envs: |
  LAUNCHDARKLY_CLIENT_ID=LAUNCHDARKLY_CLIENT_ID
  NEW_SECRET=NEW_SECRET
```

### Step 4: Update Dockerfile

Update the Angular UI build step to include the new secret:

```dockerfile
# Build shared package first (doesn't need --define flag)
RUN yarn workspace @lfx-one/shared build:${BUILD_ENV}

# Build the Angular application with secrets
RUN --mount=type=secret,id=LAUNCHDARKLY_CLIENT_ID \
    --mount=type=secret,id=NEW_SECRET \
    LAUNCHDARKLY_CLIENT_ID=$(cat /run/secrets/LAUNCHDARKLY_CLIENT_ID) && \
    NEW_SECRET=$(cat /run/secrets/NEW_SECRET) && \
    yarn workspace lfx-one-ui build:${BUILD_ENV} \
      --define LAUNCHDARKLY_CLIENT_ID="'${LAUNCHDARKLY_CLIENT_ID}'" \
      --define NEW_SECRET="'${NEW_SECRET}'"
```

### Step 5: Update Angular Configuration

Add to `angular.json`:

```json
{
  "options": {
    "define": {
      "LAUNCHDARKLY_CLIENT_ID": "''",
      "NEW_SECRET": "''"
    }
  }
}
```

### Step 6: Update Environment Files

```typescript
declare const NEW_SECRET: string | undefined;

export const environment = {
  newSecret: typeof NEW_SECRET !== 'undefined' ? NEW_SECRET : 'dev-fallback-value', // For local ng serve
};
```

## Troubleshooting

### Build fails with "secret not found"

**Problem:** Docker build can't find secret mount

**Solution:**

1. Verify secret exists in AWS Secrets Manager
2. Check GitHub Actions workflow output for secret retrieval
3. Ensure secret is added to `secret-envs` in workflow
4. Verify secret ID matches between workflow and Dockerfile

### Secret value is empty in build

**Problem:** Secret retrieves but value is empty/undefined

**Solution:**

1. Check JSON structure in AWS Secrets Manager matches jq extraction
2. Verify field name in `jq -r '.field_name // empty'`
3. Check validation step passes in workflow

### Local development not working

**Problem:** `yarn start` fails or uses wrong values

**Solution:**

1. Ensure fallback values exist in environment files
2. Check `typeof CONSTANT !== 'undefined'` logic
3. Remember `ng serve` doesn't support `--define` flag
4. Use `yarn build` locally to test define injection

### Secret visible in logs

**Problem:** Secret appears in GitHub Actions logs

**Solution:**

1. Add `echo "::add-mask::$SECRET"` before using secret
2. Ensure masking happens before any echo/logging
3. Check for indirect leaks (e.g., in error messages)

## References

- [Angular Build Options](https://angular.dev/tools/cli/build)
- [Docker BuildKit Secrets](https://docs.docker.com/build/building/secrets/)
- [GitHub Actions Reusable Workflows](https://docs.github.com/en/actions/using-workflows/reusing-workflows)
- [AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/)
- [GitHub OIDC with AWS](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)

## Related Documentation

- [Deployment Guide](./deployment.md) - Deployment processes and environments
- [Feature Flags](./architecture/frontend/feature-flags.md) - LaunchDarkly feature flag system
- [Authentication](./architecture/backend/authentication.md) - Server-side authentication setup
