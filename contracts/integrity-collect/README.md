# Integrity collect consumer fixture

This test-only fixture is copied from
`ms-argus-api/contracts/integrity-collect/v1/transport.json`. The API owns the
contract; Web Integrity consumes it. Keep the files byte-for-byte identical
when the provider publishes a new schema version.

Production code does not import this JSON. The consumer test uses it to pin the
request builder's method, headers, content type, and sole emitted wire version.
The `/v1/integrity-collect` path is the current API route namespace, not an
alternate `X-Argus-V` payload shape.
