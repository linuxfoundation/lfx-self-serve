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
{{- if not (kindIs "map" $cfg.data) -}}
{{- fail (printf "staticConfigMaps.%s.data is required and must be a map of file-name -> string content" $name) -}}
{{- end -}}
{{- if eq (len $cfg.data) 0 -}}
{{- fail (printf "staticConfigMaps.%s.data must contain at least one file" $name) -}}
{{- end -}}
{{- range $key, $value := $cfg.data -}}
{{- if not (kindIs "string" $value) -}}
{{- fail (printf "staticConfigMaps.%s.data.%s must be a string (use a YAML literal block scalar like '|' for multi-line content)" $name $key) -}}
{{- end -}}
{{- end -}}
{{- $cmName := printf "%s-%s" (include "lfx-self-serve.fullname" $root) $name -}}
{{- if gt (len $cmName) 253 -}}
{{- fail (printf "ConfigMap name %q exceeds the 253-char DNS-1123 subdomain limit (release fullname + staticConfigMaps key %q is too long)" $cmName $name) -}}
{{- end -}}
{{- end }}
