# Copyright The Linux Foundation and each contributor to LFX.
# SPDX-License-Identifier: MIT

{{/*
Expand the name of the chart.
*/}}
{{- define "lfx-self-serve.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "lfx-self-serve.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "lfx-self-serve.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "lfx-self-serve.labels" -}}
helm.sh/chart: {{ include "lfx-self-serve.chart" . }}
{{ include "lfx-self-serve.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Values.labels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "lfx-self-serve.selectorLabels" -}}
app.kubernetes.io/name: {{ include "lfx-self-serve.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "lfx-self-serve.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "lfx-self-serve.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Create the image name with tag
*/}}
{{- define "lfx-self-serve.image" -}}
{{- $tag := .Values.image.tag | default .Chart.AppVersion }}
{{- printf "%s:%s" .Values.image.repository $tag }}
{{- end }}

{{/*
Common annotations
*/}}
{{- define "lfx-self-serve.annotations" -}}
{{- with .Values.annotations }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Pod annotations
*/}}
{{- define "lfx-self-serve.podAnnotations" -}}
{{- with .Values.podAnnotations }}
{{ toYaml . }}
{{- end }}
{{- with .Values.annotations }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Create the name of the external secrets secretstore to use
*/}}
{{- define "lfx-self-serve.secretStoreName" -}}
{{- default (include "lfx-self-serve.fullname" .) .Values.externalSecrets.secretStore.name }}
{{- end }}

{{/*
Create the name of the external secret to use
*/}}
{{- define "lfx-self-serve.externalSecretName" -}}
{{- default (include "lfx-self-serve.fullname" .) .Values.externalSecrets.name }}
{{- end }}

{{/*
SecretStore annotations
Merges global annotations with externalSecrets.secretStore.annotations
SecretStore-specific annotations override global ones on key conflicts
*/}}
{{- define "lfx-self-serve.secretStoreAnnotations" -}}
{{- $notations := dict -}}
{{- if .Values.annotations }}
{{- $notations = merge $notations .Values.annotations }}
{{- end }}
{{- if .Values.externalSecrets.secretStore }}
{{- if .Values.externalSecrets.secretStore.annotations }}
{{- /* secretStore annotations override global on key conflicts */ -}}
{{- $notations = merge $notations .Values.externalSecrets.secretStore.annotations }}
{{- end }}
{{- end }}
{{- if $notations }}
{{- toYaml $notations }}
{{- end }}
{{- end }}

{{/*
ExternalSecret annotations
Merges global annotations with externalSecrets.annotations
ExternalSecret-specific annotations override global ones on key conflicts
*/}}
{{- define "lfx-self-serve.externalSecretAnnotations" -}}
{{- $notations := dict -}}
{{- if .Values.annotations }}
{{- $notations = merge $notations .Values.annotations }}
{{- end }}
{{- if .Values.externalSecrets.annotations }}
{{- /* externalSecrets annotations override global on key conflicts */ -}}
{{- $notations = merge $notations .Values.externalSecrets.annotations }}
{{- end }}
{{- if $notations }}
{{- toYaml $notations }}
{{- end }}
{{- end }}

{{/*
Validate the staticConfigMaps root value itself is a map (or nil).
Catches bad-shape inputs like `staticConfigMaps: "foo"`,
`staticConfigMaps: [a,b]`, `staticConfigMaps: ""`, or `staticConfigMaps: []`
before any caller iterates with `range` or runs `toJson` for the checksum
annotation, so failures surface with a clear message instead of an opaque
template type error from inside a range or sprig function.

Uses `hasKey` + `kindIs "invalid"` (Helm's "kind" for nil) instead of a
truthiness gate so empty-but-mistyped values (`""`, `[]`, `0`) still fail
the type check; only an absent key or an explicit `null` is treated as
"no static ConfigMaps configured".

Call once at the top of any template that reads .Values.staticConfigMaps:
  {{- include "lfx-self-serve.staticConfigMaps.rootValidate" . }}
*/}}
{{- define "lfx-self-serve.staticConfigMaps.rootValidate" -}}
{{- if hasKey .Values "staticConfigMaps" -}}
{{- $scm := .Values.staticConfigMaps -}}
{{- if and (not (kindIs "invalid" $scm)) (not (kindIs "map" $scm)) -}}
{{- fail (printf "staticConfigMaps must be a map of <name> -> { mountPath, data } (got %s)" (kindOf $scm)) -}}
{{- end -}}
{{- end -}}
{{- end }}

{{/*
Validate one staticConfigMaps entry. Called from both configmap.yaml and
deployment.yaml so any caller that touches a malformed entry fails with a
clear error message — regardless of which template Helm renders first.

Args (dict):
  name  — the staticConfigMaps key (becomes ConfigMap suffix + volume name)
  cfg   — the staticConfigMaps value (must be a map with mountPath + data)
  root  — the chart root context, used to derive the rendered ConfigMap name
*/}}
{{- define "lfx-self-serve.staticConfigMaps.validate" -}}
{{- $name := .name -}}
{{- $cfg := .cfg -}}
{{- $root := .root -}}
{{- if not (regexMatch "^[a-z0-9]([a-z0-9-]*[a-z0-9])?$" $name) -}}
{{- fail (printf "staticConfigMaps key %q must be a valid DNS-1123 label (lowercase alphanumerics and '-', start/end with alphanumeric)" $name) -}}
{{- end -}}
{{- if gt (len $name) 63 -}}
{{- fail (printf "staticConfigMaps key %q exceeds the 63-char DNS-1123 label limit (the key is also used as the pod volume name, which Kubernetes rejects above 63 chars)" $name) -}}
{{- end -}}
{{- if not (kindIs "map" $cfg) -}}
{{- fail (printf "staticConfigMaps.%s must be a map with mountPath and data keys (got %s)" $name (kindOf $cfg)) -}}
{{- end -}}
{{- if not (kindIs "string" $cfg.mountPath) -}}
{{- fail (printf "staticConfigMaps.%s.mountPath is required and must be a string" $name) -}}
{{- end -}}
{{- if or (eq (trim $cfg.mountPath) "") (not (hasPrefix "/" $cfg.mountPath)) -}}
{{- fail (printf "staticConfigMaps.%s.mountPath %q must be a non-empty absolute path (must start with '/')" $name $cfg.mountPath) -}}
{{- end -}}
{{- if not (kindIs "map" $cfg.data) -}}
{{- fail (printf "staticConfigMaps.%s.data is required and must be a map of file-name -> string content" $name) -}}
{{- end -}}
{{- if eq (len $cfg.data) 0 -}}
{{- fail (printf "staticConfigMaps.%s.data must contain at least one file" $name) -}}
{{- end -}}
{{- range $key, $value := $cfg.data -}}
{{- if not (kindIs "string" $key) -}}
{{- fail (printf "staticConfigMaps.%s.data has a non-string key (got %s) — ConfigMap data keys must be strings; quote numeric or boolean-looking keys in YAML" $name (kindOf $key)) -}}
{{- end -}}
{{- if not (regexMatch "^[A-Za-z0-9._-]+$" $key) -}}
{{- fail (printf "staticConfigMaps.%s.data key %q is invalid; ConfigMap data keys must match [A-Za-z0-9._-]+ (Kubernetes apiserver rejects others at apply time)" $name $key) -}}
{{- end -}}
{{- if not (kindIs "string" $value) -}}
{{- fail (printf "staticConfigMaps.%s.data.%s must be a string (use a YAML literal block scalar like '|' for multi-line content)" $name $key) -}}
{{- end -}}
{{- end -}}
{{- $cmName := printf "%s-%s" (include "lfx-self-serve.fullname" $root) $name -}}
{{- if gt (len $cmName) 253 -}}
{{- fail (printf "ConfigMap name %q exceeds the 253-char DNS-1123 subdomain limit (release fullname + staticConfigMaps key %q is too long)" $cmName $name) -}}
{{- end -}}
{{- end }}

{{/*
Reject a per-service base URL that would route traffic around the gateway.

`microservice-proxy.service.ts` resolves each of LFX_V2_CAMPAIGN_SERVICE,
LFX_V2_MEMBER_SERVICE and LFX_V2_COMMITTEE_SERVICE to its own value when set
and to LFX_V2_SERVICE otherwise. The fallback is what makes the gateway the
default, and the gateway is where the authorization lives: Heimdall and
OpenFGA enforce the per-project grant in front of these services, while a
service's own token check authenticates the caller without authorizing them
for the project they named. A base URL aimed straight at a service instance
therefore lets any caller holding a valid token act on a project it has no
grant for.

Leaving the keys out of values.yaml was never enough on its own —
deployment.yaml emits every entry in `.Values.environment`, so an override
adds the variable without touching this chart. This is the render-time check
that makes the omission binding, and failing here means the mistake surfaces
in a diff-able `helm template` run rather than in a running pod.

An empty value is allowed: `LFX_V2_MEMBER_SERVICE: {value: }` declares the key
without setting it, which the container start-up treats as unset and which the
application then resolves to LFX_V2_SERVICE — the intended routing.

A deployment that genuinely needs a direct address (a mesh path that still
enforces the grant, say) should change this list in a reviewed chart commit,
which is the point: a values override is invisible to review, a chart change
is not.

Call once at the top of any template that renders .Values.environment:
  {{- include "lfx-self-serve.environment.gatewayOnlyValidate" . }}
*/}}
{{- define "lfx-self-serve.environment.gatewayOnlyValidate" -}}
{{- $env := .Values.environment | default dict -}}
{{- range $name := (list "LFX_V2_CAMPAIGN_SERVICE" "LFX_V2_MEMBER_SERVICE" "LFX_V2_COMMITTEE_SERVICE") -}}
{{- $cfg := index $env $name -}}
{{- if kindIs "map" $cfg -}}
{{- if or (and (hasKey $cfg "value") $cfg.value) (hasKey $cfg "valueFrom") -}}
{{- fail (printf "environment.%s must not be set: it overrides the gateway base URL (LFX_V2_SERVICE), and the gateway is where Heimdall/OpenFGA enforce the per-project grant. Pointing the application at a service instance directly lets any caller with a valid token act on a project it has no grant for. Remove the override, or drop %s from the gateway-only list in templates/_helpers.tpl in a reviewed chart change." $name $name) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end }}
