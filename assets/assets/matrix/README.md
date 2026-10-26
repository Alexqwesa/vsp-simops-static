Approved SIMOPS matrix snapshots are exported here as `<id>.json` by
`dart run tool/sync_matrix_assets.dart`. Review each export and pin its printed
SHA-256 in `lib/simops_matrix_screen/matrix_asset_hashes.dart` before publishing.
The asset is an envelope containing a sanitized matrix. An authenticated
export also includes the work-type catalog. A raw `SimopsMatrixVersion` dump
is accepted as local input by `dart tool/import_raw_matrix.dart <matrix-path>
[work-types-path]`, which removes audit IDs before writing the public asset.
Include a work-type JSON list to preserve names and default levels. A rules-only asset displays
explicit rules; pairs without rules show `?` until a catalog is exported.
