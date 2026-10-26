# Reviewed invitation renderer releases

No approved manifests are registered. Newly authored publication is closed even when
`TEMPLATE_PUBLISH_ENABLED=true`. Backend test fixtures are synthetic and never
constitute deployed frontend or visual acceptance.

A release must implement the schema in `../invitation-renderer-capabilities.schema.json`,
be registered in `APPROVED_RENDERER_CAPABILITIES` by a reviewed code deployment, and
pass en/ru/fr/hy, bundled fonts, named palette roles, inert preview, supported
variants and mobile/desktop acceptance on the actual renderer revision. A manifest
cannot be uploaded or edited through the authoring API. Its digest is canonical
SHA-256 over every field except `digest` (object keys sorted; array order retained).

Legacy pins retain their exact old payload and unverified renderer provenance.
The local frontend snapshot `1232107` does not establish custom theme/font or fr
support and does not permit publication of seed-only variants.
