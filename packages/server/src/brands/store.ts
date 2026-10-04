import { randomUUID } from 'node:crypto';
import * as S from '@cura/shared';
import type { AppDatabase } from '../database.js';
import { CatalogError } from '../catalog-store.js';

type Row = Record<string, unknown>;
type Value = string | number | null;
const camel = (row: Row): Row =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, character: string) =>
        character.toUpperCase(),
      ),
      value,
    ]),
  );
const invalid = (message: string): never => {
  throw new CatalogError(message, 'INVALID_RELATION', 400);
};
export class BrandStore {
  constructor(private readonly db: AppDatabase) {}
  private get(table: string, id: string): Row {
    const row = this.db.sqlite
      .prepare(`SELECT * FROM ${table} WHERE id=?`)
      .get(id) as Row | undefined;
    if (!row) throw new CatalogError('Brand or CMF record not found');
    return row;
  }
  private rows(
    table: string,
    column: string,
    value: string,
    order = 'position,id',
  ): Row[] {
    return this.db.sqlite
      .prepare(`SELECT * FROM ${table} WHERE ${column}=? ORDER BY ${order}`)
      .all(value) as Row[];
  }
  private children(table: string, column: string, id: string): Row[] {
    return this.rows(table, column, id).map((row) => {
      const data = camel(row);
      if (data.versionId) {
        data.pin = { assetId: data.assetId, versionId: data.versionId };
        delete data.assetId;
        delete data.versionId;
      }
      return data;
    });
  }
  private log(libraryId: string, action: string, id: string) {
    const date = new Date().toISOString();
    this.db.sqlite
      .prepare('INSERT INTO activity VALUES (?,?,?,?,?,?,?)')
      .run(
        randomUUID(),
        libraryId,
        null,
        action,
        JSON.stringify({ id }),
        date,
        date,
      );
  }
  listBrands(libraryId: string): S.Brand[] {
    this.get('libraries', libraryId);
    return this.rows('brands', 'library_id', libraryId, 'created_at,id').map(
      (row) => this.getBrand(String(row.id)),
    );
  }
  getBrand(id: string): S.Brand {
    const base = camel(this.get('brands', id));
    return S.BrandSchema.parse({
      ...base,
      colors: this.children('brand_colors', 'brand_id', id).map((row) => ({
        ...row,
        ...S.colorValues(String(row.hex)),
      })),
      fonts: this.children('brand_fonts', 'brand_id', id),
      logos: this.children('brand_logos', 'brand_id', id),
    });
  }
  createBrand(libraryId: string, input: unknown): S.Brand {
    const data = S.CreateBrandSchema.parse(input);
    this.get('libraries', libraryId);
    const id = randomUUID(),
      date = new Date().toISOString();
    this.db.sqlite.transaction(() => {
      this.db.sqlite
        .prepare('INSERT INTO brands VALUES (?,?,?,?,?,?,?)')
        .run(id, libraryId, data.name, '', 0, date, date);
      this.log(libraryId, 'brand.create', id);
    })();
    return this.getBrand(id);
  }
  private pin(pin: S.BrandPin, libraryId: string) {
    const asset = this.get('assets', pin.assetId),
      version = this.get('asset_versions', pin.versionId);
    if (asset.library_id !== libraryId || version.asset_id !== pin.assetId)
      invalid('Pinned versions must belong to the same asset and library');
  }
  private replaceChildren(
    table: string,
    ownerColumn: string,
    ownerId: string,
    libraryId: string,
    items: Array<
      { id?: string | undefined; pin?: S.BrandPin | undefined } & Record<
        string,
        unknown
      >
    >,
    columns: string[],
    date: string,
  ) {
    const existing = this.rows(table, ownerColumn, ownerId),
      seen = new Set<string>();
    for (const item of items) {
      if (
        item.id &&
        (!existing.some((row) => row.id === item.id) || seen.has(item.id))
      )
        invalid('Child IDs must be unique and belong to this record');
      if (item.id) seen.add(item.id);
      if (item.pin) this.pin(item.pin, libraryId);
    }
    for (const row of existing)
      if (!seen.has(String(row.id)))
        this.db.sqlite.prepare(`DELETE FROM ${table} WHERE id=?`).run(row.id);
    items.forEach((item, position) => {
      const row: Record<string, Value> = {
        id: item.id ?? randomUUID(),
        [ownerColumn]: ownerId,
        position,
        created_at: date,
        updated_at: date,
      };
      for (const column of columns)
        row[column] =
          column === 'asset_id'
            ? item.pin!.assetId
            : column === 'version_id'
              ? item.pin!.versionId
              : column === 'hex'
                ? S.colorValues(String(item.hex)).hex
                : String(
                    item[
                      column.replace(/_([a-z])/g, (_, c: string) =>
                        c.toUpperCase(),
                      )
                    ],
                  );
      if (item.id) {
        delete row.created_at;
        const fields = Object.keys(row).filter((key) => key !== 'id');
        this.db.sqlite
          .prepare(
            `UPDATE ${table} SET ${fields.map((key) => `${key}=?`).join(',')} WHERE id=?`,
          )
          .run(...fields.map((key) => row[key]!), item.id);
      } else {
        const fields = Object.keys(row);
        this.db.sqlite
          .prepare(
            `INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
          )
          .run(...fields.map((key) => row[key]!));
      }
    });
  }
  saveBrand(id: string, input: unknown): S.Brand {
    const data = S.SaveBrandSchema.parse(input);
    return this.db.sqlite.transaction(() => {
      const old = this.get('brands', id),
        lib = String(old.library_id),
        date = new Date().toISOString();
      if (old.revision !== data.expectedRevision)
        throw new CatalogError(
          'This brand changed. Reload before saving.',
          'REVISION_CONFLICT',
          409,
        );
      this.replaceChildren(
        'brand_colors',
        'brand_id',
        id,
        lib,
        data.colors,
        ['name', 'hex'],
        date,
      );
      this.replaceChildren(
        'brand_fonts',
        'brand_id',
        id,
        lib,
        data.fonts,
        ['name', 'role', 'asset_id', 'version_id'],
        date,
      );
      this.replaceChildren(
        'brand_logos',
        'brand_id',
        id,
        lib,
        data.logos,
        ['name', 'asset_id', 'version_id'],
        date,
      );
      this.db.sqlite
        .prepare(
          'UPDATE brands SET name=?,guidelines=?,revision=revision+1,updated_at=? WHERE id=?',
        )
        .run(data.name, data.guidelines, date, id);
      this.log(lib, 'brand.update', id);
      return this.getBrand(id);
    })();
  }
  deleteBrand(id: string) {
    this.remove('brands', id, 'brand.delete');
  }
  private remove(table: string, id: string, action: string) {
    this.db.sqlite.transaction(() => {
      const row = this.get(table, id);
      this.db.sqlite.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
      this.log(String(row.library_id), action, id);
    })();
  }
  listCmfBoards(libraryId: string): S.CmfBoard[] {
    this.get('libraries', libraryId);
    return this.rows(
      'cmf_boards',
      'library_id',
      libraryId,
      'created_at,id',
    ).map((row) => this.getCmfBoard(String(row.id)));
  }
  getCmfBoard(id: string): S.CmfBoard {
    return S.CmfBoardSchema.parse({
      ...camel(this.get('cmf_boards', id)),
      entries: this.children('cmf_entries', 'board_id', id),
    });
  }
  createCmfBoard(libraryId: string, input: unknown): S.CmfBoard {
    const data = S.CreateCmfBoardSchema.parse(input);
    this.get('libraries', libraryId);
    const id = randomUUID(),
      date = new Date().toISOString();
    this.db.sqlite.transaction(() => {
      this.db.sqlite
        .prepare('INSERT INTO cmf_boards VALUES (?,?,?,?,?,?)')
        .run(id, libraryId, data.name, 0, date, date);
      this.log(libraryId, 'cmf.create', id);
    })();
    return this.getCmfBoard(id);
  }
  saveCmfBoard(id: string, input: unknown): S.CmfBoard {
    const data = S.SaveCmfBoardSchema.parse(input);
    return this.db.sqlite.transaction(() => {
      const old = this.get('cmf_boards', id),
        lib = String(old.library_id),
        date = new Date().toISOString();
      if (old.revision !== data.expectedRevision)
        throw new CatalogError(
          'This CMF board changed. Reload before saving.',
          'REVISION_CONFLICT',
          409,
        );
      this.replaceChildren(
        'cmf_entries',
        'board_id',
        id,
        lib,
        data.entries,
        ['name', 'color_name', 'hex', 'process', 'asset_id', 'version_id'],
        date,
      );
      this.db.sqlite
        .prepare(
          'UPDATE cmf_boards SET name=?,revision=revision+1,updated_at=? WHERE id=?',
        )
        .run(data.name, date, id);
      this.log(lib, 'cmf.update', id);
      return this.getCmfBoard(id);
    })();
  }
  deleteCmfBoard(id: string) {
    this.remove('cmf_boards', id, 'cmf.delete');
  }
}
export function readBrandExport(
  database: AppDatabase,
  libraryId: string,
): S.BrandExportRecords {
  const store = new BrandStore(database),
    brands = store.listBrands(libraryId),
    cmfBoards = store.listCmfBoards(libraryId);
  const pins = [
    ...brands.flatMap((brand) =>
      [...brand.fonts, ...brand.logos].map((item) => item.pin),
    ),
    ...cmfBoards.flatMap((board) => board.entries.map((item) => item.pin)),
  ];
  return S.BrandExportRecordsSchema.parse({
    brands,
    cmfBoards,
    pins: [...new Map(pins.map((pin) => [pin.versionId, pin])).values()],
  });
}
