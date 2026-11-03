# Bundled catalogs

Reference data that ships inside the app and the static site. Screens read these first
and replace them with the server answer only when a server is reachable (the static
site has none). Names, translations and access lists come from here, so the files are
public: review a fresh export before committing it.

| File | What | Read by | Pinned |
| --- | --- | --- | --- |
| `matrix/<id>.json` | approved SIMOPS matrix envelope (`id`, `sha256`, `version`) | `loadBundledMatrixAsset` (`matrix_asset_loader.dart`) | yes, SHA-256 in `lib/catalog/matrix_asset_hashes.dart` |
| `worktypes.json` | work types with translations and default levels, always the latest | `loadBundledWorkTypes` (`work_type_catalog.dart`) | no |
| `unit_catalog.json` | units with translations and access lists | `UnitCatalogController` (`unit_catalog.dart`) | no |
| `sub_sections.json` | sub-sections (places) with translations | `SubSectionCatalogController` (`sub_section_catalog.dart`) | no |

All the code that reads them is in `lib/catalog/`: `bundled_catalog.dart` (paths and the shared
`loadBundledList`), the four loaders above, `matrix_asset_hashes.dart` (pinned hashes) and
`static_catalogs.dart` (the static site, which has no server and uses the bundles alone).

Paths are listed once in `pubspec.yaml` (`assets/catalog/` and `assets/catalog/matrix/`);
a file in a new sub-folder needs its own line there, or it is missing in release builds.

## Refresh

- Matrix: `dart run tool/sync_matrix_assets.dart`, or `dart tool/import_raw_matrix.dart <matrix-path> [work-types-path]`
  for a raw dump; both print the hash to pin. See `matrix/README.md`.
- `worktypes.json`: written by the same two tools (not pinned).
- `unit_catalog.json`, `sub_sections.json`: a JSON list of the generated `Unit` / `SubSection`
  models (`toJson()`), as returned by `unit.listAll` and `subSection.list`.
