export type Filters = {
  q?: string | undefined;
  folderId?: string | undefined;
  tagId?: string | undefined;
  rating?: number | undefined;
  type?: string | undefined;
  color?: string | undefined;
  source?: string | undefined;
  after?: string | undefined;
  before?: string | undefined;
  minWidth?: number | undefined;
  minHeight?: number | undefined;
  similarTo?: string | undefined;
  trash?: boolean | undefined;
  archived?: boolean | undefined;
  missing?: boolean | undefined;
};
