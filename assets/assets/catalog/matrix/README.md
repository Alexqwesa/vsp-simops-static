Approved SIMOPS matrix snapshots are exported here as `<id>.json` by
`dart run tool/sync_matrix_assets.dart`. Review each export and pin its printed
SHA-256 in `lib/catalog/matrix_asset_hashes.dart` before publishing.
The asset is an envelope containing a sanitized matrix. An authenticated
export also includes the work-type catalog. A raw `SimopsMatrixVersion` dump
is accepted as local input by `dart tool/import_raw_matrix.dart <matrix-path>
[work-types-path]`, which removes audit IDs before writing the public asset.
Include a work-type JSON list to preserve names. A pair of work types with no rule is always yellow.

Approved matrix versions never change: a SIMOPS is signed with its matrix id only, and these files
(with their pins) are what anyone can check that matrix against. Keep the file of every version a
SIMOPS uses, including historical ones. The export's `defaultId` (not hashed) is the version new SIMOPS
use; pin it as `defaultMatrixAssetId`.
