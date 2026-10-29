{{/*
Return a digest-pinned image when configured. Tags remain available for local development
and chart-template validation, but the release runbook requires a sha256 digest.
*/}}
{{- define "enterprise-platform.image" -}}
{{- if .digest -}}
{{ .repository }}@{{ .digest }}
{{- else -}}
{{ .repository }}:{{ .tag }}
{{- end -}}
{{- end -}}
