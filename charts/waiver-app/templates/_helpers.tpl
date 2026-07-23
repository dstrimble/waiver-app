{{- define "waiver-app.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "waiver-app.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- include "waiver-app.name" . -}}
{{- end -}}
{{- end -}}

{{- define "waiver-app.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "waiver-app.labels" -}}
helm.sh/chart: {{ include "waiver-app.chart" . }}
app.kubernetes.io/name: {{ include "waiver-app.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "waiver-app.imagePullSecrets" -}}
{{- if .Values.imagePullSecrets }}
{{ toYaml .Values.imagePullSecrets }}
{{- end }}
{{- end -}}
